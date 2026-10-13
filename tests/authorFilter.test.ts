import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';

const source = fs.readFileSync(path.join(__dirname, '../web/main.ts'), 'utf8');
const script = ts.transpileModule(source.slice(0, source.indexOf('/* Main */')), {
	compilerOptions: { target: ts.ScriptTarget.ES2015 }
}).outputText;
const View = vm.runInNewContext(script + '\nGitGraphView;', {
	UNCOMMITTED: '*',
	closeDialogAndContextMenu: () => { }
});

function makeView() {
	const commits = [
		{ hash: '*', author: '*', parents: ['a'] },
		{ hash: 'a', author: 'Alice Zhang', parents: ['b'] },
		{ hash: 'b', author: 'Bob', parents: ['c'] },
		{ hash: 'c', author: 'ALICE Chen', parents: ['d'] },
		{ hash: 'd', author: '张三 [bot]', parents: [] }
	];
	return Object.assign(Object.create(View.prototype), {
		loadedCommits: commits,
		commits: commits,
		authorFilter: '',
		authorFilterInput: { value: '' },
		commitHead: 'a',
		onlyFollowFirstParent: false,
		expandedCommit: null,
		graph: { loadCommits: jest.fn() },
		render: jest.fn(),
		saveState: jest.fn(),
		closeCommitDetails: jest.fn()
	});
}

function apply(view: any, query: string) {
	view.authorFilterInput.value = query;
	view.applyAuthorFilter();
	return Array.from(view.commits, (commit: any) => commit.hash);
}

describe('Author filtering', () => {
	it('Matches partial author names without case sensitivity and keeps graph indexes aligned', () => {
		const view = makeView();
		expect(apply(view, '  aLiCe  ')).toEqual(['a', 'c']);
		expect(view.commitLookup).toEqual({ a: 0, c: 1 });
		expect(view.graph.loadCommits).toHaveBeenCalledWith(view.commits, 'a', { a: 0, c: 1 }, false, view.loadedCommits);
		expect(view.loadedCommits).toHaveLength(5);
	});

	it('Does nothing on no match, both before and after a successful filter', () => {
		const view = makeView();
		const original = view.commits;
		apply(view, 'unknown');
		expect(view.commits).toBe(original);
		expect(view.render).not.toHaveBeenCalled();
		expect(view.saveState).not.toHaveBeenCalled();
		apply(view, 'Alice');
		const filtered = view.commits;
		view.render.mockClear();
		view.graph.loadCommits.mockClear();
		apply(view, 'unknown');
		expect(view.commits).toBe(filtered);
		expect(view.authorFilter).toBe('Alice');
		expect(view.render).not.toHaveBeenCalled();
		expect(view.graph.loadCommits).not.toHaveBeenCalled();
	});

	it('Searches all loaded authors when switching filters and restores all rows when cleared', () => {
		const view = makeView();
		apply(view, 'Alice');
		expect(apply(view, 'Bob')).toEqual(['b']);
		expect(apply(view, '')).toEqual(['*', 'a', 'b', 'c', 'd']);
		expect(view.commits).toBe(view.loadedCommits);
	});

	it('Supports Chinese names and literal punctuation, without treating input as a regular expression', () => {
		const view = makeView();
		expect(apply(view, '张')).toEqual(['d']);
		expect(apply(view, '[bot]')).toEqual(['d']);
		expect(apply(view, '.*')).toEqual(['d']);
		expect(view.authorFilter).toBe('[bot]');
	});

	it('Closes details for commits that are excluded and filters newly loaded commits with the active query', () => {
		const view = makeView();
		view.expandedCommit = { commitHash: 'b', compareWithHash: null };
		apply(view, 'Alice');
		expect(view.closeCommitDetails).toHaveBeenCalledWith(false);
		view.loadedCommits.push({ hash: 'e', author: 'Alice New', parents: [] });
		expect(Array.from(view.getAuthorFilteredCommits(view.authorFilter), (commit: any) => commit.hash)).toEqual(['a', 'c', 'e']);
	});
});

