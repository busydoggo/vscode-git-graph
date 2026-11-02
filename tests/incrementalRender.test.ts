import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';
import { GitCommit } from '../src/types';

const { JSDOM } = require('jsdom');
const script = ['utils', 'dom', 'graph', 'findWidget', 'main'].map(name => {
	let source = fs.readFileSync(path.join(__dirname, '../web/' + name + '.ts'), 'utf8');
	if (name === 'main') source = source.slice(0, source.indexOf('/* Main */')) + source.slice(source.indexOf('function generateFileViewHtml('));
	return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2015 } }).outputText;
}).join('\n');

function commit(hash: string, parents: string[] = [], message: string = 'Fix ' + hash): GitCommit {
	return { hash, parents, message, author: 'Alice', email: 'alice@example.com', date: 1700000000, heads: [], tags: [], remotes: [], stash: null };
}

function setup(commits = [commit('a', ['b']), commit('b')]) {
	const dom = new JSDOM('<body><div id="view"><div id="content"><div id="commitGraph"></div><div id="commitTable"></div></div><div id="footer"></div></div></body>');
	const document = dom.window.document, sent = jest.fn();
	dom.window.HTMLElement.prototype.scroll = function (this: any, _x: number, y: number) { this.scrollTop = y; };
	const config = {
		fetchAvatars: false, markdown: false, dateFormat: { type: 0, iso: true },
		onRepoLoad: { scrollToHead: false },
		referenceLabels: { tagLabelsOnRight: true, combineLocalAndRemoteBranchLabels: true },
		commitDetailsView: { fileTreeCompactFolders: false },
		graph: { grid: { x: 16, y: 24, offsetX: 16, offsetY: 12, expandY: 100 }, colours: ['red', 'blue'], style: 0, uncommittedChanges: 0 }
	};
	const dialog = { showError: jest.fn(), showConfirmation: jest.fn(), closeActionRunning: jest.fn(), isOpen: () => false, isTargetDynamicSource: () => false };
	const { View, Graph, FindWidget, Renderer } = vm.runInNewContext(script + '\n({View: GitGraphView, Graph, FindWidget, Renderer: CommitTableRenderer});', {
		document, window: dom.window, getComputedStyle: dom.window.getComputedStyle, setTimeout: jest.fn(), clearTimeout: jest.fn(),
		initialState: { config }, acquireVsCodeApi: () => ({ postMessage: sent }),
		dialog, contextMenu: { isOpen: () => false, isTargetDynamicSource: () => false },
		GG: { FileViewType: { List: 1 }, GitFileStatus: { Modified: 'M', Deleted: 'D', Added: 'A', Untracked: 'U', Renamed: 'R' }, DateFormatType: { DateAndTime: 0, DateOnly: 1 }, GraphStyle: { Angular: 0 }, GraphUncommittedChangesStyle: { OpenCircleAtTheUncommittedChanges: 0, OpenCircleAtTheCheckedOutCommit: 1 } },
		CLASS_INTERNAL_URL: 'internalUrl', CLASS_EXTERNAL_URL: 'externalUrl', TargetType: { CommitDetailsView: 'cdv' },
		TextFormatter: class { public format(value: string) { return value; } },
		ResizeObserver: class { public observe() { } public disconnect() { } }
	});
	const view = Object.assign(Object.create(View.prototype), {
		commits, loadedCommits: commits, commitLookup: {}, commitHead: 'a', gitBranchHead: 'main',
		authorFilter: '', currentRepo: '/repo', gitRepos: { '/repo': { issueLinkingConfig: null } }, config, avatars: {}, gitBranches: [], gitTags: [], onlyFollowFirstParent: false,
		currentRepoLoading: false, currentRepoRefreshState: { inProgress: false, hard: false, loadCommitsRefreshId: 0, repoInfoChanges: false },
		viewElem: document.getElementById('view'), tableElem: document.getElementById('commitTable'), footerElem: document.getElementById('footer'),
		tableRenderer: new Renderer(), branchLabelLayouts: new WeakMap(), commitDetailsRenderState: null, copyCommitDiffInProgress: false, viewAllDiffsInProgress: false, fileActionInProgress: false, gitConfig: null,
		authorFilterInput: document.createElement('input'), authorFilterWidget: document.createElement('div'), authorFilterClear: document.createElement('button'),
		expandedCommit: null, moreCommitsAvailable: true, graphHeaderResizeObserver: null,
		branchDropdown: { mount: jest.fn(), refresh: jest.fn() }, makeTableResizable: jest.fn(), updateGraphHeaderLayout: jest.fn(),
		saveState: jest.fn(), scrollToCommit: jest.fn(), loadMoreCommits: jest.fn(), requestCommitDetails: jest.fn(), requestCommitComparison: jest.fn(),
		getColumnVisibility: () => ({ date: true, author: true, commit: true }), isCdvDocked: () => false,
		requestAvatars: jest.fn(), finaliseRepoLoad: jest.fn(), updateToolbarState: jest.fn(),
		showCommitDetails: jest.fn(), showCommitComparison: jest.fn(), loadCommitDetails: jest.fn(), renderCommitDetailsView: jest.fn(),
		getFileViewType: () => 1, setCdvHeight: jest.fn(), setCdvDivider: jest.fn(), makeCdvResizable: jest.fn(), makeCdvDividerDraggable: jest.fn(), makeCdvFileViewInteractive: jest.fn()
	});
	view.authorFilterWidget.appendChild(view.authorFilterInput);
	view.findWidget = new FindWidget(view);
	view.graph = new Graph('commitGraph', view.viewElem, config.graph, { commitsNotAncestorsOfHead: false, mergeCommits: false });
	const update = (next = commits) => {
		view.commits = view.loadedCommits = next;
		view.commitLookup = {};
		next.forEach((item, index) => { view.commitLookup[item.hash] = index; });
		view.graph.loadCommits(next, view.commitHead, view.commitLookup, false, next);
		view.renderTable();
		view.graph.render(view.expandedCommit);
	};
	update();
	return { dom, document, view, sent, dialog, update, renderDetails: () => View.prototype.renderCommitDetailsView.call(view, true), showDetails: (details: any, tree: any) => View.prototype.showCommitDetails.call(view, details, tree, null, null, null, true), wireFiles: () => View.prototype.makeCdvFileViewInteractive.call(view), row: (hash: string) => document.querySelector('tr[data-hash="' + hash + '"]') };
}

