import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from '../src/dataSource';

let root: string, repo: string, source: DataSource;
const git = (args: string[]) => cp.execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const writeFile = (name: string, contents: string = 'Keep this file\n') => fs.writeFileSync(path.join(repo, name), contents);

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-git-graph-delete-untracked-'));
	repo = path.join(root, 'repo');
	fs.mkdirSync(repo);
	git(['init', '-q', '--template=']);
	git(['config', 'user.name', 'Delete File Test']);
	git(['config', 'user.email', 'delete-file-test@example.com']);
	git(['config', 'commit.gpgSign', 'false']);
	git(['config', 'core.hooksPath', path.join(root, 'no-hooks')]);
	writeFile('tracked.txt');
	writeFile('.gitignore', 'ignored*\n');
	git(['add', '.']);
	git(['commit', '-qm', 'Initial']);
	source = Object.assign(Object.create(DataSource.prototype), {
		gitExecutable: { path: 'git' }, askpassEnv: {}, logger: { logCmd: jest.fn() }
	});
});

beforeEach(() => {
	git(['reset', '--hard', '-q', 'HEAD']);
	git(['clean', '-fdxq']);
});

afterAll(() => {
	if (root) (fs as any).rmSync(root, { recursive: true, force: true });
});

describe('Deleting one untracked file', () => {
	it.each(['[ab].txt', '-new.txt', '__proto__', 'new file.txt'])('Deletes the exact selected filename %s and preserves other files', async name => {
		writeFile(name, 'Delete this file\n');
		writeFile('a.txt', 'Unrelated untracked file\n');
		writeFile('tracked.txt', 'Unrelated tracked changes\n');
		expect(await source.deleteUntrackedFile(repo, name)).toBeNull();
		expect(fs.existsSync(path.join(repo, name))).toBe(false);
		expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('Unrelated untracked file\n');
		expect(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8')).toBe('Unrelated tracked changes\n');
	});

	it('Deletes one nested file without cleaning sibling files or its directory', async () => {
		fs.mkdirSync(path.join(repo, 'nested'));
		writeFile('nested/new.txt');
		writeFile('nested/keep.txt');
		expect(await source.deleteUntrackedFile(repo, 'nested/new.txt')).toBeNull();
		expect(fs.existsSync(path.join(repo, 'nested/new.txt'))).toBe(false);
		expect(fs.readFileSync(path.join(repo, 'nested/keep.txt'), 'utf8')).toBe('Keep this file\n');
	});

	it.each([false, true])('Refuses tracked files even if the UI is stale (staged: %s)', async staged => {
		writeFile('tracked.txt', 'Tracked modifications\n');
		if (staged) git(['add', 'tracked.txt']);
		expect(await source.deleteUntrackedFile(repo, 'tracked.txt')).not.toBeNull();
		expect(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8')).toBe('Tracked modifications\n');
	});

	it('Refuses ignored files and directories', async () => {
		writeFile('ignored.txt');
		fs.mkdirSync(path.join(repo, 'directory'));
		writeFile('directory/keep.txt');
		expect(await source.deleteUntrackedFile(repo, 'ignored.txt')).not.toBeNull();
		expect(await source.deleteUntrackedFile(repo, 'directory')).not.toBeNull();
		expect(fs.existsSync(path.join(repo, 'ignored.txt'))).toBe(true);
		expect(fs.existsSync(path.join(repo, 'directory/keep.txt'))).toBe(true);
	});

	it('Refuses empty, repository-wide and outside paths', async () => {
		const outside = path.join(root, 'outside.txt');
		fs.writeFileSync(outside, 'Outside repository\n');
		writeFile('new.txt');
		for (const name of ['', '.', '..', '../outside.txt', outside, 'new\0.txt']) {
			expect(await source.deleteUntrackedFile(repo, name)).not.toBeNull();
		}
		expect(fs.readFileSync(outside, 'utf8')).toBe('Outside repository\n');
		expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(true);
	});

	it('Keeps a file that becomes staged between the status check and cleanup', async () => {
		writeFile('racing.txt', 'Now staged\n');
		const run = (source as any).runGitCommand.bind(source);
		const action = jest.spyOn(source as any, 'runGitCommand').mockImplementation((...args: any[]) => {
			git(['add', 'racing.txt']);
			return run(...args);
		});
		try {
			expect(await source.deleteUntrackedFile(repo, 'racing.txt')).toBeNull();
			expect(fs.readFileSync(path.join(repo, 'racing.txt'), 'utf8')).toBe('Now staged\n');
			expect(git(['show', ':racing.txt'])).toBe('Now staged\n');
		} finally {
			action.mockRestore();
		}
	});

	it('Reports a missing file without deleting other paths', async () => {
		writeFile('keep.txt');
		expect(await source.deleteUntrackedFile(repo, 'missing.txt')).not.toBeNull();
		expect(fs.existsSync(path.join(repo, 'keep.txt'))).toBe(true);
	});

	const testSymlinks = process.platform === 'win32' ? it.skip : it;
	testSymlinks('Removes symlinks themselves and preserves their targets outside the repository', async () => {
		const targetFile = path.join(root, 'target.txt'), targetDir = path.join(root, 'target-directory');
		fs.writeFileSync(targetFile, 'Keep external content\n');
		fs.mkdirSync(targetDir);
		fs.writeFileSync(path.join(targetDir, 'keep.txt'), 'Keep directory content\n');
		fs.symlinkSync(targetFile, path.join(repo, 'file-link'));
		fs.symlinkSync(targetDir, path.join(repo, 'directory-link'));
		expect(await source.deleteUntrackedFile(repo, 'file-link')).toBeNull();
		expect(await source.deleteUntrackedFile(repo, 'directory-link')).toBeNull();
		expect(() => fs.lstatSync(path.join(repo, 'file-link'))).toThrow();
		expect(() => fs.lstatSync(path.join(repo, 'directory-link'))).toThrow();
		expect(fs.readFileSync(targetFile, 'utf8')).toBe('Keep external content\n');
		expect(fs.readFileSync(path.join(targetDir, 'keep.txt'), 'utf8')).toBe('Keep directory content\n');
	});
});
