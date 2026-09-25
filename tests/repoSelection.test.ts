import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';
import { GitGraphView } from '../src/gitGraphView';
import { mockRepoState } from './helpers/utils';

function makeView() {
	const repos = { '/work/first': mockRepoState(), '/work/second': { ...mockRepoState(), name: 'My Repo' } };
	return Object.assign(Object.create(GitGraphView.prototype), {
		panel: { visible: true },
		disposed: false,
		repoManager: { getRepos: jest.fn(() => repos) },
		sendMessage: jest.fn(),
		respondLoadRepos: jest.fn()
	});
}

describe('Repository title picker', () => {
	it('Sends discovered repositories to the picker and handles a selection', async () => {
		const view = makeView();
		view.selectRepository();
		expect(view.sendMessage).toHaveBeenCalledWith({ command: 'selectRepository', repos: view.repoManager.getRepos(), relativePaths: { '/work/first': 'first', '/work/second': 'second' } });
		await view.respondToMessage({ command: 'selectRepository', repo: '/work/second' });
		expect(view.respondLoadRepos).toHaveBeenCalledWith(view.repoManager.getRepos(), { repo: '/work/second' });
	});

	it('Displays workspace-relative paths for roots, nested repositories and parent repositories', () => {
		const previousFolders = vscode.workspace.workspaceFolders;
		try {
			vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('/work'), index: 0 }];
			const view = makeView();
			view.repoManager.getRepos.mockReturnValue({ '/work': mockRepoState(), '/work/apps/api': mockRepoState(), '/': mockRepoState() });
			view.selectRepository();
			expect(view.sendMessage.mock.calls[0][0].relativePaths).toEqual({ '/work': '.', '/work/apps/api': 'apps/api', '/': '..' });
		} finally {
			vscode.workspace.workspaceFolders = previousFolders;
		}
	});

	it('Ignores selection after disposal, hiding, or repository removal', async () => {
		for (const change of ['disposed', 'hidden', 'removed']) {
			const view = makeView();
			if (change === 'disposed') view.disposed = true;
			else if (change === 'hidden') view.panel.visible = false;
			else view.repoManager.getRepos.mockReturnValue({});
			await view.respondToMessage({ command: 'selectRepository', repo: '/work/second' });
			expect(view.respondLoadRepos).not.toHaveBeenCalled();
		}
	});
});

const { JSDOM } = require('jsdom');
const pickerScript = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../web/repoPicker.ts'), 'utf8'), {
	compilerOptions: { target: ts.ScriptTarget.ES2015 }
}).outputText;

function setupPicker() {
	const dom = new JSDOM('<body><button id="previous">Graph</button></body>');
	const document = dom.window.document;
	dom.window.HTMLElement.prototype.scrollIntoView = () => { };
	const Widget = vm.runInNewContext(pickerScript + '\nRepoPicker;', {
		document,
		SVG_ICONS: { close: '' },
		initialState: { config: {} },
		getSortedRepositoryPaths: (repos: any) => Object.keys(repos).sort(),
		getRepoName: (repo: string) => repo.split('/').pop()
	});
	const selected = jest.fn(), widget = new Widget(selected);
	document.getElementById('previous').focus();
	widget.show({ '/work/a': { name: 'Alpha <repo>' }, '/work/b': { name: null } }, '/work/a', { '/work/a': 'a', '/work/b': 'b' });
	const input = document.querySelector('input');
	const search = (query: string) => {
		input.value = query;
		input.dispatchEvent(new dom.window.Event('input'));
	};
	const key = (value: string) => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true }));
	return { document, selected, input, search, key };
}

describe('Repository picker interaction', () => {
	it('Renders separate name and path columns without interpreting repository names as HTML', () => {
		const { document } = setupPicker();
		expect(document.querySelector('.repoPickerName').textContent).toBe('Alpha <repo>');
		expect(document.querySelector('.repoPickerPath').textContent).toBe('a');
		expect(document.querySelector('repo')).toBeNull();
		expect(document.querySelectorAll('.repoPickerRow.current')).toHaveLength(1);
	});

	it('Filters by name or path and selects with the keyboard', () => {
		const { document, selected, search, key } = setupPicker();
		search('ALPHA');
		expect(document.querySelectorAll('.repoPickerRow')).toHaveLength(1);
		search('/work/b');
		key('Enter');
		expect(selected).toHaveBeenCalledWith('/work/b');
		expect(document.getElementById('repoPicker').hidden).toBe(true);
	});

	it('Supports arrow navigation, no-match results, and Escape without changing the repository', () => {
		const { document, selected, input, search, key } = setupPicker();
		key('ArrowDown');
		expect(input.getAttribute('aria-activedescendant')).toBe('repoPickerOption1');
		search('missing');
		key('Enter');
		expect(selected).not.toHaveBeenCalled();
		expect(document.querySelector('.repoPickerEmpty')).not.toBeNull();
		key('Escape');
		expect(document.getElementById('repoPicker').hidden).toBe(true);
		expect(document.activeElement.id).toBe('previous');
	});
});