function openDetails(view: any, row: (hash: string) => any, hash: string, parents: string[] = ['b']) {
	view.expandedCommit = {
		index: view.commitLookup[hash], commitHash: hash, commitElem: row(hash), compareWithHash: null, compareWithElem: null, loading: false,
		commitDetails: { hash, parents, author: 'Alice', authorEmail: '', authorDate: 1700000000, committer: 'Alice', committerEmail: '', committerDate: 1700000000, signature: null, body: 'Commit body' },
		fileChanges: [], fileTree: { type: 'folder', name: '', folderPath: '', open: true, reviewed: true, contents: {} },
		avatar: null, codeReview: null, lastViewedFile: null, contextMenuOpen: { summary: false, fileView: -1 }, scrollTop: { summary: 0, fileView: 0 }
	};
	view.renderGraph = jest.fn();
}

describe('Incremental Git Graph rendering', () => {
	it.each([null, 'fatal: bad revision \'HEAD\''])('Shows an empty repository inline without a dialog and recovers after the first commit (error: %s)', error => {
		const { document, view, row, dialog } = setup();
		const header = document.getElementById('tableColHeaders');
		view.currentRepoLoading = true;
		Object.assign(view.currentRepoRefreshState, { inProgress: true, hard: true, loadCommitsRefreshId: 1 });
		const empty = { command: 'loadCommits', refreshId: 1, commits: [], head: null, tags: [], moreCommitsAvailable: false, onlyFollowFirstParent: false, error };
		view.processLoadCommitsResponse(empty);
		const message = document.getElementById('noCommitsMessage');
		expect(message.textContent).toBe('There are no commits in this repository.');
		expect(message.closest('#view')).not.toBeNull();
		expect(document.querySelectorAll('tr.commit')).toHaveLength(0);
		expect(dialog.showError).not.toHaveBeenCalled();
		expect(dialog.closeActionRunning).toHaveBeenCalledTimes(1);
		expect(view.currentRepoLoading).toBe(false);
		expect(view.currentRepoRefreshState.inProgress).toBe(false);
		expect(view.finaliseRepoLoad).toHaveBeenCalledWith(true);
		Object.assign(view.currentRepoRefreshState, { inProgress: true, hard: false, loadCommitsRefreshId: 2 });
		view.processLoadCommitsResponse({ ...empty, refreshId: 2 });
		expect(document.getElementById('noCommitsMessage')).toBe(message);
		view.gitBranches = ['main'];
		Object.assign(view.currentRepoRefreshState, { inProgress: true, loadCommitsRefreshId: 3 });
		view.processLoadCommitsResponse({ ...empty, refreshId: 3, commits: [commit('first')], head: 'first', error: null });
		expect(document.getElementById('noCommitsMessage')).toBeNull();
		expect(row('first')).not.toBeNull();
		expect(document.getElementById('tableColHeaders')).toBe(header);
		expect(dialog.showError).not.toHaveBeenCalled();
	});

	it('Distinguishes an empty filter result from an empty repository', () => {
		const { document, view, update } = setup([]);
		view.gitBranches = ['main'];
		update([]);
		expect(document.getElementById('noCommitsMessage').textContent).toBe('No commits match the current filters.');
		expect(document.getElementById('loadMoreCommitsBtn')).not.toBeNull();
	});

	it('Ignores outdated empty-repository errors after another refresh has started', () => {
		const { document, view, row, dialog } = setup();
		const existing = row('a');
		Object.assign(view.currentRepoRefreshState, { inProgress: true, loadCommitsRefreshId: 2 });
		view.processLoadCommitsResponse({ refreshId: 1, error: 'fatal: bad revision \'HEAD\'' });
		expect(row('a')).toBe(existing);
		expect(document.getElementById('noCommitsMessage')).toBeNull();
		expect(view.currentRepoRefreshState.inProgress).toBe(true);
		expect(dialog.showError).not.toHaveBeenCalled();
	});

	it('Reports actual Git failures and recovers to an inline empty state when retried', () => {
		const { document, view, dialog } = setup();
		view.gitBranchHead = null;
		Object.assign(view.currentRepoRefreshState, { inProgress: true, loadCommitsRefreshId: 1 });
		view.processLoadCommitsResponse({ refreshId: 1, error: 'fatal: permission denied' });
		expect(dialog.showError).toHaveBeenCalledWith('Unable to load Commits', 'fatal: permission denied', 'Retry', expect.any(Function));
		expect(document.getElementById('noCommitsMessage')).toBeNull();
		Object.assign(view.currentRepoRefreshState, { inProgress: true, loadCommitsRefreshId: 2 });
		view.processLoadCommitsResponse({ refreshId: 2, commits: [], head: null, tags: [], moreCommitsAvailable: false, onlyFollowFirstParent: false, error: null });
		expect(document.getElementById('noCommitsMessage').textContent).toBe('There are no commits in this repository.');
		expect(dialog.showError).toHaveBeenCalledTimes(1);
	});

	it('Inserts and removes only affected rows while preserving the header, cells and input focus', () => {
		const { document, view, update, row } = setup();
		const a = row('a'), b = row('b'), author = a.querySelector('.authorCol');
		const header = document.getElementById('tableColHeaders');
		view.authorFilterInput.value = 'Ali';
		view.authorFilterInput.focus();
		view.authorFilterInput.setSelectionRange(1, 2);
		update([commit('c', ['a']), commit('a', ['b']), commit('b')]);
		expect(row('a')).toBe(a);
		expect(row('b')).toBe(b);
		expect(a.querySelector('.authorCol')).toBe(author);
		expect(document.getElementById('tableColHeaders')).toBe(header);
		expect(document.activeElement).toBe(view.authorFilterInput);
		expect(view.authorFilterInput.selectionStart).toBe(1);
		expect(view.authorFilterInput.selectionEnd).toBe(2);
		expect(Array.from(document.querySelectorAll('tr.commit'), (elem: any) => elem.dataset.hash)).toEqual(['c', 'a', 'b']);
		expect(a.dataset.id).toBe('1');
		update([commit('c', ['b']), commit('b')]);
		expect(row('a')).toBeNull();
		expect(row('b')).toBe(b);
		expect(view.makeTableResizable).toHaveBeenCalledTimes(1);
	});

	it('Updates a changed description while leaving unchanged cells and rows untouched', () => {
		const { dom, row, update } = setup();
		const a = row('a'), b = row('b'), author = a.querySelector('.authorCol');
		const observer = new dom.window.MutationObserver(() => { });
		observer.observe(b, { subtree: true, childList: true, attributes: true, characterData: true });
		update([commit('a', ['b'], 'Updated description'), commit('b')]);
		expect(a.querySelector('.description').textContent).toBe('Updated description');
		expect(a.querySelector('.authorCol')).toBe(author);
		expect(observer.takeRecords()).toHaveLength(0);
	});

	it('Retains existing search highlights and updates matches only for changed descriptions', () => {
		const { dom, document, view, row, update } = setup();
		const input = document.getElementById('findInput');
		input.value = 'Fix';
		input.dispatchEvent(new dom.window.Event('input'));
		const highlight = row('b').querySelector('.findMatch');
		input.focus();
		input.setSelectionRange(1, 2);
		update([commit('a', ['b'], 'Other change'), commit('b')]);
		expect(row('b').querySelector('.findMatch')).toBe(highlight);
		expect(row('a').querySelector('.findMatch')).toBeNull();
		expect(view.findWidget.getCurrentHash()).toBe('b');
		expect(document.activeElement).toBe(input);
		expect(input.selectionStart).toBe(1);
	});

	it('Restores active search highlights when changing visible columns', () => {
		const { dom, document, view, row, update } = setup();
		const input = document.getElementById('findInput');
		input.value = 'Fix';
		input.dispatchEvent(new dom.window.Event('input'));
		input.focus();
		input.setSelectionRange(1, 2);
		const a = row('a');
		view.getColumnVisibility = () => ({ date: false, author: true, commit: true });
		update();
		expect(row('a')).toBe(a);
		expect(document.querySelectorAll('.findMatch')).toHaveLength(2);
		expect(document.querySelector('.dateCol')).toBeNull();
		expect(document.activeElement).toBe(input);
		expect(input.selectionStart).toBe(1);
	});

	it('Keeps the summary, search highlights and existing labels when branches and tags change', () => {
		const { dom, document, view, row, update } = setup();
		const input = document.getElementById('findInput');
		input.value = 'Fix';
		input.dispatchEvent(new dom.window.Event('input'));
		const summary = row('a').querySelector('.commitSummary');
		const text = summary.querySelector('.text'), highlight = text.querySelector('.findMatch');
		update([{ ...commit('a', ['b']), heads: ['main', 'topic'], tags: [{ name: 'v1', annotated: true }] }, commit('b')]);
		const group = row('a').querySelector('.commitBranches');
		const topic = group.querySelector('[data-name="topic"]');
		expect(row('a').querySelector('.commitSummary')).toBe(summary);
		expect(summary.querySelector('.text')).toBe(text);
		expect(summary.querySelector('.findMatch')).toBe(highlight);
		update([{ ...commit('a', ['b']), heads: ['topic', 'extra'] }, commit('b')]);
		expect(row('a').querySelector('.commitBranches')).toBe(group);
		expect(group.querySelector('[data-name="topic"]')).toBe(topic);
		expect(group.querySelector('[data-name="main"]')).toBeNull();
		expect(summary.querySelector('[data-name="v1"]')).toBeNull();
		view.commitHead = 'b';
		update();
		expect(row('a').querySelector('.commitBranches')).toBeNull();
		expect(row('a').querySelector('.commitSummary')).toBe(summary);
		expect(summary.querySelector('.text')).toBe(text);
		expect(summary.querySelector('.findMatch')).toBe(highlight);
		expect(view.findWidget.getCurrentHash()).toBe('a');
	});

	it('Updates uncommitted changes without replacing the table header or other rows', () => {
		const { dom, document, view, row } = setup([commit('*', ['a'], '1 change'), commit('a')]);
		const header = document.getElementById('tableColHeaders'), changes = row('*');
		const description = changes.querySelector('.description');
		const observer = new dom.window.MutationObserver(() => { });
		observer.observe(row('a'), { subtree: true, attributes: true, characterData: true, childList: true });
		view.commits[0] = commit('*', ['a'], '2 changes');
		view.renderUncommittedChanges();
		expect(document.getElementById('tableColHeaders')).toBe(header);
		expect(row('*')).toBe(changes);
		expect(changes.querySelector('.description')).toBe(description);
		expect(description.textContent).toBe('2 changes');
		expect(observer.takeRecords()).toHaveLength(0);
	});

	it('Recalculates incremental matches and rejects newly encountered empty regex matches', () => {
		const { dom, document, view, row, update } = setup();
		const input = document.getElementById('findInput');
		input.value = 'Fix|(?=Other)';
		input.dispatchEvent(new dom.window.Event('input'));
		document.getElementById('findMode').click();
		expect(document.querySelectorAll('.findMatch')).toHaveLength(2);
		update([commit('a', ['b'], 'Other change'), commit('b')]);
		expect(document.querySelectorAll('.findMatch, .findCurrentCommit')).toHaveLength(0);
		expect(input.getAttribute('aria-invalid')).toBe('true');
		update([commit('a', ['b']), commit('b')]);
		expect(input.getAttribute('aria-invalid')).toBe('false');
		expect(row('a').querySelector('.findMatch')).not.toBeNull();
		expect(row('b').querySelector('.findMatch')).not.toBeNull();
		expect(view.findWidget.getCurrentHash()).toBe('a');
	});

	it('Keeps open commit details and the load-more listener when rows are inserted', () => {
		const { document, view, row, update } = setup();
		const details = document.createElement('tr');
		details.id = 'cdv';
		details.innerHTML = '<td>Open file tree</td>';
		row('b').after(details);
		view.expandedCommit = { index: 1, commitHash: 'b', commitElem: row('b'), compareWithHash: null, compareWithElem: null, loading: false };
		const button = document.getElementById('loadMoreCommitsBtn');
		update([commit('c', ['a']), commit('a', ['b']), commit('b')]);
		expect(document.getElementById('cdv')).toBe(details);
		expect(row('b').nextElementSibling).toBe(details);
		expect(view.expandedCommit.index).toBe(2);
		expect(view.showCommitDetails).not.toHaveBeenCalled();
		button.click();
		expect(view.loadMoreCommits).toHaveBeenCalledTimes(1);
	});

	it('Reuses SVG circles and paths and only updates their changed attributes', () => {
		const { dom, document, update } = setup();
		const svg = document.querySelector('#commitGraph svg'), group = svg.lastElementChild;
		const circle = group.querySelector('[data-key="commit:a:outer"]');
		const path = group.querySelector('path');
		const observer = new dom.window.MutationObserver(() => { });
		observer.observe(svg, { subtree: true, attributes: true, childList: true });
		update([commit('a', ['b'], 'Only the message changed'), commit('b')]);
		expect(observer.takeRecords()).toHaveLength(0);
		update([commit('c', ['a']), commit('a', ['b']), commit('b')]);
		expect(svg.lastElementChild).toBe(group);
		expect(group.querySelector('[data-key="commit:a:outer"]')).toBe(circle);
		expect(group.querySelector('path')).toBe(path);
		expect(circle.dataset.id).toBe('1');
		expect(circle.getAttribute('cy')).toBe('36');
	});

	it('Keeps SVG hover listeners valid after insertion and clears the correct row highlight', () => {
		const { dom, document, row, update } = setup();
		const circle = document.querySelector('[data-key="commit:a:outer"]');
		circle.dispatchEvent(new dom.window.MouseEvent('mouseover'));
		expect(row('a').classList.contains('graphVertexActive')).toBe(true);
		update([commit('c', ['a']), commit('a', ['b']), commit('b')]);
		expect(row('a').classList.contains('graphVertexActive')).toBe(false);
		circle.dispatchEvent(new dom.window.MouseEvent('mouseover'));
		expect(row('a').classList.contains('graphVertexActive')).toBe(true);
		expect(row('c').classList.contains('graphVertexActive')).toBe(false);
		circle.dispatchEvent(new dom.window.MouseEvent('mouseout'));
		expect(row('a').classList.contains('graphVertexActive')).toBe(false);
	});

	it('Adjusts automatic graph width in both directions without accumulating padding', () => {
		const { document, view } = setup();
		const header = document.getElementById('tableHeaderGraphCol');
		header.style.padding = '6px 8px';
		Object.defineProperty(header, 'offsetWidth', { get: () => 84 + parseFloat(header.style.paddingLeft) * 2 });
		Object.defineProperty(view.viewElem, 'clientWidth', { value: 900 });
		let width = 150;
		view.graph = { getContentWidth: () => width, limitMaxWidth: jest.fn() };
		view.updateAutoGraphWidth();
		expect(header.offsetWidth).toBe(150);
		width = 180;
		view.updateAutoGraphWidth();
		expect(header.offsetWidth).toBe(180);
		width = 400;
		view.updateAutoGraphWidth();
		view.updateAutoGraphWidth();
		expect(header.offsetWidth).toBe(300);
		expect(view.tableElem.className).toBe('limitGraphWidth');
		width = 64;
		view.updateAutoGraphWidth();
		expect(header.offsetWidth).toBe(108);
		expect(view.tableElem.classList.contains('limitGraphWidth')).toBe(false);
	});

	it('Preserves details controls and scroll containers and only replaces changed panel content', () => {
		const { dom, document, view, row, renderDetails } = setup();
		view.renderGraph = jest.fn();
		view.expandedCommit = {
			index: 0, commitHash: 'a', commitElem: row('a'), compareWithHash: null, compareWithElem: null, loading: false,
			commitDetails: { hash: 'a', parents: ['b'], author: 'Alice', authorEmail: '', authorDate: 1700000000, committer: 'Alice', committerEmail: '', committerDate: 1700000000, signature: null, body: 'Commit body' },
			fileChanges: [], fileTree: { type: 'folder', name: '', folderPath: '', open: true, reviewed: true, contents: {} },
			avatar: null, codeReview: null, lastViewedFile: null, contextMenuOpen: { summary: false, fileView: -1 }, scrollTop: { summary: 0, fileView: 0 }
		};
		renderDetails();
		const details = document.getElementById('cdv'), summary = document.getElementById('cdvSummary'), files = document.getElementById('cdvFiles'), close = document.getElementById('cdvClose');
		const observer = new dom.window.MutationObserver(() => { });
		observer.observe(details, { subtree: true, attributes: true, childList: true, characterData: true });
		files.scrollTop = 42;
		renderDetails();
		expect(observer.takeRecords()).toHaveLength(0);
		expect(files.scrollTop).toBe(42);
		view.expandedCommit.fileChanges = [{ type: 'M', oldFilePath: 'test.ts', newFilePath: 'test.ts', additions: 1, deletions: 0 }];
		view.expandedCommit.fileTree.contents = { 'test.ts': { type: 'file', name: 'test.ts', index: 0, reviewed: true } };
		renderDetails();
		expect(document.getElementById('cdv')).toBe(details);
		expect(document.getElementById('cdvSummary')).toBe(summary);
		expect(document.getElementById('cdvFiles')).toBe(files);
		expect(document.getElementById('cdvClose')).toBe(close);
		expect(files.textContent).toContain('test.ts');
		const viewAll = document.getElementById('cdvViewAllDiffs');
		expect(viewAll.disabled).toBe(false);
		expect(observer.takeRecords().every((mutation: any) => files.contains(mutation.target) || (mutation.target === viewAll && mutation.type === 'attributes' && mutation.attributeName === 'disabled'))).toBe(true);
		expect(view.makeCdvFileViewInteractive).toHaveBeenCalledTimes(2);
		view.closeCommitDetails = jest.fn();
		close.click();
		expect(view.closeCommitDetails).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ hash: 'a', parents: ['b', 'other-parent'], fromHash: 'b' },
		{ hash: 'b', parents: [], fromHash: null },
		{ hash: '*', parents: [], fromHash: 'HEAD' }
	])('Copies the displayed commit with the correct base (%j)', ({ hash, parents, fromHash }) => {
		const { document, view, row, sent, renderDetails } = setup(hash === '*' ? [commit('*', ['a']), commit('a')] : undefined);
		openDetails(view, row, hash, parents);
		renderDetails();
		const button = document.getElementById('cdvCopyDiff');
		expect(button.querySelector('svg')).not.toBeNull();
		expect(button.title).toContain('-U999999999');
		renderDetails();
		expect(document.getElementById('cdvCopyDiff')).toBe(button);
		button.click();
		view.copyExpandedCommitDiff();
		expect(sent).toHaveBeenCalledTimes(1);
		expect(sent).toHaveBeenLastCalledWith({ command: 'copyCommitDiff', repo: '/repo', fromHash, toHash: hash });
		expect(button.disabled).toBe(true);
		view.finishCopyCommitDiff();
		expect(button.disabled).toBe(false);
		button.click();
		expect(sent).toHaveBeenCalledTimes(2);
	});

	it.each(['a', 'b'])('Copies comparisons in their displayed order (open commit: %s)', hash => {
		const { document, view, row, sent, renderDetails } = setup();
		openDetails(view, row, hash);
		view.expandedCommit.compareWithHash = hash === 'a' ? 'b' : 'a';
		view.expandedCommit.compareWithElem = row(view.expandedCommit.compareWithHash);
		renderDetails();
		document.getElementById('cdvCopyDiff').click();
		expect(sent).toHaveBeenLastCalledWith({ command: 'copyCommitDiff', repo: '/repo', fromHash: 'b', toHash: 'a' });
	});

	it.each([
		{ hash: 'a', parents: ['b', 'merge-parent'], fromHash: 'b', stash: null },
		{ hash: 'b', parents: [], fromHash: null, stash: null },
		{ hash: '*', parents: ['a'], fromHash: 'HEAD', stash: null },
		{ hash: 'a', parents: ['b'], fromHash: 'stash-base', stash: { selector: 'stash@{0}', baseHash: 'stash-base', untrackedFilesHash: 'stash-untracked' } }
	])('Opens all displayed changes in a single native editor with the correct base (%j)', ({ hash, parents, fromHash, stash }) => {
		const { document, view, row, sent, renderDetails } = setup(hash === '*' ? [commit('*', ['a']), commit('a')] : undefined);
		view.commits[view.commitLookup[hash]].stash = stash;
		openDetails(view, row, hash, parents);
		const files = [
			{ type: 'M', oldFilePath: 'first.ts', newFilePath: 'first.ts', additions: 1, deletions: 1 },
			{ type: 'A', oldFilePath: 'second.ts', newFilePath: 'second.ts', additions: 1, deletions: 0 }
		];
		view.expandedCommit.fileChanges = files;
		view.expandedCommit.fileTree = view.createFileTree(files, null);
		renderDetails();
		const button = document.getElementById('cdvViewAllDiffs');
		expect(button.querySelector('svg')).not.toBeNull();
		expect(button.disabled).toBe(false);
		button.click();
		view.viewExpandedCommitDiffs();
		expect(sent).toHaveBeenCalledTimes(1);
		expect(sent).toHaveBeenLastCalledWith({ command: 'viewAllDiffs', repo: '/repo', fromHash, toHash: hash, files, untrackedFilesHash: stash !== null ? stash.untrackedFilesHash : null });
		expect(button.disabled).toBe(true);
		renderDetails();
		expect(document.getElementById('cdvViewAllDiffs')).toBe(button);
		expect(button.disabled).toBe(true);
		view.finishViewAllDiffs();
		expect(button.disabled).toBe(false);
		button.click();
		expect(sent).toHaveBeenCalledTimes(2);
	});

	it.each(['a', 'b'])('Opens all changes in comparison order (open commit: %s)', hash => {
		const { document, view, row, sent, renderDetails } = setup();
		openDetails(view, row, hash);
		view.expandedCommit.compareWithHash = hash === 'a' ? 'b' : 'a';
		view.expandedCommit.compareWithElem = row(view.expandedCommit.compareWithHash);
		const files = [{ type: 'M', oldFilePath: 'file.ts', newFilePath: 'file.ts', additions: 1, deletions: 1 }];
		view.expandedCommit.fileChanges = files;
		view.expandedCommit.fileTree = view.createFileTree(files, null);
		renderDetails();
		document.getElementById('cdvViewAllDiffs').click();
		expect(sent).toHaveBeenLastCalledWith({ command: 'viewAllDiffs', repo: '/repo', fromHash: 'b', toHash: 'a', files, untrackedFilesHash: null });
	});

	it('Does not open all changes while loading or when no changed files exist', () => {
		const { document, view, row, sent, renderDetails } = setup();
		openDetails(view, row, 'a');
		view.expandedCommit.loading = true;
		renderDetails();
		expect(document.getElementById('cdvViewAllDiffs')).toBeNull();
		view.viewExpandedCommitDiffs();
		view.expandedCommit.loading = false;
		renderDetails();
		expect(document.getElementById('cdvViewAllDiffs').disabled).toBe(true);
		view.viewExpandedCommitDiffs();
		expect(sent).not.toHaveBeenCalled();
	});

	it.each([0, 1])('Restores uncommitted files from HEAD without opening their diff, including after refresh (file view: %i)', type => {
		const { dom, document, view, row, sent, renderDetails, wireFiles } = setup([commit('*', ['a']), commit('a')]);
		view.getFileViewType = () => type;
		view.makeCdvFileViewInteractive = wireFiles;
		openDetails(view, row, '*');
		const files = [
			{ type: 'M', oldFilePath: 'dir/[notes].txt', newFilePath: 'dir/[notes].txt', additions: 1, deletions: 1 },
			{ type: 'D', oldFilePath: 'deleted.txt', newFilePath: 'deleted.txt', additions: 0, deletions: 1 },
			{ type: 'U', oldFilePath: 'untracked.txt', newFilePath: 'untracked.txt', additions: null, deletions: null },
			{ type: 'A', oldFilePath: 'added.txt', newFilePath: 'added.txt', additions: 1, deletions: 0 },
			{ type: 'R', oldFilePath: 'old.txt', newFilePath: 'renamed.txt', additions: 0, deletions: 0 }
		];
		view.expandedCommit.fileChanges = files;
		view.expandedCommit.fileTree = view.createFileTree(files, null);
		renderDetails();
		const button = (index: number) => document.querySelector('.fileTreeFileRecord[data-index="' + index + '"] .revertGitFile');
		expect(document.querySelectorAll('.revertGitFile')).toHaveLength(4);
		expect(document.querySelectorAll('.deleteUntrackedGitFile')).toHaveLength(1);
		expect(button(2)).toBeNull();
		expect(button(0).parentElement.lastElementChild).toBe(button(0));
		[3, 4].forEach(index => {
			expect(button(index).disabled).toBe(true);
			button(index).click();
		});
		expect(sent).not.toHaveBeenCalled();
		button(0).querySelector('path').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		button(0).click();
		expect(sent).toHaveBeenCalledTimes(1);
		expect(sent).toHaveBeenLastCalledWith({ command: 'resetFileToRevision', repo: '/repo', commitHash: 'HEAD', filePath: 'dir/[notes].txt' });
		expect(button(0).disabled).toBe(true);
		renderDetails();
		expect(button(0).disabled).toBe(true);
		view.finishFileAction();
		expect(button(0).disabled).toBe(false);
		expect(document.querySelector('.deleteUntrackedGitFile').disabled).toBe(false);
		button(1).click();
		expect(sent).toHaveBeenLastCalledWith({ command: 'resetFileToRevision', repo: '/repo', commitHash: 'HEAD', filePath: 'deleted.txt' });
		view.finishFileAction();
		view.expandedCommit.fileChanges = files.slice(1);
		view.expandedCommit.fileTree = view.createFileTree(files.slice(1), null);
		renderDetails();
		expect(document.querySelectorAll('.revertGitFile')).toHaveLength(3);
		expect(document.getElementById('cdvFiles').textContent).not.toContain('[notes].txt');
	});

	it.each([0, 1])('Requires confirmation before deleting an untracked file and keeps the delete action right-aligned (file view: %i)', type => {
		const { dom, document, view, row, sent, dialog, renderDetails, wireFiles } = setup([commit('*', ['a']), commit('a')]);
		view.getFileViewType = () => type;
		view.makeCdvFileViewInteractive = wireFiles;
		openDetails(view, row, '*');
		const files = [
			{ type: 'U', oldFilePath: 'dir/<new>&[draft].txt', newFilePath: 'dir/<new>&[draft].txt', additions: null, deletions: null },
			{ type: 'M', oldFilePath: 'tracked.txt', newFilePath: 'tracked.txt', additions: 1, deletions: 1 }
		];
		view.expandedCommit.fileChanges = files;
		view.expandedCommit.fileTree = view.createFileTree(files, null);
		renderDetails();
		const button = () => document.querySelector('.deleteUntrackedGitFile');
		expect(document.querySelector('.fileTreeFileRecord[data-index="0"] .revertGitFile')).toBeNull();
		expect(document.querySelector('.fileTreeFileRecord[data-index="1"] .revertGitFile')).not.toBeNull();
		expect(button().parentElement.lastElementChild).toBe(button());
		expect(button().parentElement.parentElement.lastElementChild).toBe(button().parentElement);
		expect(button().title).toBe('Delete Untracked File');
		expect(button().disabled).toBe(false);
		view.deleteUntrackedFile(files[1], button().closest('.fileTreeFileRecord'));
		expect(dialog.showConfirmation).not.toHaveBeenCalled();
		button().querySelector('path').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		expect(dialog.showConfirmation).toHaveBeenCalledTimes(1);
		const [message, label, confirm, target] = dialog.showConfirmation.mock.calls[0];
		expect(message).toContain('permanently delete');
		expect(message).toContain('&lt;new&gt;&amp;[draft].txt');
		const prompt = document.createElement('div');
		prompt.innerHTML = message;
		expect(prompt.textContent).toContain(files[0].newFilePath);
		expect(message).not.toContain('<new>');
		expect(label).toBe('Yes, delete file');
		expect(target.elem).toBe(button().closest('.fileTreeFileRecord'));
		expect(sent).not.toHaveBeenCalled();
		expect(view.fileActionInProgress).toBe(false);
		confirm();
		confirm();
		expect(sent).toHaveBeenCalledTimes(1);
		expect(sent).toHaveBeenLastCalledWith({ command: 'deleteUntrackedFile', repo: '/repo', filePath: 'dir/<new>&[draft].txt' });
		expect(button().disabled).toBe(true);
		renderDetails();
		expect(button().disabled).toBe(true);
		view.finishFileAction();
		expect(button().disabled).toBe(false);
		view.expandedCommit.fileChanges = files.slice(1);
		view.expandedCommit.fileTree = view.createFileTree(files.slice(1), null);
		renderDetails();
		expect(button()).toBeNull();
		expect(document.getElementById('cdvFiles').textContent).toContain('tracked.txt');
	});

	it.each([0, 1])('Cancels deletion in the real confirmation dialog and deletes only after Yes is clicked (file view: %i)', type => {
		const { dom, document, view, row, sent, dialog, renderDetails, wireFiles } = setup([commit('*', ['a']), commit('a')]);
		const dialogScript = ['utils', 'dom', 'dialog'].map(name => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../web/' + name + '.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2015 } }).outputText).join('\n');
		let actualDialog: any;
		const RealDialog = vm.runInNewContext(dialogScript + '\nDialog;', {
			document, window: dom.window, acquireVsCodeApi: () => ({ postMessage: sent }), TargetType: { Repo: 'repo' }, eventOverlay: { create: jest.fn(), remove: jest.fn() }, closeDialogAndContextMenu: () => actualDialog.close()
		});
		actualDialog = new RealDialog();
		const showConfirmation = jest.spyOn(actualDialog, 'showConfirmation');
		dialog.showConfirmation = actualDialog.showConfirmation.bind(actualDialog);
		dialog.isOpen = () => actualDialog.isOpen();
		view.getFileViewType = () => type;
		view.makeCdvFileViewInteractive = wireFiles;
		openDetails(view, row, '*');
		const files = [{ type: 'U', oldFilePath: 'new.txt', newFilePath: 'new.txt', additions: null, deletions: null }];
		view.expandedCommit.fileChanges = files;
		view.expandedCommit.fileTree = view.createFileTree(files, null);
		renderDetails();
		const button = document.querySelector('.deleteUntrackedGitFile');
		expect(button.disabled).toBe(false);
		expect(actualDialog.isOpen()).toBe(false);
		button.click();
		expect(showConfirmation).toHaveBeenCalledTimes(1);
		if (showConfirmation.mock.results[0].type === 'throw') throw showConfirmation.mock.results[0].value;
		expect(actualDialog.isOpen()).toBe(true);
		expect(document.querySelector('.dialogContent').textContent).toContain('new.txt');
		expect(document.getElementById('dialogSecondaryAction').textContent).toBe('Cancel');
		expect(sent).not.toHaveBeenCalled();
		document.getElementById('dialogSecondaryAction').click();
		expect(document.querySelector('.dialog')).toBeNull();
		expect(sent).not.toHaveBeenCalled();
		expect(view.fileActionInProgress).toBe(false);
		button.click();
		document.getElementById('dialogAction').click();
		expect(document.querySelector('.dialog')).toBeNull();
		expect(sent).toHaveBeenCalledTimes(1);
		expect(sent).toHaveBeenLastCalledWith({ command: 'deleteUntrackedFile', repo: '/repo', filePath: 'new.txt' });
	});

	it.each(['staged', 'repo changed', 'comparison', 'historical commit', 'file removed'])('Rejects a stale delete confirmation when %s', change => {
		const { document, view, row, sent, dialog, renderDetails, wireFiles } = setup([commit('*', ['a']), commit('a')]);
		view.makeCdvFileViewInteractive = wireFiles;
		openDetails(view, row, '*');
		const files = [{ type: 'U', oldFilePath: 'new.txt', newFilePath: 'new.txt', additions: null, deletions: null }];
		view.expandedCommit.fileChanges = files;
		view.expandedCommit.fileTree = view.createFileTree(files, null);
		renderDetails();
		document.querySelector('.deleteUntrackedGitFile').click();
		const confirm = dialog.showConfirmation.mock.calls[0][2];
		if (change === 'staged') view.expandedCommit.fileChanges = [{ ...files[0], type: 'A' }];
		else if (change === 'repo changed') view.currentRepo = '/other';
		else if (change === 'comparison') view.expandedCommit.compareWithHash = 'a';
		else if (change === 'historical commit') view.expandedCommit.commitHash = 'a';
		else view.expandedCommit.fileChanges = [];
		confirm();
		expect(sent).not.toHaveBeenCalled();
		expect(view.fileActionInProgress).toBe(false);
	});

	it.each([0, 1])('Aligns uncommitted file actions and updates staging controls without replacing the details shell (file view: %i)', type => {
		const { dom, document, view, row, sent, renderDetails, showDetails, wireFiles } = setup([commit('*', ['a']), commit('a')]);
		const style = document.createElement('style');
		style.textContent = fs.readFileSync(path.join(__dirname, '../web/styles/main.css'), 'utf8');
		document.head.appendChild(style);
		view.getFileViewType = () => type;
		view.makeCdvFileViewInteractive = wireFiles;
		view.renderCommitDetailsView = renderDetails;
		openDetails(view, row, '*');
		const files = [
			{ type: 'M', oldFilePath: 'dir/file.txt', newFilePath: 'dir/file.txt', additions: 1, deletions: 1, staging: { stagePaths: ['dir/file.txt'], unstagePaths: [] } },
			{ type: 'M', oldFilePath: 'partial.txt', newFilePath: 'partial.txt', additions: 1, deletions: 1, staging: { stagePaths: ['partial.txt'], unstagePaths: ['partial.txt'] } },
			{ type: 'A', oldFilePath: 'staged.txt', newFilePath: 'staged.txt', additions: 1, deletions: 0, staging: { stagePaths: [], unstagePaths: ['staged.txt'] } }
		];
		view.expandedCommit.fileChanges = files;
		view.expandedCommit.fileTree = view.createFileTree(files, null);
		renderDetails();
		const button = (index: number, action: string) => document.querySelector('.fileTreeFileRecord[data-index="' + index + '"] .' + action);
		expect(document.querySelectorAll('.stageGitFile')).toHaveLength(3);
		expect(document.querySelectorAll('.unstageGitFile')).toHaveLength(3);
		document.querySelectorAll('.fileTreeUncommittedActions').forEach((actions: any) => {
			expect(actions.parentElement.lastElementChild).toBe(actions);
			expect(actions.lastElementChild.classList.contains('revertGitFile')).toBe(true);
			expect(dom.window.getComputedStyle(actions.parentElement).display).toBe('flex');
			expect(dom.window.getComputedStyle(actions).marginLeft).toBe('auto');
		});
		expect(button(0, 'stageGitFile').disabled).toBe(false);
		expect(button(0, 'unstageGitFile').disabled).toBe(true);
		expect(button(1, 'stageGitFile').disabled).toBe(false);
		expect(button(1, 'unstageGitFile').disabled).toBe(false);
		expect(button(2, 'stageGitFile').disabled).toBe(true);
		expect(button(2, 'unstageGitFile').disabled).toBe(false);
		button(0, 'stageGitFile').querySelector('path').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		expect(sent).toHaveBeenCalledTimes(1);
		expect(sent).toHaveBeenLastCalledWith({ command: 'stageFiles', repo: '/repo', filePaths: ['dir/file.txt'] });
		document.querySelectorAll('.uncommittedFileAction').forEach((action: any) => expect(action.disabled).toBe(true));
		button(1, 'unstageGitFile').click();
		button(0, 'revertGitFile').click();
		expect(sent).toHaveBeenCalledTimes(1);
		renderDetails();
		expect(button(0, 'stageGitFile').disabled).toBe(true);
		view.finishFileAction();
		const details = document.getElementById('cdv'), container = document.getElementById('cdvFiles');
		const nextFiles = files.map((file, index) => index === 0 ? { ...file, staging: { stagePaths: [], unstagePaths: ['dir/file.txt'] } } : file);
		showDetails({ ...view.expandedCommit.commitDetails, fileChanges: nextFiles }, view.createFileTree(nextFiles, null));
		expect(view.expandedCommit.fileChanges).toBe(nextFiles);
		expect(document.getElementById('cdv')).toBe(details);
		expect(document.getElementById('cdvFiles')).toBe(container);
		expect(button(0, 'stageGitFile').disabled).toBe(true);
		expect(button(0, 'unstageGitFile').disabled).toBe(false);
		button(0, 'unstageGitFile').querySelector('path').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		expect(sent).toHaveBeenCalledTimes(2);
		expect(sent).toHaveBeenLastCalledWith({ command: 'unstageFiles', repo: '/repo', filePaths: ['dir/file.txt'] });
		view.finishFileAction();
		expect(button(1, 'stageGitFile').disabled).toBe(false);
		view.cdvUpdateFileState(nextFiles[0], button(0, 'unstageGitFile').closest('.fileTreeFileRecord'), null, true);
		expect(document.querySelector('.fileTreeFileRecord[data-index="0"]').lastElementChild.classList.contains('fileTreeUncommittedActions')).toBe(true);
	});

	it.each([{ hash: 'a', compare: null }, { hash: '*', compare: 'a' }])('Omits restore actions from historical commits and comparisons (%j)', ({ hash, compare }) => {
		const { document, view, row, sent, renderDetails } = setup([commit('*', ['a']), commit('a')]);
		openDetails(view, row, hash);
		view.expandedCommit.compareWithHash = compare;
		view.expandedCommit.compareWithElem = compare !== null ? row(compare) : null;
		const file = { type: 'M', oldFilePath: 'test.txt', newFilePath: 'test.txt', additions: 1, deletions: 1 };
		view.expandedCommit.fileChanges = [file];
		view.expandedCommit.fileTree = view.createFileTree([file], null);
		renderDetails();
		expect(document.querySelector('.uncommittedFileAction')).toBeNull();
		view.changeFileStaging({ ...file, staging: { stagePaths: ['file.txt'], unstagePaths: ['file.txt'] } }, true);
		view.changeFileStaging({ ...file, staging: { stagePaths: ['file.txt'], unstagePaths: ['file.txt'] } }, false);
		view.revertFileToHead(file);
		expect(sent).not.toHaveBeenCalled();
	});

	it('Shows the copy button after details finish loading', () => {
		const { document, view, row, sent, renderDetails } = setup();
		openDetails(view, row, 'a');
		view.expandedCommit.loading = true;
		renderDetails();
		expect(document.getElementById('cdvCopyDiff')).toBeNull();
		view.copyExpandedCommitDiff();
		expect(sent).not.toHaveBeenCalled();
		view.expandedCommit.loading = false;
		renderDetails();
		expect(document.getElementById('cdvCopyDiff')).not.toBeNull();
	});

	it('Keeps the visible commit anchored when commits arrive above the viewport', () => {
		const { view, row } = setup();
		const a = row('a');
		view.viewElem.scrollTop = 120;
		let top = 30;
		a.getBoundingClientRect = () => ({ top, bottom: top + 24 });
		view.renderTable = () => { top += 24; };
		view.renderGraph = () => { };
		view.render();
		expect(view.viewElem.scrollTop).toBe(144);
	});
});
