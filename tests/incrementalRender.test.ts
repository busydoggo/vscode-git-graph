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
		referenceLabels: { tagLabelsOnRight: true, combineLocalAndRemoteBranchLabels: true },
		commitDetailsView: { fileTreeCompactFolders: false },
		graph: { grid: { x: 16, y: 24, offsetX: 16, offsetY: 12, expandY: 100 }, colours: ['red', 'blue'], style: 0, uncommittedChanges: 0 }
	};
	const { View, Graph, FindWidget, Renderer } = vm.runInNewContext(script + '\n({View: GitGraphView, Graph, FindWidget, Renderer: CommitTableRenderer});', {
		document, window: dom.window, getComputedStyle: dom.window.getComputedStyle, setTimeout: jest.fn(), clearTimeout: jest.fn(),
		initialState: { config }, acquireVsCodeApi: () => ({ postMessage: sent }),
		GG: { FileViewType: { List: 1 }, GitFileStatus: { Modified: 'M' }, DateFormatType: { DateAndTime: 0, DateOnly: 1 }, GraphStyle: { Angular: 0 }, GraphUncommittedChangesStyle: { OpenCircleAtTheUncommittedChanges: 0, OpenCircleAtTheCheckedOutCommit: 1 } },
		CLASS_INTERNAL_URL: 'internalUrl', CLASS_EXTERNAL_URL: 'externalUrl',
		TextFormatter: class { public format(value: string) { return value; } },
		ResizeObserver: class { public observe() { } public disconnect() { } }
	});
	const view = Object.assign(Object.create(View.prototype), {
		commits, loadedCommits: commits, commitLookup: {}, commitHead: 'a', gitBranchHead: 'main',
		authorFilter: '', currentRepo: '/repo', gitRepos: { '/repo': { issueLinkingConfig: null } }, config, avatars: {},
		viewElem: document.getElementById('view'), tableElem: document.getElementById('commitTable'), footerElem: document.getElementById('footer'),
		tableRenderer: new Renderer(), branchLabelLayouts: new WeakMap(), commitDetailsRenderState: null, copyCommitDiffInProgress: false, gitConfig: null,
		authorFilterInput: document.createElement('input'), authorFilterWidget: document.createElement('div'), authorFilterClear: document.createElement('button'),
		expandedCommit: null, moreCommitsAvailable: true, graphHeaderResizeObserver: null,
		branchDropdown: { mount: jest.fn(), refresh: jest.fn() }, makeTableResizable: jest.fn(), updateGraphHeaderLayout: jest.fn(),
		saveState: jest.fn(), scrollToCommit: jest.fn(), loadMoreCommits: jest.fn(), requestCommitDetails: jest.fn(), requestCommitComparison: jest.fn(),
		getColumnVisibility: () => ({ date: true, author: true, commit: true }), isCdvDocked: () => false,
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
	return { dom, document, view, sent, update, renderDetails: () => View.prototype.renderCommitDetailsView.call(view, true), row: (hash: string) => document.querySelector('tr[data-hash="' + hash + '"]') };
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
		expect(observer.takeRecords().every((mutation: any) => files.contains(mutation.target))).toBe(true);
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
