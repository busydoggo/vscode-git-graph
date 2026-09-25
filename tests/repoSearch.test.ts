import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import { RepoManager } from '../src/repoManager';
import { GitRepoSet } from '../src/types';
import { mockRepoState } from './helpers/utils';

const { Directory, File, SymbolicLink, Unknown } = vscode.FileType;
let repoManager: RepoManager;
let directories: { [path: string]: [string, vscode.FileType][] };
let metadata: { [path: string]: vscode.FileType };
let repoRoot: jest.Mock;
let addRepo: jest.Mock;

beforeEach(() => {
	directories = {};
	metadata = {};
	repoRoot = jest.fn(async (path: string) => metadata[path] ? path : null);
	const repos: GitRepoSet = {};
	addRepo = jest.fn(async (path: string) => {
		repos[path] = mockRepoState();
		return true;
	});
	// Exercise the scanner without starting workspace watchers or startup tasks.
	repoManager = Object.assign(Object.create(RepoManager.prototype), {
		repos, dataSource: { repoRoot }, addRepo, maxDepthOfRepoSearch: 3,
		logger: { log: jest.fn() }, sendRepos: jest.fn()
	});
	vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/workspace'), index: 0 }];
	vscode.workspace.fs.readDirectory.mockReset().mockImplementation(async uri => {
		if (!(uri.path in directories)) throw new Error('Directory cannot be read');
		return directories[uri.path];
	});
	vscode.workspace.fs.stat.mockReset().mockImplementation(async uri => {
		const type = metadata[uri.path.slice(0, -5)];
		if (!uri.path.endsWith('/.git') || type === undefined) throw new Error('Path does not exist');
		return { type, ctime: 0, mtime: 0, size: 0 };
	});
});

function addDirectory(path: string, children: string[] = [], gitType?: vscode.FileType) {
	directories[path] = children.map(name => [name, Directory]);
	if (gitType !== undefined) {
		metadata[path] = gitType;
		directories[path].push(['.git', gitType]);
	}
}

