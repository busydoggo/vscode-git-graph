import * as vscode from 'vscode';
import { AvatarManager } from './avatarManager';
import { CommandManager } from './commands';
import { getConfig } from './config';
import { DataSource } from './dataSource';
import { DiffDocProvider } from './diffDocProvider';
import { ExtensionState } from './extensionState';
import { GitGraphView } from './gitGraphView';
import { onStartUp } from './life-cycle/startup';
import { Logger } from './logger';
import { RepoManager } from './repoManager';
import { StatusBarItem } from './statusBarItem';
import { GitExecutable, UNABLE_TO_FIND_GIT_MSG, findGit, getGitExecutableFromPaths, showErrorMessage, showInformationMessage } from './utils';
import { toDisposable } from './utils/disposable';
import { EventEmitter } from './utils/event';

/**
 * Activate Git Graph.
 * @param context The context of the extension.
 */
export async function activate(context: vscode.ExtensionContext) {
	let session: ExtensionSession | null = null;
	let restarting: Promise<void> | null = null;
	let disposed = false;

	const stop = () => {
		if (session !== null) {
			session.active = false;
			if (GitGraphView.currentPanel) GitGraphView.currentPanel.dispose();
			for (const disposable of session.disposables) {
				try { disposable.dispose(); } catch (_) { }
			}
			session = null;
		}
	};
	const start = async () => {
		const nextSession: ExtensionSession = { active: true, disposables: [] };
		session = nextSession;
		try {
			await startSession(context, nextSession);
		} catch (error) {
			if (session === nextSession) stop();
			throw error;
		}
	};

	context.subscriptions.push(
		toDisposable(() => {
			disposed = true;
			stop();
		}),
		vscode.commands.registerCommand('git-graph.restart', () => {
			if (disposed) return Promise.resolve();
			if (restarting !== null) return restarting;
			const reopenView = GitGraphView.currentPanel !== undefined;
			restarting = (async () => {
				stop();
				await start();
				if (disposed) return;
				if (reopenView) await vscode.commands.executeCommand('git-graph.view');
				showInformationMessage('Git Graph has been restarted.');
			})().catch(error => {
				if (!disposed) showErrorMessage('Unable to restart Git Graph: ' + String(error));
			}).then(() => { restarting = null; });
			return restarting;
		})
	);

	await start();
	if (!disposed) onStartUp(context).catch(() => { });
}

interface ExtensionSession {
	active: boolean;
	disposables: vscode.Disposable[];
}

/** Register each resource immediately, and dispose it in reverse creation order. */
function own<T extends vscode.Disposable>(session: ExtensionSession, disposable: T): T {
	session.disposables.unshift(disposable);
	return disposable;
}

/** Initialise a fresh Git Graph session using the existing persisted extension state. */
async function startSession(context: vscode.ExtensionContext, session: ExtensionSession) {
	const logger = own(session, new Logger());
	logger.log('Starting Git Graph ...');

	const gitExecutableEmitter = own(session, new EventEmitter<GitExecutable>());
	const onDidChangeGitExecutable = gitExecutableEmitter.subscribe;

	const extensionState = own(session, new ExtensionState(context, onDidChangeGitExecutable));

	let gitExecutable: GitExecutable | null;
	try {
		gitExecutable = await findGit(extensionState);
		if (!session.active) return;
		gitExecutableEmitter.emit(gitExecutable);
		logger.log('Using ' + gitExecutable.path + ' (version: ' + gitExecutable.version + ')');
	} catch (_) {
		if (!session.active) return;
		gitExecutable = null;
		showErrorMessage(UNABLE_TO_FIND_GIT_MSG);
		logger.logError(UNABLE_TO_FIND_GIT_MSG);
	}

	const configurationEmitter = own(session, new EventEmitter<vscode.ConfigurationChangeEvent>());
	const onDidChangeConfiguration = configurationEmitter.subscribe;

	const dataSource = own(session, new DataSource(gitExecutable, onDidChangeConfiguration, onDidChangeGitExecutable, logger));
	const avatarManager = own(session, new AvatarManager(dataSource, extensionState, logger));
	const repoManager = own(session, new RepoManager(dataSource, extensionState, onDidChangeConfiguration, logger));
	own(session, new StatusBarItem(repoManager.getNumRepos(), repoManager.onDidChangeRepos, onDidChangeConfiguration, logger));
	own(session, new CommandManager(context, avatarManager, dataSource, extensionState, repoManager, gitExecutable, onDidChangeGitExecutable, logger));
	const diffDocProvider = own(session, new DiffDocProvider(dataSource));

	own(session, vscode.workspace.registerTextDocumentContentProvider(DiffDocProvider.scheme, diffDocProvider));
	own(session, vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('git-graph')) {
			configurationEmitter.emit(event);
		} else if (event.affectsConfiguration('git.path')) {
			const paths = getConfig().gitPaths;
			if (paths.length === 0) return;

			getGitExecutableFromPaths(paths).then((gitExecutable) => {
				if (!session.active) return;
				gitExecutableEmitter.emit(gitExecutable);
				const msg = 'Git Graph is now using ' + gitExecutable.path + ' (version: ' + gitExecutable.version + ')';
				showInformationMessage(msg);
				logger.log(msg);
				repoManager.searchWorkspaceForRepos();
			}, () => {
				if (!session.active) return;
				const msg = 'The new value of "git.path" ("' + paths.join('", "') + '") does not ' + (paths.length > 1 ? 'contain a string that matches' : 'match') + ' the path and filename of a valid Git executable.';
				showErrorMessage(msg);
				logger.logError(msg);
			});
		}
	}));
	logger.log('Started Git Graph - Ready to use!');

	extensionState.expireOldCodeReviews();
}

/**
 * Deactivate Git Graph.
 */
export function deactivate() { }
