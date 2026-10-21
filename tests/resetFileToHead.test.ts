import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from '../src/dataSource';

let repo: string, source: DataSource;
const git = (args: string[]) => cp.execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeAll(() => {
	repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-git-graph-restore-file-'));
	git(['init', '-q', '--template=']);
	git(['config', 'user.name', 'Restore Test']);
	git(['config', 'user.email', 'restore-test@example.com']);
	git(['config', 'commit.gpgSign', 'false']);
	git(['config', 'core.hooksPath', path.join(repo, 'no-hooks')]);
	fs.writeFileSync(path.join(repo, 'file.txt'), 'Old commit\n');
	fs.writeFileSync(path.join(repo, '[ab].txt'), 'Literal path\n');
	fs.writeFileSync(path.join(repo, 'a.txt'), 'Sibling\n');
	git(['add', '.']);
	git(['commit', '-qm', 'Initial']);
	fs.writeFileSync(path.join(repo, 'file.txt'), 'Latest commit\n');
	git(['commit', '-qam', 'Latest']);
	source = Object.assign(Object.create(DataSource.prototype), {
		gitExecutable: { path: 'git' }, askpassEnv: {}, logger: { logCmd: jest.fn() }
	});
});

beforeEach(() => {
	git(['reset', '--hard', '-q', 'HEAD']);
	git(['clean', '-fdq']);
});

afterAll(() => {
	if (repo) (fs as any).rmSync(repo, { recursive: true, force: true });
});

describe('Restoring a single uncommitted file to HEAD', () => {
	it('Restores the latest committed contents in both the index and working tree, preserving other files', async () => {
		fs.writeFileSync(path.join(repo, 'file.txt'), 'Staged changes\n');
		git(['add', 'file.txt']);
		fs.writeFileSync(path.join(repo, 'file.txt'), 'Unstaged changes\n');
		fs.writeFileSync(path.join(repo, 'a.txt'), 'Keep these changes\n');
		expect(await source.resetFileToRevision(repo, 'HEAD', 'file.txt')).toBeNull();
		expect(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8')).toBe('Latest commit\n');
		expect(git(['show', ':file.txt'])).toBe('Latest commit\n');
		expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('Keep these changes\n');
	});

	it.each([false, true])('Restores deleted files (staged: %s)', async staged => {
		fs.unlinkSync(path.join(repo, 'file.txt'));
		if (staged) git(['add', 'file.txt']);
		expect(await source.resetFileToRevision(repo, 'HEAD', 'file.txt')).toBeNull();
		expect(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8')).toBe('Latest commit\n');
		expect(git(['status', '--porcelain'])).toBe('');
	});

	it('Treats special characters in the filename literally instead of restoring matching siblings', async () => {
		fs.writeFileSync(path.join(repo, '[ab].txt'), 'Discard this change\n');
		fs.writeFileSync(path.join(repo, 'a.txt'), 'Keep this change\n');
		expect(await source.resetFileToRevision(repo, 'HEAD', '[ab].txt')).toBeNull();
		expect(fs.readFileSync(path.join(repo, '[ab].txt'), 'utf8')).toBe('Literal path\n');
		expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('Keep this change\n');
	});

	it('Keeps new files intact when HEAD has no version of their path', async () => {
		fs.writeFileSync(path.join(repo, 'new.txt'), 'New content\n');
		expect(await source.resetFileToRevision(repo, 'HEAD', 'new.txt')).not.toBeNull();
		expect(fs.readFileSync(path.join(repo, 'new.txt'), 'utf8')).toBe('New content\n');
	});
});
