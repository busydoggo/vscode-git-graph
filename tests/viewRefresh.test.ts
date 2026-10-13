import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';

const script = ['utils', 'main'].map(name => {
	const source = fs.readFileSync(path.join(__dirname, '../web/' + name + '.ts'), 'utf8');
	return ts.transpileModule(name === 'main' ? source.slice(0, source.indexOf('/* Main */')) : source, {
		compilerOptions: { target: ts.ScriptTarget.ES2015 }
	}).outputText;
}).join('\n');
const View = vm.runInNewContext(script + '\nGitGraphView;', { acquireVsCodeApi: () => ({}) });
const commit = { hash: 'a', author: 'Alice', email: '', parents: [], heads: ['main'], tags: [], remotes: [], stash: null };

function makeView(commits: any[]) {
	return Object.assign(Object.create(View.prototype), {
		commits, loadedCommits: commits, authorFilter: '', currentBranches: ['main'],
		currentRepo: '/selected/repo', currentRepoLoading: false,
		currentRepoRefreshState: { inProgress: false, hard: false, requestingRepoInfo: false },
		gitTags: [], gitBranchHead: 'main', renderedGitBranchHead: 'main', commitHead: 'a',
		moreCommitsAvailable: false, onlyFollowFirstParent: false, expandedCommit: null,
		tableElem: { innerHTML: '<table>Existing header and rows</table>', children: [{}] },
		config: { fetchAvatars: false }, avatars: {},
		graph: { loadCommits: jest.fn() }, render: jest.fn(), saveState: jest.fn(),
		requestLoadRepoInfo: jest.fn(), updateToolbarState: jest.fn(),
		finaliseLoadCommits: jest.fn(), requestAvatars: jest.fn()
	});
}

describe('Refreshing the retained graph', () => {
	it.each([{ commits: [] }, { commits: [commit] }])('Keeps the rendered table when loaded commits are unchanged (%j)', ({ commits }) => {
		const view = makeView(commits);
		const html = view.tableElem.innerHTML;
		view.refresh(false);
		expect(view.tableElem.innerHTML).toBe(html);
		expect(view.requestLoadRepoInfo).toHaveBeenCalledTimes(1);
		view.loadCommits(commits.map(value => ({ ...value })), 'a', [], false, false);
		expect(view.render).not.toHaveBeenCalled();
		expect(view.graph.loadCommits).not.toHaveBeenCalled();
		expect(view.currentBranches).toEqual(['main']);
		expect(view.finaliseLoadCommits).toHaveBeenCalledTimes(1);
	});

	it.each([{ commits: [] }, { commits: [commit] }])('Retains existing content during a manual refresh (%j)', ({ commits }) => {
		const view = makeView(commits);
		view.clearCommits = jest.fn();
		const html = view.tableElem.innerHTML;
		view.refresh(true);
		expect(view.clearCommits).not.toHaveBeenCalled();
		expect(view.commits).toBe(commits);
		expect(view.tableElem.innerHTML).toBe(html);
		expect(view.currentRepoRefreshState.hard).toBe(true);
		expect(view.requestLoadRepoInfo).toHaveBeenCalledTimes(1);
	});

	it.each([{ message: 'Updated summary' }, { email: 'new@example.com' }, { date: 1700000000 }])('Applies changed display data even if the commit hash is unchanged (%j)', fields => {
		const view = makeView([commit]);
		view.refresh(false);
		view.loadCommits([{ ...commit, ...fields }], 'a', [], false, false);
		expect(view.render).toHaveBeenCalledTimes(1);
	});

	it('Updates rows when new commits arrive', () => {
		const view = makeView([commit]);
		view.refresh(false);
		view.loadCommits([{ ...commit, hash: 'b', parents: ['a'] }, commit], 'b', [], false, false);
		expect(view.render).toHaveBeenCalledTimes(1);
		expect(view.graph.loadCommits).toHaveBeenCalledTimes(1);
		expect(view.commits.map((value: any) => value.hash)).toEqual(['b', 'a']);
	});
});
