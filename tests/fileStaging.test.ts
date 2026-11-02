import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from '../src/dataSource';

let repo: string, source: DataSource;
const git = (args: string[]) => cp.execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const writeFile = (name: string, contents: string) => fs.writeFileSync(path.join(repo, name), contents);
const fileDetails = async (name: string) => {
	const result = await source.getUncommittedDetails(repo);
	expect(result.error).toBeNull();
	return result.commitDetails!.fileChanges.find(file => file.newFilePath === name)!;
};

beforeAll(() => {
	repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-git-graph-stage-files-'));
	git(['init', '-q', '--template=']);
	git(['config', 'user.name', 'Staging Test']);
	git(['config', 'user.email', 'staging-test@example.com']);
	git(['config', 'commit.gpgSign', 'false']);
	git(['config', 'core.hooksPath', path.join(repo, 'no-hooks')]);
	['file.txt', '[ab].txt', 'a.txt', 'line\nbreak.txt'].forEach(name => writeFile(name, 'Committed\n'));
	git(['add', '.']);
	git(['commit', '-qm', 'Initial']);
	source = Object.assign(Object.create(DataSource.prototype), {
		gitExecutable: { path: 'git' }, askpassEnv: {}, logger: { logCmd: jest.fn() }
	});
});

beforeEach(() => {
	git(['reset', '--hard', '-q', 'HEAD']);
	git(['clean', '-fdq']);
	vscode.mockExtensionSettingReturnValue('repository.showUntrackedFiles', true);
});

afterAll(() => {
	if (repo) (fs as any).rmSync(repo, { recursive: true, force: true });
});