describe('Breadth-first repository search', () => {
	it.each([true, false])('Visits all siblings before their descendants (workspace root: %s)', async workspaceRoot => {
		addDirectory('/workspace', ['first', 'second']);
		addDirectory('/workspace/first', ['child'], Directory);
		addDirectory('/workspace/first/child', ['deep'], Directory);
		addDirectory('/workspace/first/child/deep', [], Directory);
		addDirectory('/workspace/second', ['child'], Directory);
		addDirectory('/workspace/second/child', [], Directory);

		const found = workspaceRoot
			? await repoManager.searchWorkspaceForRepos()
			: await repoManager['searchDirectoriesForRepos'](['/workspace'], 3);

		expect(found).toBe(true);
		expect(repoRoot.mock.calls).toEqual([
			...(workspaceRoot ? [['/workspace']] : []),
			['/workspace/first'], ['/workspace/second'],
			['/workspace/first/child'], ['/workspace/second/child'],
			['/workspace/first/child/deep']
		]);
		expect(addRepo.mock.calls).toEqual([
			['/workspace/first'], ['/workspace/second'],
			['/workspace/first/child'], ['/workspace/second/child'],
			['/workspace/first/child/deep']
		]);
	});

	it('Searches multiple workspace roots in the same breadth-first traversal', async () => {
		vscode.workspace.workspaceFolders!.push({ uri: vscode.Uri.file('/other'), index: 1 });
		addDirectory('/workspace', ['first']);
		addDirectory('/workspace/first', ['child'], Directory);
		addDirectory('/workspace/first/child', [], Directory);
		addDirectory('/other', ['second']);
		addDirectory('/other/second', [], Directory);

		expect(await repoManager.searchWorkspaceForRepos()).toBe(true);
		expect(repoRoot.mock.calls).toEqual([
			['/workspace'], ['/other'], ['/workspace/first'], ['/other/second'],
			['/workspace/first/child']
		]);
		expect(vscode.workspace.fs.readDirectory.mock.calls.map(([uri]) => uri.path)).toEqual([
			'/workspace', '/other', '/workspace/first', '/other/second', '/workspace/first/child'
		]);
	});

	it('Skips Git for ordinary descendants and still finds all deeper repositories', async () => {
		addDirectory('/workspace', ['projects', 'empty']);
		addDirectory('/workspace/projects', ['first', 'second', 'nested']);
		addDirectory('/workspace/projects/first', [], Directory);
		addDirectory('/workspace/projects/second', [], File);
		addDirectory('/workspace/projects/nested', ['third']);
		addDirectory('/workspace/projects/nested/third', [], Directory | SymbolicLink);
		addDirectory('/workspace/empty');

		expect(await repoManager.searchWorkspaceForRepos()).toBe(true);
		expect(repoRoot.mock.calls).toEqual([
			['/workspace'], ['/workspace/projects/first'], ['/workspace/projects/second'],
			['/workspace/projects/nested/third']
		]);
		expect(Object.keys(repoManager.getRepos())).toEqual([
			'/workspace/projects/first', '/workspace/projects/second', '/workspace/projects/nested/third'
		]);
		// Each non-leaf directory is listed once; only the depth-limit leaf needs stat.
		expect(vscode.workspace.fs.readDirectory.mock.calls.map(([uri]) => uri.path)).toEqual([
			'/workspace', '/workspace/projects', '/workspace/empty',
			'/workspace/projects/first', '/workspace/projects/second', '/workspace/projects/nested'
		]);
		expect(vscode.workspace.fs.stat.mock.calls.map(([uri]) => uri.path)).toEqual([
			'/workspace/projects/nested/third/.git'
		]);
	});

	it.each([Directory, Directory | SymbolicLink, File, File | SymbolicLink, SymbolicLink])(
		'Validates .git metadata type %s with Git, both at the depth limit and above it', async gitType => {
			for (const depth of [1, 2]) {
				addDirectory('/workspace', ['repo']);
				addDirectory('/workspace/repo', [], gitType);
				repoManager['maxDepthOfRepoSearch'] = depth;
				delete repoManager['repos']['/workspace/repo'];
				repoRoot.mockClear();
				addRepo.mockClear();

				expect(await repoManager.searchWorkspaceForRepos()).toBe(true);
				expect(repoRoot.mock.calls).toEqual([['/workspace'], ['/workspace/repo']]);
				expect(addRepo).toHaveBeenCalledWith('/workspace/repo');
			}
		}
	);

	it.each([1, 2])('Skips Git when .git is missing or unknown with search depth %s', async depth => {
		addDirectory('/workspace', ['missing', 'unknown']);
		addDirectory('/workspace/missing');
		addDirectory('/workspace/unknown', [], Unknown);
		repoManager['maxDepthOfRepoSearch'] = depth;

		expect(await repoManager.searchWorkspaceForRepos()).toBe(false);
		expect(repoRoot.mock.calls).toEqual([['/workspace']]);
		expect(addRepo).not.toHaveBeenCalled();
	});

	it('Uses Git to discover the containing repository when the workspace root has no .git', async () => {
		repoManager['maxDepthOfRepoSearch'] = 0;
		repoRoot.mockResolvedValueOnce('/parent-repo');

		expect(await repoManager.searchWorkspaceForRepos()).toBe(true);
		expect(addRepo).toHaveBeenCalledWith('/parent-repo');
		expect(vscode.workspace.fs.stat).not.toHaveBeenCalled();
		expect(vscode.workspace.fs.readDirectory).not.toHaveBeenCalled();
	});

	it('Honours the depth limit and skips excluded directories and ordinary files', async () => {
		addDirectory('/workspace', ['projects', 'node_modules', '.repo']);
		directories['/workspace'].push(['readme.txt', File]);
		addDirectory('/workspace/projects', ['repo']);
		addDirectory('/workspace/projects/repo', [], Directory);
		repoManager['maxDepthOfRepoSearch'] = 1;

		expect(await repoManager.searchWorkspaceForRepos()).toBe(false);
		expect(repoRoot.mock.calls).toEqual([['/workspace']]);
		expect(vscode.workspace.fs.readDirectory).toHaveBeenCalledTimes(1);
		expect(vscode.workspace.fs.stat.mock.calls.map(([uri]) => uri.path)).toEqual([
			'/workspace/projects/.git'
		]);
	});

	it('Does not add a false positive when Git rejects .git metadata', async () => {
		addDirectory('/workspace', ['invalid']);
		addDirectory('/workspace/invalid', [], File);
		repoRoot.mockResolvedValue(null);

		expect(await repoManager.searchWorkspaceForRepos()).toBe(false);
		expect(repoRoot).toHaveBeenCalledWith('/workspace/invalid');
		expect(addRepo).not.toHaveBeenCalled();
	});

	it('Continues searching children and siblings after a Git probe fails', async () => {
		addDirectory('/workspace', ['broken', 'sibling']);
		addDirectory('/workspace/broken', ['child'], Directory);
		addDirectory('/workspace/broken/child', [], Directory);
		addDirectory('/workspace/sibling', [], File);
		repoRoot.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Git failed'));

		expect(await repoManager.searchWorkspaceForRepos()).toBe(true);
		expect(addRepo.mock.calls).toEqual([['/workspace/sibling'], ['/workspace/broken/child']]);
	});

	it('Falls back to .git stat when a directory cannot be listed and continues with siblings', async () => {
		addDirectory('/workspace', ['unreadable', 'repo']);
		metadata['/workspace/unreadable'] = Directory;
		addDirectory('/workspace/repo', [], Directory);

		expect(await repoManager.searchWorkspaceForRepos()).toBe(true);
		expect(addRepo.mock.calls).toEqual([['/workspace/unreadable'], ['/workspace/repo']]);
		expect(vscode.workspace.fs.stat).toHaveBeenCalledWith(vscode.Uri.file('/workspace/unreadable/.git'));
	});

	it('Still searches below a known repository without probing it again', async () => {
		addDirectory('/workspace', ['known']);
		addDirectory('/workspace/known', ['nested'], Directory);
		addDirectory('/workspace/known/nested', [], Directory);
		repoManager['repos']['/workspace/known'] = mockRepoState();

		expect(await repoManager.searchWorkspaceForRepos()).toBe(true);
		expect(repoRoot.mock.calls).toEqual([['/workspace'], ['/workspace/known/nested']]);
	});
});
