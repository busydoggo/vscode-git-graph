import * as path from 'path';
import * as vscode from 'vscode';
import { DataSource } from './dataSource';
import { DiffDocProvider, DiffSide, decodeDiffDocUri, encodeDiffDocUri } from './diffDocProvider';
import { ErrorInfo, GitFileChange, GitFileStatus } from './types';
import { UNCOMMITTED, abbrevCommit, copyToClipboard, getRepoName, openFile, showErrorMessage } from './utils';

interface DiffRange {
	repo: string;
	fromHash: string | null;
	toHash: string;
	untrackedFilesHash: string | null;
}

interface NativeMultiDiffInput {
	title: string;
	multiDiffSourceUri: vscode.Uri;
	resources: { originalUri: vscode.Uri | undefined; modifiedUri: vscode.Uri | undefined }[];
}

// The extension's minimum VS Code version predates the stable Tab Groups API.
interface NativeTab {
	readonly label: string;
	readonly isPreview?: boolean;
	readonly input?: { readonly uri?: vscode.Uri; readonly textDiffs?: { readonly original: vscode.Uri; readonly modified: vscode.Uri }[] };
}
interface NativeTabGroup { readonly activeTab?: NativeTab; readonly tabs: ReadonlyArray<NativeTab> }
interface NativeTabWindow {
	readonly tabGroups?: {
		readonly activeTabGroup: NativeTabGroup;
		readonly all: ReadonlyArray<NativeTabGroup>;
		onDidChangeTabs?: (listener: () => void) => vscode.Disposable;
		close: (tab: NativeTab, preserveFocus: boolean) => Thenable<boolean>;
	};
}
const activeNativeTab = () => (vscode.window as NativeTabWindow).tabGroups?.activeTabGroup.activeTab;
const nativeInputs = new WeakMap<NativeTab, NativeMultiDiffInput>();
const pendingRefreshes = new WeakMap<NativeTab, Promise<ErrorInfo>>();
const sourceScheme = 'vs-git-graph-multi-diff';
const sourceFragmentPrefix = 'git-graph-multi-diff:';
let nextInputId = 0;
let pendingEditorUpdate = Promise.resolve<ErrorInfo>(null);

/** Open all displayed file changes together in VS Code's native, collapsible diff editor. */
export async function viewAllDiffs(repo: string, fromHash: string | null, toHash: string, files: ReadonlyArray<GitFileChange>, untrackedFilesHash: string | null): Promise<ErrorInfo> {
	if (files.length === 0) return 'There are no file changes to display.';
	try {
		const input = createNativeInput({ repo, fromHash, toHash, untrackedFilesHash }, files);
		await openNativeInput(input);
		return null;
	} catch (reason) {
		return 'Unable to open the native multi-file diff editor. Please ensure your VS Code version supports it. ' + String(reason);
	}
}

function createNativeInput(range: DiffRange, files: ReadonlyArray<GitFileChange>): NativeMultiDiffInput {
	const { repo, fromHash, toHash, untrackedFilesHash } = range;
	const sourceId = Date.now() + '-' + nextInputId++;
	const query = Buffer.from(JSON.stringify(range)).toString('base64');
	const sourceUri = vscode.Uri.parse(sourceScheme + ':/' + sourceId).with({ query });
	const revisionUri = (filePath: string, hash: string, type: GitFileStatus, side: DiffSide) => {
		// Preserve the actual filename and directory for native diff headers and language detection.
		const uri = encodeDiffDocUri(repo, filePath, hash, type, side).with({ path: vscode.Uri.file(path.join(repo, filePath)).path });
		return uri.scheme === DiffDocProvider.scheme ? uri.with({ fragment: sourceFragmentPrefix + sourceId + '?' + query }) : uri;
	};
	const resources = files.map(file => {
		const added = file.type === GitFileStatus.Added || file.type === GitFileStatus.Untracked;
		const original = fromHash === null || added ? undefined : revisionUri(file.oldFilePath, fromHash, file.type, DiffSide.Old);
		const modifiedHash = file.type === GitFileStatus.Untracked && toHash !== UNCOMMITTED && untrackedFilesHash !== null ? untrackedFilesHash : toHash;
		// Working tree resources remain real file URIs, retaining editing and language services.
		const modified = file.type === GitFileStatus.Deleted ? undefined : revisionUri(file.newFilePath, modifiedHash, file.type, DiffSide.New);
		return { originalUri: original, modifiedUri: modified };
	});

	return {
		title: getDiffTitle(range),
		multiDiffSourceUri: sourceUri,
		resources
	};
}

