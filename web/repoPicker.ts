/** Repository selector with separate, aligned name and path columns. */
class RepoPicker {
	private readonly overlay = document.createElement('div');
	private readonly input = document.createElement('input');
	private readonly list = document.createElement('div');
	private readonly closeButton = document.createElement('button');
	private repos: Readonly<GG.GitRepoSet> = {};
	private currentRepo = '';
	private relativePaths: { [repo: string]: string } = {};
	private paths: string[] = [];
	private activeIndex = 0;
	private previousFocus: HTMLElement | null = null;
	private readonly onSelect: (repo: string) => void;

	constructor(onSelect: (repo: string) => void) {
		this.onSelect = onSelect;
		this.overlay.id = 'repoPicker';
		this.overlay.hidden = true;
		const panel = document.createElement('div');
		panel.className = 'repoPickerPanel';
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-modal', 'true');
		panel.setAttribute('aria-label', 'Select Repository');
		const header = document.createElement('div');
		header.className = 'repoPickerHeader';
		this.input.type = 'text';
		this.input.placeholder = 'Search repositories';
		this.input.setAttribute('role', 'combobox');
		this.input.setAttribute('aria-label', 'Search repositories');
		this.input.setAttribute('aria-controls', 'repoPickerList');
		this.input.setAttribute('aria-expanded', 'true');
		this.input.setAttribute('aria-autocomplete', 'list');
		this.closeButton.type = 'button';
		this.closeButton.title = 'Close (Escape)';
		this.closeButton.setAttribute('aria-label', 'Close repository picker');
		this.closeButton.innerHTML = SVG_ICONS.close;
		header.appendChild(this.input);
		header.appendChild(this.closeButton);
		this.list.id = 'repoPickerList';
		this.list.setAttribute('role', 'listbox');
		this.list.setAttribute('aria-label', 'Discovered repositories');
		panel.appendChild(header);
		panel.appendChild(this.list);
		this.overlay.appendChild(panel);
		document.body.appendChild(this.overlay);
		this.closeButton.addEventListener('click', () => this.close());
		this.overlay.addEventListener('click', event => {
			if (event.target === this.overlay) this.close();
		});
		this.input.addEventListener('input', () => this.render());
		this.overlay.addEventListener('keydown', event => {
			event.stopPropagation();
			if (event.isComposing) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
			} else if (event.key === 'Tab') {
				event.preventDefault();
				(document.activeElement === this.input ? this.closeButton : this.input).focus();
			} else if (event.target === this.input) {
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					if (this.paths.length > 0) {
						this.activeIndex = (this.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + this.paths.length) % this.paths.length;
						this.updateSelection();
					}
				} else if (event.key === 'Enter' && this.paths.length > 0) {
					event.preventDefault();
					this.select(this.paths[this.activeIndex]);
				}
			}
		});
	}

	public show(repos: Readonly<GG.GitRepoSet>, currentRepo: string, relativePaths: { [repo: string]: string }) {
		if (this.overlay.hidden) this.previousFocus = <HTMLElement | null>document.activeElement;
		this.repos = repos;
		this.relativePaths = relativePaths;
		this.currentRepo = currentRepo;
		this.input.value = '';
		this.overlay.hidden = false;
		this.render();
		this.activeIndex = Math.max(0, this.paths.indexOf(currentRepo));
		this.updateSelection();
		this.input.focus();
	}

	private close() {
		this.overlay.hidden = true;
		if (this.previousFocus !== null && this.previousFocus.isConnected) this.previousFocus.focus();
	}

	private select(repo: string) {
		this.close();
		this.onSelect(repo);
	}

	private render() {
		const query = this.input.value.trim().toLowerCase();
		this.paths = getSortedRepositoryPaths(this.repos, initialState.config.repoDropdownOrder).filter(repo =>
			((this.repos[repo].name || getRepoName(repo)) + ' ' + repo + ' ' + this.relativePaths[repo]).toLowerCase().includes(query)
		);
		this.activeIndex = 0;
		this.list.textContent = '';
		this.paths.forEach((repo, index) => {
			const row = document.createElement('div');
			row.id = 'repoPickerOption' + index;
			row.className = 'repoPickerRow' + (repo === this.currentRepo ? ' current' : '');
			row.setAttribute('role', 'option');
			const name = document.createElement('span'), path = document.createElement('span');
			name.className = 'repoPickerName';
			name.textContent = this.repos[repo].name || getRepoName(repo);
			name.title = name.textContent + (repo === this.currentRepo ? ' (Current repository)' : '');
			path.className = 'repoPickerPath';
			path.textContent = this.relativePaths[repo];
			path.title = repo;
			row.appendChild(name);
			row.appendChild(path);
			row.addEventListener('click', () => this.select(repo));
			this.list.appendChild(row);
		});
		if (this.paths.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'repoPickerEmpty';
			empty.textContent = 'No matching repositories';
			empty.setAttribute('role', 'status');
			this.list.appendChild(empty);
		}
		this.updateSelection();
	}

	private updateSelection() {
		this.input.removeAttribute('aria-activedescendant');
		for (let i = 0; i < this.paths.length; i++) {
			const row = <HTMLElement>this.list.children[i];
			row.setAttribute('aria-selected', String(i === this.activeIndex));
			if (i === this.activeIndex) {
				this.input.setAttribute('aria-activedescendant', row.id);
				row.scrollIntoView({ block: 'nearest' });
			}
		}
	}
}