describe('Staging single uncommitted files', () => {
	it('Stages and unstages literal paths without changing working files or other index entries', async () => {
		writeFile('[ab].txt', 'Selected changes\n');
		writeFile('a.txt', 'Unrelated staged changes\n');
		git(['add', 'a.txt']);
		writeFile('a.txt', 'Unrelated unstaged changes\n');
		expect((await fileDetails('[ab].txt')).staging).toEqual({ stagePaths: ['[ab].txt'], unstagePaths: [] });
		expect(await source.stageFiles(repo, ['[ab].txt'])).toBeNull();
		expect(git(['show', ':[ab].txt'])).toBe('Selected changes\n');
		expect((await fileDetails('[ab].txt')).staging).toEqual({ stagePaths: [], unstagePaths: ['[ab].txt'] });
		expect(await source.unstageFiles(repo, ['[ab].txt'])).toBeNull();
		expect(git(['show', ':[ab].txt'])).toBe('Committed\n');
		expect(fs.readFileSync(path.join(repo, '[ab].txt'), 'utf8')).toBe('Selected changes\n');
		expect(git(['show', ':a.txt'])).toBe('Unrelated staged changes\n');
		expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('Unrelated unstaged changes\n');
	});

	it('Enables both actions for partially staged files and stages their remaining changes', async () => {
		writeFile('file.txt', 'Staged changes\n');
		git(['add', 'file.txt']);
		writeFile('file.txt', 'Additional working changes\n');
		expect((await fileDetails('file.txt')).staging).toEqual({ stagePaths: ['file.txt'], unstagePaths: ['file.txt'] });
		expect(await source.stageFiles(repo, ['file.txt'])).toBeNull();
		expect(git(['show', ':file.txt'])).toBe('Additional working changes\n');
		expect((await fileDetails('file.txt')).staging).toEqual({ stagePaths: [], unstagePaths: ['file.txt'] });
	});

	it('Unstages partially staged files while preserving all working changes', async () => {
		writeFile('file.txt', 'Staged changes\n');
		git(['add', 'file.txt']);
		writeFile('file.txt', 'Additional working changes\n');
		const state = (await fileDetails('file.txt')).staging!;
		expect(await source.unstageFiles(repo, state.unstagePaths)).toBeNull();
		expect(git(['show', ':file.txt'])).toBe('Committed\n');
		expect(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8')).toBe('Additional working changes\n');
		expect((await fileDetails('file.txt')).staging).toEqual({ stagePaths: ['file.txt'], unstagePaths: [] });
	});

	it('Keeps index changes visible when working contents match HEAD', async () => {
		writeFile('file.txt', 'Staged changes\n');
		git(['add', 'file.txt']);
		writeFile('file.txt', 'Committed\n');
		expect(git(['diff', 'HEAD'])).toBe('');
		expect((await fileDetails('file.txt')).staging).toEqual({ stagePaths: ['file.txt'], unstagePaths: ['file.txt'] });
		expect(await source.unstageFiles(repo, ['file.txt'])).toBeNull();
		expect(git(['status', '--porcelain'])).toBe('');
	});

	it('Stages new files and unstages them without deleting their contents', async () => {
		writeFile('new file.txt', 'New contents\n');
		expect((await fileDetails('new file.txt')).staging).toEqual({ stagePaths: ['new file.txt'], unstagePaths: [] });
		expect(await source.stageFiles(repo, ['new file.txt'])).toBeNull();
		expect((await fileDetails('new file.txt')).staging).toEqual({ stagePaths: [], unstagePaths: ['new file.txt'] });
		expect(await source.unstageFiles(repo, ['new file.txt'])).toBeNull();
		expect(fs.readFileSync(path.join(repo, 'new file.txt'), 'utf8')).toBe('New contents\n');
		expect(git(['status', '--porcelain'])).toBe('?? "new file.txt"\n');
	});

	it('Stages and unstages deletions while keeping the file deleted from the working tree', async () => {
		fs.unlinkSync(path.join(repo, 'file.txt'));
		expect((await fileDetails('file.txt')).staging).toEqual({ stagePaths: ['file.txt'], unstagePaths: [] });
		expect(await source.stageFiles(repo, ['file.txt'])).toBeNull();
		expect((await fileDetails('file.txt')).staging).toEqual({ stagePaths: [], unstagePaths: ['file.txt'] });
		expect(await source.unstageFiles(repo, ['file.txt'])).toBeNull();
		expect(fs.existsSync(path.join(repo, 'file.txt'))).toBe(false);
		expect(git(['show', ':file.txt'])).toBe('Committed\n');
	});

	it('Stages modified renamed files by their index path and unstages both sides of the rename', async () => {
		git(['mv', 'file.txt', 'renamed.txt']);
		writeFile('renamed.txt', 'Modified rename\n');
		const state = (await fileDetails('renamed.txt')).staging!;
		expect(state).toEqual({ stagePaths: ['renamed.txt'], unstagePaths: ['file.txt', 'renamed.txt'] });
		expect(await source.stageFiles(repo, state.stagePaths)).toBeNull();
		expect(await source.unstageFiles(repo, state.unstagePaths)).toBeNull();
		expect(git(['diff', '--cached', '--name-only'])).toBe('');
		expect(fs.existsSync(path.join(repo, 'file.txt'))).toBe(false);
		expect(fs.readFileSync(path.join(repo, 'renamed.txt'), 'utf8')).toBe('Modified rename\n');
	});

	it('Keeps a staged rename visible when its working file has been deleted', async () => {
		git(['mv', 'file.txt', 'renamed.txt']);
		fs.unlinkSync(path.join(repo, 'renamed.txt'));
		const result = await source.getUncommittedDetails(repo);
		expect(result.error).toBeNull();
		expect(result.commitDetails!.fileChanges).toHaveLength(1);
		expect(result.commitDetails!.fileChanges[0]).toMatchObject({ newFilePath: 'renamed.txt', type: 'D', staging: { stagePaths: ['renamed.txt'], unstagePaths: ['file.txt', 'renamed.txt'] } });
	});

	it('Handles filenames containing newlines as single paths', async () => {
		writeFile('line\nbreak.txt', 'Changed\n');
		expect((await fileDetails('line\nbreak.txt')).staging).toEqual({ stagePaths: ['line\nbreak.txt'], unstagePaths: [] });
		expect(await source.stageFiles(repo, ['line\nbreak.txt'])).toBeNull();
		expect(await source.unstageFiles(repo, ['line\nbreak.txt'])).toBeNull();
		expect(fs.readFileSync(path.join(repo, 'line\nbreak.txt'), 'utf8')).toBe('Changed\n');
	});

	it('Treats __proto__ as a literal filename without selecting other files', async () => {
		writeFile('__proto__', 'Selected new file\n');
		writeFile('file.txt', 'Unrelated changes\n');
		const state = (await fileDetails('__proto__')).staging!;
		expect(state.stagePaths).toEqual(['__proto__']);
		expect(await source.stageFiles(repo, state.stagePaths)).toBeNull();
		expect(git(['diff', '--cached', '--name-only'])).toBe('__proto__\n');
		expect(await source.unstageFiles(repo, ['__proto__'])).toBeNull();
		expect(git(['diff', '--cached', '--name-only'])).toBe('');
		expect(fs.readFileSync(path.join(repo, '__proto__'), 'utf8')).toBe('Selected new file\n');
	});

	it('Rejects empty selections without staging or unstaging unrelated files', async () => {
		writeFile('file.txt', 'Unstaged\n');
		writeFile('a.txt', 'Staged\n');
		git(['add', 'a.txt']);
		const before = git(['status', '--porcelain']);
		expect(await source.stageFiles(repo, [])).not.toBeNull();
		expect(await source.unstageFiles(repo, [])).not.toBeNull();
		expect(await source.stageFiles(repo, ['missing.txt'])).not.toBeNull();
		expect(git(['status', '--porcelain'])).toBe(before);
	});

	it('Unstages new files before the first commit without removing them', async () => {
		const unborn = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-git-graph-unborn-stage-'));
		try {
			cp.execFileSync('git', ['init', '-q', '--template='], { cwd: unborn });
			fs.writeFileSync(path.join(unborn, 'new.txt'), 'New\n');
			expect(await source.stageFiles(unborn, ['new.txt'])).toBeNull();
			expect(await source.unstageFiles(unborn, ['new.txt'])).toBeNull();
			expect(cp.execFileSync('git', ['status', '--porcelain'], { cwd: unborn, encoding: 'utf8' })).toBe('?? new.txt\n');
			expect(fs.readFileSync(path.join(unborn, 'new.txt'), 'utf8')).toBe('New\n');
		} finally {
			(fs as any).rmSync(unborn, { recursive: true, force: true });
		}
	});
});
