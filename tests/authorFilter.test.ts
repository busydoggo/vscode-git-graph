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
		expect(view.graph.loadCommits).toHaveBeenCalledWith(view.commits, 'a', { a: 0, c: 1 }, false);
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
