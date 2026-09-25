import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });
jest.mock('../src/avatarManager');
jest.mock('../src/commands');
jest.mock('../src/dataSource');
jest.mock('../src/diffDocProvider');
jest.mock('../src/extensionState');
jest.mock('../src/gitGraphView');
jest.mock('../src/logger');
jest.mock('../src/repoManager');
jest.mock('../src/statusBarItem');
jest.mock('../src/life-cycle/startup');

import { ExtensionContext } from 'vscode';
import { AvatarManager } from '../src/avatarManager';
import { CommandManager } from '../src/commands';
import { DataSource } from '../src/dataSource';
import { DiffDocProvider } from '../src/diffDocProvider';
import { activate } from '../src/extension';
import { ExtensionState } from '../src/extensionState';
import { GitGraphView } from '../src/gitGraphView';
import { onStartUp } from '../src/life-cycle/startup';
import { Logger } from '../src/logger';
import { RepoManager } from '../src/repoManager';
import { StatusBarItem } from '../src/statusBarItem';
import * as utils from '../src/utils';

let context: ExtensionContext;
let findGit: jest.SpyInstance;
const executable = { path: '/usr/bin/git', version: '2.30.0' };
const managers = [Logger, ExtensionState, DataSource, AvatarManager, RepoManager, StatusBarItem, CommandManager, DiffDocProvider];

beforeEach(() => {
	context = Object.assign({}, vscode.mocks.extensionContext, { subscriptions: [] });
	findGit = jest.spyOn(utils, 'findGit').mockResolvedValue(executable);
	vscode.window.showInformationMessage.mockResolvedValue(undefined);
	vscode.window.showErrorMessage.mockResolvedValue(undefined);
	(onStartUp as jest.Mock).mockResolvedValue(undefined);
	GitGraphView.currentPanel = undefined;
	context.subscriptions.push(vscode.commands.registerCommand('git-graph.view', async () => undefined));
});

afterEach(() => {
	context.subscriptions.forEach(disposable => disposable.dispose());
	jest.restoreAllMocks();
	GitGraphView.currentPanel = undefined;
});

describe('git-graph.restart', () => {
	it('Disposes old services and listeners, recreates them, and keeps one restart command', async () => {
		await activate(context);
		const subscriptionCount = context.subscriptions.length;
		const registrations = [vscode.workspace.registerTextDocumentContentProvider, vscode.workspace.onDidChangeConfiguration];
		const oldRegistrations = registrations.map(mock => mock.mock.results[0].value);
		const oldManagers = managers.map(manager => (manager as unknown as jest.Mock).mock.instances[0]);

		await vscode.commands.executeCommand('git-graph.restart');

		oldManagers.forEach(manager => expect(manager.dispose).toHaveBeenCalledTimes(1));
		oldRegistrations.forEach(registration => expect(registration.dispose).toHaveBeenCalledTimes(1));
		managers.forEach(manager => expect(manager).toHaveBeenCalledTimes(2));
		expect(ExtensionState).toHaveBeenLastCalledWith(context, expect.any(Function));
		expect(context.subscriptions).toHaveLength(subscriptionCount);
		expect(vscode.commands.registerCommand.mock.calls.filter(([command]) => command === 'git-graph.restart')).toHaveLength(1);
		expect(onStartUp).toHaveBeenCalledTimes(1);
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('git-graph.view');
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Git Graph has been restarted.');

		await vscode.commands.executeCommand('git-graph.restart');
		expect(RepoManager).toHaveBeenCalledTimes(3);
		expect(context.subscriptions).toHaveLength(subscriptionCount);
	});

	it('Closes an existing view before stopping its services and reopens it after startup', async () => {
		await activate(context);
		const oldRepoManager = (RepoManager as jest.MockedClass<typeof RepoManager>).mock.instances[0];
		const disposeView = jest.fn(() => {
			expect(oldRepoManager.dispose).not.toHaveBeenCalled();
			GitGraphView.currentPanel = undefined;
		});
		GitGraphView.currentPanel = { dispose: disposeView } as unknown as GitGraphView;

		await vscode.commands.executeCommand('git-graph.restart');

		expect(disposeView).toHaveBeenCalledTimes(1);
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith('git-graph.view');
		expect(RepoManager).toHaveBeenCalledTimes(2);
	});

	it('Coalesces repeated restart requests while Git detection is pending', async () => {
		await activate(context);
		let resolveGit!: (git: utils.GitExecutable) => void;
		findGit.mockReturnValueOnce(new Promise<utils.GitExecutable>(resolve => { resolveGit = resolve; }));

		const first = vscode.commands.executeCommand('git-graph.restart');
		const second = vscode.commands.executeCommand('git-graph.restart');
		expect(first).toBe(second);
		expect(findGit).toHaveBeenCalledTimes(2);
		resolveGit(executable);
		await first;
		expect(RepoManager).toHaveBeenCalledTimes(2);
	});

	it('Cleans up a partially failed restart and allows a later retry', async () => {
		await activate(context);
		jest.spyOn(RepoManager.prototype, 'getNumRepos').mockImplementationOnce(() => { throw new Error('Startup failed'); });

		await vscode.commands.executeCommand('git-graph.restart');

		const failedManager = (RepoManager as jest.MockedClass<typeof RepoManager>).mock.instances[1];
		expect(failedManager.dispose).toHaveBeenCalledTimes(1);
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Unable to restart Git Graph: Error: Startup failed');
		await vscode.commands.executeCommand('git-graph.restart');
		expect(RepoManager).toHaveBeenCalledTimes(3);
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Git Graph has been restarted.');
	});

	it('Does not create new services if the extension is disposed during a restart', async () => {
		await activate(context);
		let resolveGit!: (git: utils.GitExecutable) => void;
		findGit.mockReturnValueOnce(new Promise<utils.GitExecutable>(resolve => { resolveGit = resolve; }));
		const restart = vscode.commands.executeCommand('git-graph.restart');

		context.subscriptions.forEach(disposable => disposable.dispose());
		resolveGit(executable);
		await restart;

		expect(RepoManager).toHaveBeenCalledTimes(1);
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it('Remains available when Git cannot be found, and retries Git discovery on restart', async () => {
		findGit.mockRejectedValueOnce(new Error('Git missing'));
		await activate(context);
		expect(DataSource).toHaveBeenCalledWith(null, expect.any(Function), expect.any(Function), expect.any(Logger));

		await vscode.commands.executeCommand('git-graph.restart');
		expect(DataSource).toHaveBeenLastCalledWith(executable, expect.any(Function), expect.any(Function), expect.any(Logger));
	});
});
