import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as path from 'path';
import { DataSource } from '../src/dataSource';
import { DiffSide, decodeDiffDocUri, encodeDiffDocUri } from '../src/diffDocProvider';
import { copyDiffFilePath, refreshAllDiffs, registerMultiDiffFileNavigation, setAllUnchangedRegionsShown, viewAllDiffs } from '../src/multiDiff';
import { GitFileChange, GitFileStatus } from '../src/types';
import { UNCOMMITTED } from '../src/utils';
import * as utils from '../src/utils';

const repo = '/workspace/project';
const file = (type: GitFileStatus, newFilePath: string, oldFilePath: string = newFilePath): GitFileChange => ({ type, newFilePath, oldFilePath, additions: 1, deletions: 1 });
const resources = () => vscode.commands.executeCommand.mock.calls[0][1].resources;

describe('Native multi-file diff editor', () => {
	it('Opens every file in one native tab and uses editable working files on the right', async () => {
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		const changes = [file(GitFileStatus.Modified, 'src/first.ts'), file(GitFileStatus.Modified, 'src/second.ts')];
		expect(await viewAllDiffs(repo, 'HEAD', UNCOMMITTED, changes, null)).toBeNull();
		expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('_workbench.openMultiDiffEditor', { title: 'Git (project) • Uncommitted Changes', multiDiffSourceUri: expect.objectContaining({ scheme: 'vs-git-graph-multi-diff' }), resources: expect.any(Array) });
		expect(resources()).toHaveLength(2);
		resources().forEach(({ originalUri: original, modifiedUri: modified }: any, index: number) => {
			const expected = path.join(repo, changes[index].newFilePath);
			expect(original.scheme).toBe('vs-git-graph');
			expect(decodeDiffDocUri(original)).toMatchObject({ repo, commit: 'HEAD', filePath: changes[index].oldFilePath, exists: true });
			expect(modified.toString()).toBe(vscode.Uri.file(expected).toString());
		});
	});

	it('Represents additions, untracked files and deletions with an absent side', async () => {
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		const changes = [file(GitFileStatus.Added, 'added.txt'), file(GitFileStatus.Untracked, 'new [file].txt'), file(GitFileStatus.Deleted, 'deleted.txt')];
		expect(await viewAllDiffs(repo, 'HEAD', UNCOMMITTED, changes, null)).toBeNull();
		expect(resources()[0].originalUri).toBeUndefined();
		expect(resources()[1].originalUri).toBeUndefined();
		expect(resources()[1].modifiedUri.toString()).toBe(vscode.Uri.file(path.join(repo, 'new [file].txt')).toString());
		expect(resources()[2].modifiedUri).toBeUndefined();
		expect(decodeDiffDocUri(resources()[2].originalUri)).toMatchObject({ commit: 'HEAD', filePath: 'deleted.txt', exists: true });
	});

	it('Preserves revision contents, renamed paths and distinct native editor filenames', async () => {
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		const changes = [file(GitFileStatus.Renamed, 'src/new name.ts', 'src/old name.ts'), file(GitFileStatus.Modified, 'lib/another.ts')];
		expect(await viewAllDiffs(repo, 'before', 'after', changes, null)).toBeNull();
		const { originalUri: original, modifiedUri: modified } = resources()[0];
		expect(original.path).toBe('/workspace/project/src/old name.ts');
		expect(modified.path).toBe('/workspace/project/src/new name.ts');
		expect(decodeDiffDocUri(original)).toMatchObject({ filePath: 'src/old name.ts', commit: 'before', exists: true });
		expect(decodeDiffDocUri(modified)).toMatchObject({ filePath: 'src/new name.ts', commit: 'after', exists: true });
		expect(resources()[1].modifiedUri.path).toBe('/workspace/project/lib/another.ts');
		expect(resources()[1].modifiedUri.scheme).toBe('vs-git-graph');
	});

	it('Supports an initial commit without asking Git for a nonexistent parent', async () => {
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		expect(await viewAllDiffs(repo, null, 'first', [file(GitFileStatus.Added, 'first.ts')], null)).toBeNull();
		expect(resources()[0].originalUri).toBeUndefined();
		expect(decodeDiffDocUri(resources()[0].modifiedUri)).toMatchObject({ commit: 'first', exists: true });
	});

	it('Loads stashed untracked files from their separate stash commit', async () => {
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		const changes = [file(GitFileStatus.Modified, 'tracked.txt'), file(GitFileStatus.Untracked, 'untracked.txt')];
		expect(await viewAllDiffs(repo, 'base', 'stash', changes, 'untracked-stash')).toBeNull();
		expect(decodeDiffDocUri(resources()[0].modifiedUri).commit).toBe('stash');
		expect(resources()[1].originalUri).toBeUndefined();
		expect(decodeDiffDocUri(resources()[1].modifiedUri)).toMatchObject({ commit: 'untracked-stash', exists: true });
	});

	it('Includes files without text statistics instead of silently dropping them', async () => {
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		const binary = { ...file(GitFileStatus.Modified, 'image.png'), additions: null, deletions: null };
		expect(await viewAllDiffs(repo, 'before', 'after', [binary], null)).toBeNull();
		expect(resources()).toHaveLength(1);
	});

	it('Does not open an empty editor', async () => {
		expect(await viewAllDiffs(repo, 'before', 'after', [], null)).toBe('There are no file changes to display.');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	it('Returns command errors so the toolbar can recover after an unsupported editor or failure', async () => {
		vscode.commands.executeCommand.mockRejectedValueOnce(new Error('Command _workbench.openMultiDiffEditor not found'));
		expect(await viewAllDiffs(repo, 'HEAD', UNCOMMITTED, [file(GitFileStatus.Modified, 'file.ts')], null)).toContain('Command _workbench.openMultiDiffEditor not found');
	});
});


describe('Per-file unchanged diff regions', () => {
	let tab: { label: string; input?: { textDiffs: { original: vscode.Uri; modified: vscode.Uri }[] } };
	beforeAll(() => {
		Object.defineProperty(vscode.window, 'tabGroups', { configurable: true, value: { activeTabGroup: { get activeTab() { return tab; } } } });
	});
	beforeEach(() => {
		tab = { label: 'Git (project) • Uncommitted Changes (2 files)' };
	});
	afterAll(() => Reflect.deleteProperty(vscode.window, 'tabGroups'));

	const open = async (changes = [file(GitFileStatus.Modified, 'first.ts'), file(GitFileStatus.Modified, 'second.ts')]) => {
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		expect(await viewAllDiffs(repo, 'HEAD', UNCOMMITTED, changes, null)).toBeNull();
		const input = vscode.commands.executeCommand.mock.calls[0][1];
		vscode.commands.executeCommand.mockClear();
		return input;
	};
	const focus = (target: vscode.Uri) => {
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		vscode.commands.executeCommand.mockImplementationOnce(() => {
			vscode.window.activeTextEditor = { document: { uri: target } };
			return Promise.resolve();
		});
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
	};

	it.each([true, false])('Reveals and focuses only the clicked file before setting visibility to %s', async shown => {
		const input = await open();
		const target = input.resources[1].modifiedUri;
		focus(target);
		expect(await setAllUnchangedRegionsShown(target, shown)).toBeNull();
		expect(vscode.commands.executeCommand.mock.calls).toEqual([
			['workbench.action.focusNextPart'],
			['_workbench.openMultiDiffEditor', { ...input, reveal: { modifiedUri: target } }],
			['workbench.action.focusActiveEditorGroup'],
			[shown ? 'diffEditor.showAllUnchangedRegions' : 'diffEditor.collapseAllUnchangedRegions']
		]);
	});

	it('Does not execute a diff action if focus remains on another file', async () => {
		const input = await open();
		vscode.window.activeTextEditor = { document: { uri: input.resources[0].modifiedUri } };
		for (let i = 0; i < 3; i++) vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		expect(await setAllUnchangedRegionsShown(input.resources[1].modifiedUri, true)).toContain('Expand this file');
		expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(3);
	});

	it('Recovers the original native tab identity after a restart without opening another diff', async () => {
		const input = await open();
		tab = { label: tab.label, input: { textDiffs: input.resources.map((resource: any) => ({ original: resource.originalUri, modified: resource.modifiedUri })) } };
		const target = input.resources[1].modifiedUri;
		focus(target);
		expect(await setAllUnchangedRegionsShown(target, true)).toBeNull();
		expect(vscode.commands.executeCommand.mock.calls[1][1].multiDiffSourceUri.toString()).toBe(input.multiDiffSourceUri.toString());
	});

	it('Cancels before reopening the diff if the user changes tabs during focus release', async () => {
		const input = await open();
		vscode.commands.executeCommand.mockImplementationOnce(() => {
			tab = { label: 'Another editor' };
			return Promise.resolve();
		});
		expect(await setAllUnchangedRegionsShown(input.resources[1].modifiedUri, true)).toBeNull();
		expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
	});

	it('Rejects files outside the current multi-file diff', async () => {
		await open();
		expect(await setAllUnchangedRegionsShown(vscode.Uri.file('/elsewhere.ts'), true)).toContain('not part of the active');
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	it('Ignores a queued action after the user switches tabs', async () => {
		const input = await open();
		const result = setAllUnchangedRegionsShown(input.resources[1].modifiedUri, true);
		tab = { label: 'Another editor' };
		expect(await result).toBeNull();
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	it('Does not move focus or run an unrelated action for wholly added or deleted files', async () => {
		const input = await open([file(GitFileStatus.Added, 'added.ts'), file(GitFileStatus.Deleted, 'deleted.ts')]);
		expect(await setAllUnchangedRegionsShown(input.resources[0].modifiedUri, false)).toBeNull();
		expect(await setAllUnchangedRegionsShown(input.resources[1].originalUri, true)).toBeNull();
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	it('Recovers after a native command rejects', async () => {
		const input = await open();
		const target = input.resources[1].modifiedUri;
		vscode.commands.executeCommand.mockRejectedValueOnce(new Error('Editor unavailable'));
		expect(await setAllUnchangedRegionsShown(target, true)).toContain('Editor unavailable');
		focus(target);
		expect(await setAllUnchangedRegionsShown(target, true)).toBeNull();
	});

	it('Serializes rapid clicks on different file headers', async () => {
		const input = await open();
		focus(input.resources[0].modifiedUri);
		focus(input.resources[1].modifiedUri);
		const results = await Promise.all([
			setAllUnchangedRegionsShown(input.resources[0].modifiedUri, true),
			setAllUnchangedRegionsShown(input.resources[1].modifiedUri, false)
		]);
		expect(results).toEqual([null, null]);
		expect(vscode.commands.executeCommand.mock.calls.filter(args => args[0].startsWith('diffEditor.')).map(args => args[0]))
			.toEqual(['diffEditor.showAllUnchangedRegions', 'diffEditor.collapseAllUnchangedRegions']);
	});
});


describe('Refresh the native multi-file diff', () => {
	let tab: any;
	let tabs: any[];
	let input: any;
	let close: jest.Mock;
	let open: jest.Mock;
	let registration: { dispose: () => void };
	let dataSource: DataSource;
	const changed = [file(GitFileStatus.Modified, 'first.ts'), file(GitFileStatus.Modified, 'second.ts')];
	beforeAll(() => {
		const group = { get activeTab() { return tab; }, get tabs() { return tabs; } };
		Object.defineProperty(vscode.window, 'tabGroups', { configurable: true, value: {
			activeTabGroup: group, all: [group], close: (...args: any[]) => close(...args)
		} });
	});
	beforeEach(async () => {
		tabs = [];
		close = jest.fn(async (target: any) => {
			tabs = tabs.filter(t => t !== target);
			return true;
		});
		open = jest.fn(async (next: any) => {
			input = next;
			tab = { label: next.title + ' (' + next.resources.length + ' files)' };
			tabs.push(tab);
		});
		registration = vscode.commands.registerCommand('_workbench.openMultiDiffEditor', open);
		dataSource = {
			getUncommittedDetails: jest.fn().mockResolvedValue({ commitDetails: { fileChanges: changed }, error: null }),
			getCommitComparison: jest.fn().mockResolvedValue({ fileChanges: changed, error: null }),
			getCommitDetails: jest.fn().mockResolvedValue({ commitDetails: { fileChanges: changed }, error: null }),
			getStashDetails: jest.fn().mockResolvedValue({ commitDetails: { fileChanges: changed }, error: null })
		} as unknown as DataSource;
		expect(await viewAllDiffs(repo, 'HEAD', UNCOMMITTED, changed, null)).toBeNull();
		open.mockClear();
	});
	afterEach(() => registration.dispose());
	afterAll(() => Reflect.deleteProperty(vscode.window, 'tabGroups'));

	it('Replaces the changed-file list in one tab and loads HEAD again without changing working-file URIs', async () => {
		const previous = tab, original = input.resources[0].originalUri;
		const next = [file(GitFileStatus.Modified, 'first.ts'), file(GitFileStatus.Untracked, 'new.ts'), file(GitFileStatus.Deleted, 'removed.ts')];
		(dataSource.getUncommittedDetails as jest.Mock).mockResolvedValueOnce({ commitDetails: { fileChanges: next }, error: null });
		expect(await refreshAllDiffs(dataSource)).toBeNull();
		expect(dataSource.getUncommittedDetails).toHaveBeenCalledWith(repo);
		expect(input.resources).toHaveLength(3);
		expect(input.resources.map((r: any) => (r.modifiedUri ?? r.originalUri).path)).toEqual(next.map(f => repo + '/' + f.newFilePath));
		expect(input.resources[0].originalUri.toString()).not.toBe(original.toString());
		expect(decodeDiffDocUri(input.resources[0].originalUri)).toMatchObject({ commit: 'HEAD' });
		expect(input.resources[0].modifiedUri.toString()).toBe(vscode.Uri.file(repo + '/first.ts').toString());
		expect(close).toHaveBeenCalledWith(previous, true);
		expect(tabs).toEqual([tab]);
	});

	it('Shows an empty comparison after all changes have been reverted', async () => {
		(dataSource.getUncommittedDetails as jest.Mock).mockResolvedValueOnce({ commitDetails: { fileChanges: [] }, error: null });
		expect(await refreshAllDiffs(dataSource)).toBeNull();
		expect(input.resources).toEqual([]);
		expect(tabs).toEqual([tab]);
	});

	it.each([
		['before', 'after', null, 'getCommitComparison', [repo, 'before', 'after']],
		['before', UNCOMMITTED, null, 'getCommitComparison', [repo, 'before', UNCOMMITTED]],
		[null, 'initial', null, 'getCommitDetails', [repo, 'initial', false]],
		['base', 'stash', 'untracked-stash', 'getStashDetails', [repo, 'stash', { selector: '', baseHash: 'base', untrackedFilesHash: 'untracked-stash' }]]
	] as const)('Keeps the original comparison range (%s to %s)', async (from, to, untracked, method, args) => {
		expect(await viewAllDiffs(repo, from, to, changed, untracked)).toBeNull();
		expect(await refreshAllDiffs(dataSource)).toBeNull();
		expect(dataSource[method]).toHaveBeenCalledWith(...args);
	});

	it('Preserves the original tab on a Git error and allows another refresh', async () => {
		const previous = tab;
		(dataSource.getUncommittedDetails as jest.Mock).mockResolvedValueOnce({ commitDetails: null, error: 'Repository unavailable' });
		expect(await refreshAllDiffs(dataSource)).toBe('Repository unavailable');
		expect(open).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(tabs).toEqual([previous]);
		expect(await refreshAllDiffs(dataSource)).toBeNull();
	});

	it('Keeps the previous tab if the replacement editor cannot open', async () => {
		const previous = tab;
		open.mockRejectedValueOnce(new Error('Editor unavailable'));
		expect(await refreshAllDiffs(dataSource)).toContain('Editor unavailable');
		expect(close).not.toHaveBeenCalled();
		expect(tabs).toEqual([previous]);
	});

	it('Coalesces repeated refresh clicks while Git is loading', async () => {
		const first = refreshAllDiffs(dataSource), second = refreshAllDiffs(dataSource);
		expect(first).toBe(second);
		expect(await first).toBeNull();
		expect(dataSource.getUncommittedDetails).toHaveBeenCalledTimes(1);
		expect(open).toHaveBeenCalledTimes(1);
	});

	it('Does not reopen or close an editor after the user switches tabs while Git is loading', async () => {
		(dataSource.getUncommittedDetails as jest.Mock).mockImplementationOnce(async () => {
			tab = { label: 'Another editor' };
			return { commitDetails: { fileChanges: changed }, error: null };
		});
		expect(await refreshAllDiffs(dataSource)).toBeNull();
		expect(open).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});

	it('Recovers the comparison range from a restored native tab', async () => {
		tab = { label: tab.label, input: { textDiffs: input.resources.map((r: any) => ({ original: r.originalUri, modified: r.modifiedUri })) } };
		tabs = [tab];
		expect(await refreshAllDiffs(dataSource)).toBeNull();
		expect(dataSource.getUncommittedDetails).toHaveBeenCalledWith(repo);
		expect(tabs).toEqual([tab]);
	});

	it('Uses the native title action URI after restoring a tab containing only additions', async () => {
		expect(await viewAllDiffs(repo, 'HEAD', UNCOMMITTED, [file(GitFileStatus.Untracked, 'new.ts')], null)).toBeNull();
		const uri = input.multiDiffSourceUri;
		tab = { label: tab.label, input: { textDiffs: [] } };
		tabs = [tab];
		expect(await refreshAllDiffs(dataSource, uri)).toBeNull();
		expect(dataSource.getUncommittedDetails).toHaveBeenCalledWith(repo);
		expect(tabs).toEqual([tab]);
	});

	it.each([undefined, { textDiffs: [] }])('Does not close an unrelated editor when a stale title action URI is supplied (%s)', async tabInput => {
		const uri = input.multiDiffSourceUri;
		tab = { label: 'Other file.ts', input: tabInput };
		expect(await refreshAllDiffs(dataSource, uri)).toContain('not a Git Graph');
		expect(dataSource.getUncommittedDetails).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});

	it('Rejects a title action from a different native diff without running Git', async () => {
		expect(await refreshAllDiffs(dataSource, vscode.Uri.parse('vs-git-graph-multi-diff:/other'))).toContain('not a Git Graph');
		expect(dataSource.getUncommittedDetails).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});
});


describe('Per-file absolute path clipboard action', () => {
	it('Copies a working-file path with spaces and Unicode without URI escaping', async () => {
		vscode.env.clipboard.writeText.mockResolvedValueOnce(undefined);
		expect(await copyDiffFilePath(vscode.Uri.file(repo + '/src/测试 file.ts'))).toBeNull();
		expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(repo + '/src/测试 file.ts');
	});

	it.each([GitFileStatus.Modified, GitFileStatus.Added, GitFileStatus.Renamed, GitFileStatus.Deleted])('Copies the real path of a historical file (%s), including absent files', async type => {
		const uri = encodeDiffDocUri(repo, 'src/historical.ts', 'revision', type, type === GitFileStatus.Deleted ? DiffSide.Old : DiffSide.New);
		vscode.env.clipboard.writeText.mockResolvedValueOnce(undefined);
		expect(await copyDiffFilePath(uri)).toBeNull();
		expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(repo + '/src/historical.ts');
	});

	it('Uses the clicked file rather than the active editor', async () => {
		vscode.window.activeTextEditor = { document: { uri: vscode.Uri.file('/another/file.ts') } };
		const uri = encodeDiffDocUri(repo, 'clicked.ts', 'revision', GitFileStatus.Modified, DiffSide.New);
		vscode.env.clipboard.writeText.mockResolvedValueOnce(undefined);
		expect(await copyDiffFilePath(uri)).toBeNull();
		expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(repo + '/clicked.ts');
	});

	it('Reports clipboard errors and rejects unrelated URIs', async () => {
		vscode.env.clipboard.writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
		expect(await copyDiffFilePath(vscode.Uri.file(repo + '/file.ts'))).toContain('Clipboard');
		vscode.env.clipboard.writeText.mockClear();
		expect(await copyDiffFilePath(vscode.Uri.parse('untitled:/file.ts'))).toContain('not a Git Graph file');
		expect(await copyDiffFilePath()).toContain('not a Git Graph file');
		expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
	});
});

describe('Native multi-file Open File navigation', () => {
	let tab: any;
	let tabs: any[];
	let input: any;
	let close: jest.Mock;
	let navigation: { dispose: () => void };
	let open: jest.SpyInstance;
	const selection = { start: { line: 32, character: 4 }, end: { line: 32, character: 9 } };
	const settle = () => new Promise(resolve => setTimeout(resolve, 10));
	const changed = [{ type: GitFileStatus.Modified, oldFilePath: 'first.ts', newFilePath: 'first.ts', additions: 1, deletions: 1 }];
	const data = {} as DataSource;
	let notify: () => void;
	beforeAll(() => {
		const group = { get activeTab() { return tab; }, get tabs() { return tabs; } };
		Object.defineProperty(vscode.window, 'tabGroups', { configurable: true, value: { activeTabGroup: group, all: [group], close: (...args: any[]) => close(...args) } });
	});
	beforeEach(async () => {
		tab = { label: 'Git (project) • before ↔ after (1 file)' };
		tabs = [tab];
		close = jest.fn().mockResolvedValue(true);
		open = jest.spyOn(utils, 'openFile').mockResolvedValue(null);
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		expect(await viewAllDiffs(repo, 'before', 'after', changed, null)).toBeNull();
		input = vscode.commands.executeCommand.mock.calls[0][1];
		vscode.window.activeTextEditor = { document: { uri: input.resources[0].modifiedUri }, selection };
		navigation = registerMultiDiffFileNavigation(data);
		notify = vscode.window.onDidChangeActiveTextEditor.mock.calls[0][0];
		await settle();
	});
	afterEach(() => { navigation.dispose(); open.mockRestore(); });
	afterAll(() => Reflect.deleteProperty(vscode.window, 'tabGroups'));

	const activate = (uri: vscode.Uri) => {
		tab = { label: 'file.ts', input: { uri } };
		tabs.push(tab);
		vscode.window.activeTextEditor = { document: { uri }, selection };
		notify();
		return tab;
	};

	it('Opens the current working file at the native-transferred selection and closes only the snapshot tab', async () => {
		const snapshot = activate(input.resources[0].modifiedUri);
		await settle();
		expect(open).toHaveBeenCalledWith(repo, 'first.ts', 'after', data, vscode.ViewColumn.Active, selection);
		expect(close).toHaveBeenCalledWith(snapshot, true);
		expect(tabs[0].label).toContain('Git (project)');
	});

	it('Also redirects an original-side snapshot of a deleted file through normal working-file lookup', async () => {
		activate(input.resources[0].originalUri);
		await settle();
		expect(open).toHaveBeenCalledWith(repo, 'first.ts', 'before', data, vscode.ViewColumn.Active, selection);
	});

	it('Retains navigation after restoring a native tab with no two-sided entries', async () => {
		tab = { label: tab.label, input: { textDiffs: [] } };
		tabs = [tab];
		notify();
		await settle();
		activate(input.resources[0].modifiedUri);
		await settle();
		expect(open).toHaveBeenCalledWith(repo, 'first.ts', 'after', data, vscode.ViewColumn.Active, selection);
	});

	it('Leaves native working-file navigation and unrelated snapshots alone', async () => {
		activate(vscode.Uri.file(repo + '/first.ts'));
		await settle();
		expect(open).not.toHaveBeenCalled();
		activate(encodeDiffDocUri('/elsewhere', 'unrelated.ts', 'hash', GitFileStatus.Modified, DiffSide.New));
		await settle();
		expect(open).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});

	it('Does not turn an ordinary single-file diff into a working file', async () => {
		const uri = input.resources[0].modifiedUri;
		tab = { label: 'Another diff', input: { original: input.resources[0].originalUri, modified: uri } };
		vscode.window.activeTextEditor = { document: { uri }, selection };
		notify();
		await settle();
		expect(open).not.toHaveBeenCalled();
	});

	it('Reports a missing working file without creating or discarding files', async () => {
		open.mockResolvedValueOnce('The file no longer exists.');
		vscode.window.showErrorMessage.mockResolvedValueOnce(undefined);
		activate(input.resources[0].modifiedUri);
		await settle();
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Unable to Open File: The file no longer exists.');
		expect(close).not.toHaveBeenCalled();
	});

	it('Retains the source through a transient missing active tab while a native file opens', async () => {
		tab = undefined;
		notify();
		await settle();
		activate(input.resources[0].modifiedUri);
		await settle();
		expect(open).toHaveBeenCalledWith(repo, 'first.ts', 'after', data, vscode.ViewColumn.Active, selection);
	});

	it('Waits for the active editor to match a newly activated file tab before redirecting', async () => {
		const uri = input.resources[0].modifiedUri;
		tab = { label: 'file.ts', input: { uri } };
		tabs.push(tab);
		vscode.window.activeTextEditor = { document: { uri: input.resources[0].originalUri }, selection };
		notify();
		await settle();
		expect(open).not.toHaveBeenCalled();
		vscode.window.activeTextEditor = { document: { uri }, selection };
		notify();
		await settle();
		expect(open).toHaveBeenCalledWith(repo, 'first.ts', 'after', data, vscode.ViewColumn.Active, selection);
	});

	it('Pins a restored preview summary before native Open File can replace it', async () => {
		tab.isPreview = true;
		vscode.commands.executeCommand.mockResolvedValueOnce(undefined);
		notify();
		await settle();
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.keepEditor');
	});

	it('Does not redirect when closing the source diff activates an older snapshot tab', async () => {
		const snapshot = activate(input.resources[0].modifiedUri);
		tabs = [snapshot];
		await settle();
		expect(open).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});

	it('Disposes the observer and cancels a pending redirect', async () => {
		activate(input.resources[0].modifiedUri);
		navigation.dispose();
		await settle();
		expect(open).not.toHaveBeenCalled();
		expect(vscode.window.onDidChangeActiveTextEditor.mock.results[0].value.dispose).toHaveBeenCalled();
	});
});
