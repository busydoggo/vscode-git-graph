import * as vscode from './mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import { ConfigurationChangeEvent } from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from '../src/dataSource';
import { ExtensionState } from '../src/extensionState';
import { Logger } from '../src/logger';
import { RepoManager } from '../src/repoManager';
import { GitRepoSet } from '../src/types';
import { EventEmitter } from '../src/utils/event';
import { mockRepoState } from './helpers/utils';

const contextKey = 'git-graph:hasMultipleRepos';
const resources: { dispose: () => void }[] = [];

function setup(repos: GitRepoSet = {}) {
	const configChanges = new EventEmitter<ConfigurationChangeEvent>();
	const dataSource = { getSubmodules: jest.fn().mockResolvedValue([]) } as unknown as DataSource;
	const extensionState = { getRepos: () => repos, getIgnoredRepos: () => [], saveRepos: jest.fn(), transferRepo: jest.fn() } as unknown as ExtensionState;
	const logger = { log: jest.fn(), logError: jest.fn() } as unknown as Logger;
	const manager = new RepoManager(dataSource, extensionState, configChanges.subscribe, logger);
	const checkConfig = jest.spyOn(manager as any, 'checkRepoForNewConfig').mockResolvedValue(false);
	resources.push(manager, configChanges);
	return { manager, checkConfig };
}

function visibilityUpdates() {
	return vscode.commands.executeCommand.mock.calls.filter(call => call[0] === 'setContext' && call[1] === contextKey).map(call => call[2]);
}

describe('Repository title button visibility', () => {
	beforeEach(() => {
		jest.spyOn(RepoManager.prototype as any, 'startupTasks').mockResolvedValue(undefined);
	});

	afterEach(() => {
		resources.splice(0).forEach(resource => resource.dispose());
		jest.restoreAllMocks();
	});

	it.each([0, 1, 2, 3])('Sets initial visibility for %i known repositories', count => {
		const repos: GitRepoSet = {};
		for (let index = 0; index < count; index++) repos['/work/repo' + index] = mockRepoState();
		setup(repos);
		expect(visibilityUpdates()).toEqual([count > 1]);
	});

	it('Shows the button as soon as the second repository is discovered, before remaining scan work finishes', async () => {
		const { manager, checkConfig } = setup();
		await manager['addRepo']('/work/first');
		expect(visibilityUpdates()).toEqual([false]);
		let finishConfig!: (changed: boolean) => void;
		checkConfig.mockReturnValueOnce(new Promise<boolean>(resolve => { finishConfig = resolve; }));
		const pending = manager['addRepo']('/work/second');
		expect(manager.getNumRepos()).toBe(2);
		expect(visibilityUpdates()).toEqual([false, true]);
		finishConfig(false);
		await pending;
		await manager['addRepo']('/work/third');
		expect(visibilityUpdates()).toEqual([false, true]);
		manager['removeRepo']('/work/third');
		expect(visibilityUpdates()).toEqual([false, true]);
		manager['removeRepo']('/work/second');
		expect(visibilityUpdates()).toEqual([false, true, false]);
		manager['removeRepo']('/work/first');
		expect(visibilityUpdates()).toEqual([false, true, false]);
	});

	it('Hides the button when two stored paths resolve to the same repository', () => {
		const { manager } = setup({ '/work/first': mockRepoState(), '/work/second': mockRepoState() });
		manager['transferRepoState']('/work/first', '/work/second');
		expect(manager.getNumRepos()).toBe(1);
		expect(visibilityUpdates()).toEqual([true, false]);
	});

	it('Clears visibility when the extension session is disposed', () => {
		const { manager } = setup({ '/work/first': mockRepoState(), '/work/second': mockRepoState() });
		manager.dispose();
		expect(visibilityUpdates()).toEqual([true, false]);
	});

	it('Requires multiple repositories for the native editor title button', () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
		const button = manifest.contributes.menus['editor/title'].find((entry: any) => entry.command === 'git-graph.selectRepository');
		expect(button.when).toBe('activeWebviewPanelId == git-graph && git-graph:hasMultipleRepos');
	});
});