const graphSource = fs.readFileSync(path.join(__dirname, '../web/graph.ts'), 'utf8');
const GraphClass = vm.runInNewContext(ts.transpileModule(graphSource, {
	compilerOptions: { target: ts.ScriptTarget.ES2015 }
}).outputText + '\nGraph;', { UNCOMMITTED: '*' });

function graphCommit(hash: string, author: string, parents: string[]) {
	return { hash, author, parents, stash: null };
}

function loadFilteredGraph(commits: any[], firstParent: boolean = false) {
	const view = makeView();
	view.loadedCommits = commits;
	view.commits = commits;
	view.currentBranches = ['main'];
	view.onlyFollowFirstParent = firstParent;
	view.graph = Object.assign(Object.create(GraphClass.prototype), {
		config: { grid: { offsetX: 0, x: 16 } }
	});
	apply(view, 'Alice');
	return view;
}

describe('Author filtering within selected branches', () => {
	it('Connects visible ancestors on one lane and restores the selected branch when cleared', () => {
		const commits = [graphCommit('a', 'Alice', ['b']), graphCommit('b', 'Bob', ['c']), graphCommit('c', 'Alice', [])];
		const original = JSON.stringify(commits);
		const view = loadFilteredGraph(commits);
		expect(view.graph.getFirstParentIndex(0)).toBe(1);
		expect(view.graph.branches).toHaveLength(1);
		expect(view.currentBranches).toEqual(['main']);
		expect(apply(view, '')).toEqual(['a', 'b', 'c']);
		expect(view.currentBranches).toEqual(['main']);
		expect(view.graph.getFirstParentIndex(0)).toBe(1);
		expect(view.graph.getFirstParentIndex(1)).toBe(2);
		expect(JSON.stringify(commits)).toBe(original);
	});

	it('Preserves merge paths through hidden authors and deduplicates shared ancestors', () => {
		const view = loadFilteredGraph([
			graphCommit('a', 'Alice', ['merge']), graphCommit('merge', 'Bob', ['left', 'right', 'duplicate']),
			graphCommit('left', 'Alice', ['root']), graphCommit('right', 'Alice', ['root']),
			graphCommit('duplicate', 'Bob', ['left']), graphCommit('root', 'Alice', [])
		]);
		expect(Array.from(view.graph.vertices[0].getParents(), (parent: any) => parent.id)).toEqual([1, 2]);
		expect(view.graph.getFirstParentIndex(1)).toBe(3);
		expect(view.graph.getFirstParentIndex(2)).toBe(3);
	});

	it('Follows only the first parent through a hidden merge when requested', () => {
		const view = loadFilteredGraph([
			graphCommit('a', 'Alice', ['merge']), graphCommit('merge', 'Bob', ['left', 'right']),
			graphCommit('left', 'Alice', []), graphCommit('right', 'Alice', [])
		], true);
		expect(Array.from(view.graph.vertices[0].getParents(), (parent: any) => parent.id)).toEqual([1]);
	});

	it('Keeps unloaded history boundaries without inventing connections to unrelated commits', () => {
		const view = loadFilteredGraph([
			graphCommit('a', 'Alice', ['hidden']), graphCommit('hidden', 'Bob', ['outside-selection']),
			graphCommit('unrelated', 'Alice', [])
		]);
		expect(view.graph.getFirstParentIndex(0)).toBe(-1);
		expect(view.graph.vertices[1].getChildren()).toHaveLength(0);
	});

	it('Ends a path at a hidden root instead of drawing a dangling branch', () => {
		const view = loadFilteredGraph([graphCommit('a', 'Alice', ['root']), graphCommit('root', 'Bob', [])]);
		expect(view.graph.vertices[0].getParents()).toHaveLength(0);
	});

	it('Traverses long runs of hidden commits without recursive stack growth', () => {
		const commits = [graphCommit('a', 'Alice', ['hidden0'])];
		for (let i = 0; i < 15000; i++) commits.push(graphCommit('hidden' + i, 'Bob', [i === 14999 ? 'root' : 'hidden' + (i + 1)]));
		commits.push(graphCommit('root', 'Alice', []));
		const view = loadFilteredGraph(commits);
		expect(view.graph.getFirstParentIndex(0)).toBe(1);
		expect(view.graph.branches).toHaveLength(1);
	});
});
