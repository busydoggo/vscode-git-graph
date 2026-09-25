import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';

const source = fs.readFileSync(path.join(__dirname, '../web/main.ts'), 'utf8');
const sendMessage = jest.fn(), runAction = jest.fn();
const View = vm.runInNewContext(ts.transpileModule(source.slice(0, source.indexOf('/* Main */')), {
	compilerOptions: { target: ts.ScriptTarget.ES2015 }
}).outputText + '\nGitGraphView;', { sendMessage, runAction });

function makeView() {
	return Object.assign(Object.create(View.prototype), {
		currentRepo: '/selected/repo',
		gitRemotes: ['origin'],
		config: { fetchAndPrune: true, fetchAndPruneTags: false },
		currentRepoRefreshState: { inProgress: false },
		settingsWidget: { show: jest.fn() },
		refresh: jest.fn()
	});
}

describe('Editor title actions', () => {
	beforeEach(() => {
		sendMessage.mockClear();
		runAction.mockClear();
	});

	it('Uses the selected repository and preserves fetch options', () => {
		const view = makeView();
		view.runToolbarAction('settings');
		expect(view.settingsWidget.show).toHaveBeenCalledWith('/selected/repo');
		view.runToolbarAction('fetch');
		expect(runAction).toHaveBeenCalledWith({ command: 'fetch', repo: '/selected/repo', name: null, prune: true, pruneTags: false }, 'Fetching from Remote(s)');
		view.runToolbarAction('refresh');
		expect(view.refresh).toHaveBeenCalledWith(true, true);
	});

	it('Ignores refresh while busy and fetch when there are no remotes', () => {
		const view = makeView();
		view.currentRepoRefreshState.inProgress = true;
		view.gitRemotes = [];
		view.runToolbarAction('refresh');
		view.runToolbarAction('fetch');
		expect(view.refresh).not.toHaveBeenCalled();
		expect(runAction).not.toHaveBeenCalled();
	});

	it('Ignores actions before a repository is selected', () => {
		const view = makeView();
		view.currentRepo = undefined;
		for (const action of ['settings', 'fetch', 'refresh']) view.runToolbarAction(action);
		expect(view.settingsWidget.show).not.toHaveBeenCalled();
		expect(view.refresh).not.toHaveBeenCalled();
		expect(runAction).not.toHaveBeenCalled();
	});

	it('Reports remote availability and refreshing state to native title controls', () => {
		const view = makeView();
		view.updateToolbarState();
		expect(sendMessage).toHaveBeenLastCalledWith({ command: 'toolbarState', ready: true, hasRemotes: true, refreshing: false });
		view.gitRemotes = [];
		view.currentRepoRefreshState.inProgress = true;
		view.updateToolbarState();
		expect(sendMessage).toHaveBeenLastCalledWith({ command: 'toolbarState', ready: true, hasRemotes: false, refreshing: true });
	});
});