function getDiffTitle({ repo, fromHash, toHash }: DiffRange): string {
	const description = toHash === UNCOMMITTED ? (fromHash !== null && fromHash !== 'HEAD' ? abbrevCommit(fromHash) + ' ↔ ' : '') + 'Uncommitted Changes'
		: fromHash === null ? abbrevCommit(toHash) : abbrevCommit(fromHash) + ' ↔ ' + abbrevCommit(toHash);
	return 'Git (' + getRepoName(repo) + ') • ' + description;
}

async function openNativeInput(input: NativeMultiDiffInput) {
	// A source identity lets file toolbar actions reveal the correct editor without opening another tab.
	await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', input);
	const tab = activeNativeTab();
	if (tab && (tab.label === input.title || tab.label.startsWith(input.title + ' ('))) {
		nativeInputs.set(tab, input);
		// Keep the summary open when native file navigation opens another preview tab.
		if (tab.isPreview) await vscode.commands.executeCommand('workbench.action.keepEditor');
	}
}

/** Refresh the active Git Graph multi-file diff from Git, including changes to its file list. */
export function refreshAllDiffs(dataSource: DataSource, sourceUri?: vscode.Uri): Promise<ErrorInfo> {
	const tab = activeNativeTab();
	const input = tab && getNativeInput(tab);
	const source = sourceUri?.scheme === sourceScheme ? sourceUri : input?.multiDiffSourceUri;
	const groups = (vscode.window as NativeTabWindow).tabGroups;
	if (!tab || !groups || !source || (!input && !tab.input?.textDiffs) || (input && input.multiDiffSourceUri.toString() !== source.toString())) {
		return Promise.resolve('The active editor is not a Git Graph multi-file diff.');
	}
	const pending = pendingRefreshes.get(tab);
	if (pending) return pending;
	const range = decodeDiffRange(source);
	if (!range) return Promise.resolve('Reopen View All Changes in One Tab to enable refreshing this diff.');
	if (!input && tab.label !== getDiffTitle(range) && !tab.label.startsWith(getDiffTitle(range) + ' (')) {
		return Promise.resolve('The active editor is not a Git Graph multi-file diff.');
	}
	const update = async (): Promise<ErrorInfo> => {
		try {
			if (activeNativeTab() !== tab) return null;
			const { repo, fromHash, toHash, untrackedFilesHash } = range;
			let files: ReadonlyArray<GitFileChange>;
			if (toHash === UNCOMMITTED && fromHash === 'HEAD') {
				const result = await dataSource.getUncommittedDetails(repo);
				if (result.error !== null) return result.error;
				files = result.commitDetails!.fileChanges;
			} else if (fromHash === null || untrackedFilesHash !== null) {
				const result = fromHash === null ? await dataSource.getCommitDetails(repo, toHash, false)
					: await dataSource.getStashDetails(repo, toHash, { selector: '', baseHash: fromHash, untrackedFilesHash });
				if (result.error !== null) return result.error;
				files = result.commitDetails!.fileChanges;
			} else {
				const result = await dataSource.getCommitComparison(repo, fromHash, toHash);
				if (result.error !== null) return result.error;
				files = result.fileChanges;
			}
			if (activeNativeTab() !== tab) return null;
			// Native inputs have immutable file lists. Open the replacement before closing the old tab,
			// retaining working-file models and leaving the original editor intact if opening fails.
			await openNativeInput(createNativeInput(range, files));
			if (groups.all.some(group => group.tabs.includes(tab)) && !await groups.close(tab, true)) {
				return 'The refreshed diff is open, but the previous diff tab could not be closed.';
			}
			return null;
		} catch (reason) {
			return 'Unable to refresh the multi-file diff editor. ' + String(reason);
		}
	};
	const refresh = pendingEditorUpdate.then(update);
	pendingEditorUpdate = refresh;
	pendingRefreshes.set(tab, refresh);
	refresh.then(() => pendingRefreshes.delete(tab));
	return refresh;
}

