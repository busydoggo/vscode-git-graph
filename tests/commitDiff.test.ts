import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource } from '../src/dataSource';
import { UNCOMMITTED } from '../src/utils';

let repo: string, root: string, commit: string, source: DataSource;
const lines = Array.from({ length: 20 }, (_, index) => index === 0 ? '中文 context' : 'line ' + (index + 1));
const git = (args: string[]) => cp.execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeAll(() => {
	repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-git-graph-copy-diff-'));
	git(['init', '-q', '--template=']);
	git(['config', 'user.name', 'Diff Test']);
	git(['config', 'user.email', 'diff-test@example.com']);
	git(['config', 'commit.gpgSign', 'false']);
	git(['config', 'core.hooksPath', path.join(repo, 'no-hooks')]);
	fs.writeFileSync(path.join(repo, 'file.txt'), lines.join('\n') + '\n');
	fs.mkdirSync(path.join(repo, 'nested'));
	fs.writeFileSync(path.join(repo, 'nested', 'added.txt'), 'Nested root content\n');
	git(['add', '.']);
	git(['commit', '-qm', 'Root']);
	root = git(['rev-parse', 'HEAD']).trim();
	const updated = lines.slice();
	updated[9] = 'updated line 10';
	fs.writeFileSync(path.join(repo, 'file.txt'), updated.join('\n') + '\n');
	git(['commit', '-qam', 'Update']);
	commit = git(['rev-parse', 'HEAD']).trim();
	source = Object.assign(Object.create(DataSource.prototype), {
		gitExecutable: { path: 'git' }, askpassEnv: {}, logger: { logCmd: jest.fn() }
	});
});

afterAll(() => {
	if (repo) (fs as any).rmSync(repo, { recursive: true, force: true });
});

describe('Copying a complete Git patch', () => {
	it('Includes distant context lines and preserves the raw UTF-8 patch', async () => {
		const patch = await source.getCommitDiff(repo, root, commit);
		expect(patch).toBe(git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames', '-U999999999', root, commit, '--']));
		expect(patch).toContain('@@ -1,20 +1,20 @@');
		expect(patch).toContain(' 中文 context');
		expect(patch).toContain(' line 20');
		expect(patch).toContain('+updated line 10');
	});

	it('Copies additions from the initial commit, including nested files', async () => {
		const patch = await source.getCommitDiff(repo, null, root);
		expect(patch).toContain('new file mode');
		expect(patch).toContain('+中文 context');
		expect(patch).toContain('+line 20');
		expect(patch).toContain('b/nested/added.txt');
		expect(patch).toContain('+Nested root content');
		expect(patch.startsWith('diff --git')).toBe(true);
	});

	it('Returns an empty patch for identical revisions', async () => {
		expect(await source.getCommitDiff(repo, commit, commit)).toBe('');
	});

	it('Returns plain patch text even when Git color and an external diff are configured', async () => {
		git(['config', 'color.ui', 'always']);
		git(['config', 'diff.external', 'nonexistent-copy-diff-driver']);
		const patch = await source.getCommitDiff(repo, root, commit);
		expect(patch).toContain('+updated line 10');
		expect(patch).not.toContain('\u001b[');
	});

	it('Includes staged and unstaged tracked changes for the uncommitted row', async () => {
		fs.writeFileSync(path.join(repo, 'staged.txt'), 'Staged content\n');
		git(['add', 'staged.txt']);
		const updated = lines.slice();
		updated[9] = 'working tree line 10';
		fs.writeFileSync(path.join(repo, 'file.txt'), updated.join('\n') + '\n');
		const patch = await source.getCommitDiff(repo, 'HEAD', UNCOMMITTED);
		expect(patch).toContain('+Staged content');
		expect(patch).toContain('+working tree line 10');
		expect(patch).toContain(' line 20');
	});

	it('Rejects invalid revisions so the existing clipboard can be kept', async () => {
		await expect(source.getCommitDiff(repo, root, 'nonexistent-revision')).rejects.toContain('fatal:');
	});
});