function decodeDiffRange(source: vscode.Uri): DiffRange | undefined {
	try {
		const range: DiffRange = JSON.parse(Buffer.from(source.query, 'base64').toString());
		if (typeof range.repo === 'string' && typeof range.toHash === 'string'
			&& (range.fromHash === null || typeof range.fromHash === 'string')
			&& (range.untrackedFilesHash === null || typeof range.untrackedFilesHash === 'string')) return range;
	} catch (_) { }
	return undefined;
}

/** Copy the real absolute file path, including when the displayed document is a historical revision. */
export async function copyDiffFilePath(uri?: vscode.Uri): Promise<ErrorInfo> {
	try {
		if (uri?.scheme === 'file') return await copyToClipboard(uri.fsPath);
		if (uri?.scheme === DiffDocProvider.scheme) {
			const request = decodeDiffDocUri(uri);
			return await copyToClipboard(vscode.Uri.file(path.join(request.repo, request.filePath)).fsPath);
		}
		return 'The selected item is not a Git Graph file.';
	} catch (reason) {
		return 'Unable to copy the file path. ' + String(reason);
	}
}

/** Redirect native Open File actions from Git revision documents to editable working-tree files. */
export function registerMultiDiffFileNavigation(dataSource: DataSource): vscode.Disposable {
	// The native multi-diff opening command does not expose a separate working-file navigation URI.
	const groups = (vscode.window as NativeTabWindow).tabGroups;
	let previous: { tab: NativeTab; input?: NativeMultiDiffInput; fragment?: string } | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let redirecting = false, disposed = false;
	const update = async () => {
		if (disposed || redirecting) return;
		const tab = activeNativeTab(), editor = vscode.window.activeTextEditor;
		const input = tab && getNativeInput(tab);
		const uri = editor?.document.uri;
		const fragment = uri?.scheme === DiffDocProvider.scheme && uri.fragment.startsWith(sourceFragmentPrefix) ? uri.fragment : undefined;
		if (tab && (input || (tab.input?.textDiffs && fragment))) {
			previous = { tab, input, fragment };
			if (tab.isPreview) await vscode.commands.executeCommand('workbench.action.keepEditor');
			return;
		}
		// Opening a tab can briefly expose no active tab or editor between native notifications.
		if (!tab || !editor) return;
		if (tab.input?.uri && tab.input.uri.toString() !== uri?.toString()) return;
		const from = previous;
		previous = undefined;
		if (!from || uri?.scheme !== DiffDocProvider.scheme || tab.input?.uri?.toString() !== uri.toString()) return;
		if (!groups?.all.some(group => group.tabs.includes(from.tab))) return;
		const belongsToSource = from.input?.resources.some(resource => resource.originalUri?.toString() === uri.toString() || resource.modifiedUri?.toString() === uri.toString())
			|| (fragment !== undefined && fragment === from.fragment);
		if (!belongsToSource) return;
		redirecting = true;
		try {
			const request = decodeDiffDocUri(uri);
			// VS Code has already transferred the embedded diff editor's selection to this text editor.
			const error = await openFile(request.repo, request.filePath, request.commit, dataSource, vscode.ViewColumn.Active, editor.selection);
			if (disposed) return;
			if (error !== null) {
				showErrorMessage('Unable to Open File: ' + error);
				return;
			}
			if (groups?.all.some(group => group.tabs.includes(tab))) await groups.close(tab, true);
		} finally {
			redirecting = false;
		}
	};
	const schedule = () => {
		if (timer !== undefined) clearTimeout(timer);
		// Tab and active-editor notifications can arrive separately; inspect their settled state together.
		timer = setTimeout(() => {
			timer = undefined;
			update().catch(reason => { if (!disposed) showErrorMessage('Unable to Open File: ' + String(reason)); });
		}, 0);
	};
	const listeners = [vscode.window.onDidChangeActiveTextEditor(schedule)];
	if (groups?.onDidChangeTabs) listeners.push(groups.onDidChangeTabs(schedule));
	schedule();
	return { dispose: () => {
		disposed = true;
		if (timer !== undefined) clearTimeout(timer);
		listeners.forEach(listener => listener.dispose());
	} };
}

/** Show or hide only this file's unchanged diff regions, retaining all changed lines. */
export function setAllUnchangedRegionsShown(uri: vscode.Uri, shown: boolean): Promise<ErrorInfo> {
	const tab = activeNativeTab();
	const input = tab && getNativeInput(tab);
	const resource = input?.resources.find(resource => (resource.modifiedUri ?? resource.originalUri)?.toString() === uri?.toString());
	if (!input || !resource) return Promise.resolve('The selected file is not part of the active Git Graph diff editor.');
	// Entirely added or deleted files have no unchanged regions to fold.
	if (!resource.originalUri || !resource.modifiedUri) return Promise.resolve(null);
	const update = async (): Promise<ErrorInfo> => {
		try {
			if (activeNativeTab() !== tab) return null;
			// Release the previous embedded editor's focus so Multi Diff can activate the target file.
			await vscode.commands.executeCommand('workbench.action.focusNextPart');
			if (activeNativeTab() !== tab) return null;
			await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', { ...input, reveal: { modifiedUri: resource.modifiedUri } });
			// Allow the native virtualized item to finish binding before restoring focus.
			await new Promise<void>(resolve => setTimeout(resolve, 100));
			if (activeNativeTab() !== tab) return null;
			await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			// Native diff commands operate on the focused editor, not the URI passed to a toolbar action.
			if (activeNativeTab() !== tab || vscode.window.activeTextEditor?.document.uri.toString() !== resource.modifiedUri!.toString()) {
				return 'Expand this file before changing the visibility of its unchanged regions.';
			}
			await vscode.commands.executeCommand(shown ? 'diffEditor.showAllUnchangedRegions' : 'diffEditor.collapseAllUnchangedRegions');
			return null;
		} catch (reason) {
			return 'Unable to change the visibility of unchanged regions. ' + String(reason);
		}
	};
	// Header clicks on different files must not race and apply a command to another file.
	pendingEditorUpdate = pendingEditorUpdate.then(update);
	return pendingEditorUpdate;
}

/** Recover controls for native diff tabs restored after an extension host or window restart. */
function getNativeInput(tab: NativeTab): NativeMultiDiffInput | undefined {
	const cached = nativeInputs.get(tab);
	if (cached) return cached;
	const diffs = tab.input?.textDiffs;
	const fragment = diffs?.[0]?.original.fragment;
	if (!diffs?.length || !fragment?.startsWith(sourceFragmentPrefix)) return undefined;
	const sourceId = fragment.substring(sourceFragmentPrefix.length);
	if (!/^\d+-\d+(?:\?[^#]+)?$/.test(sourceId) || diffs.some(diff => diff.original.scheme !== 'vs-git-graph' || diff.original.fragment !== fragment)) return undefined;
	// Only two-sided entries are exposed by the Tab API. The existing native input retains additions and deletions.
	const input: NativeMultiDiffInput = {
		title: tab.label,
		multiDiffSourceUri: vscode.Uri.parse(sourceScheme + ':/' + sourceId),
		resources: diffs.map(diff => ({ originalUri: diff.original, modifiedUri: diff.modified }))
	};
	nativeInputs.set(tab, input);
	return input;
}
