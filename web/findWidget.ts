const CLASS_FIND_CURRENT_COMMIT = 'findCurrentCommit';
const CLASS_FIND_MATCH = 'findMatch';

interface FindWidgetState {
	readonly text: string;
	readonly currentHash: string | null;
	readonly visible: boolean;
	readonly regex?: boolean;
}

/** Searches the visible Description column from its table header. */
class FindWidget {
	private readonly view: GitGraphView;
	private text: string = '';
	private regex: boolean = false;
	private error: string | null = null;
	private matches: { hash: string, elem: HTMLElement }[] = [];
	private position: number = -1;
	private readonly widgetElem: HTMLDivElement;
	private readonly inputElem: HTMLInputElement;
	private readonly prevElem: HTMLButtonElement;
	private readonly nextElem: HTMLButtonElement;
	private readonly clearElem: HTMLButtonElement;
	private readonly modeElem: HTMLButtonElement;

	constructor(view: GitGraphView) {
		this.view = view;
		this.widgetElem = document.createElement('div');
		this.widgetElem.className = 'findWidget headerSearch';
		this.widgetElem.innerHTML = '<span class="findSearchIcon" aria-hidden="true">' + SVG_ICONS.search + '</span><input class="headerSearchInput" id="findInput" type="text" placeholder="Description" aria-label="Search descriptions" title="Search descriptions"/><button id="findMode" type="button" aria-label="Use regular expression" aria-pressed="false" title="模糊匹配，点击切换为正则匹配">模糊</button><button id="findPrev" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match" hidden></button><button id="findNext" type="button" title="Next match (Enter)" aria-label="Next match" hidden></button><button id="findClose" type="button" title="Exit search (Escape)" aria-label="Exit search" hidden></button>' + SEARCH_HINT_HTML;
		this.inputElem = <HTMLInputElement>this.widgetElem.querySelector('#findInput')!;
		this.prevElem = <HTMLButtonElement>this.widgetElem.querySelector('#findPrev')!;
		this.nextElem = <HTMLButtonElement>this.widgetElem.querySelector('#findNext')!;
		this.clearElem = <HTMLButtonElement>this.widgetElem.querySelector('#findClose')!;
		this.modeElem = <HTMLButtonElement>this.widgetElem.querySelector('#findMode')!;
		this.modeElem.addEventListener('click', () => {
			this.regex = !this.regex;
			this.updateMode();
			this.findMatches(this.getCurrentHash(), true);
			this.inputElem.focus({ preventScroll: true });
		});
		this.prevElem.innerHTML = SVG_ICONS.arrowUp;
		this.nextElem.innerHTML = SVG_ICONS.arrowDown;
		this.clearElem.innerHTML = SVG_ICONS.close;
		this.prevElem.addEventListener('click', () => this.move(-1));
		this.nextElem.addEventListener('click', () => this.move(1));
		this.clearElem.addEventListener('click', () => this.close());
		this.widgetElem.addEventListener('focusin', () => {
			this.clearElem.hidden = false;
		});
		this.widgetElem.addEventListener('focusout', event => {
			if (!this.widgetElem.contains(<Node | null>event.relatedTarget)) {
				this.clearElem.hidden = this.inputElem.value === '';
			}
		});
		this.inputElem.addEventListener('input', event => {
			alterClass(this.widgetElem, 'hasText', this.inputElem.value !== '');
			if (!(<InputEvent>event).isComposing) this.search();
		});
		this.inputElem.addEventListener('compositionend', () => this.search());
		this.inputElem.addEventListener('keydown', event => {
			event.stopPropagation();
			if (event.isComposing) return;
			if (event.key === 'Enter') {
				event.preventDefault();
				this.move(event.shiftKey ? -1 : 1);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
			}
		});
	}

	public hasFocus() {
		return this.widgetElem.contains(document.activeElement);
	}

	/** Reuse the input and listeners when the commit table is rebuilt. */
	public mount(container: HTMLElement, restoreFocus: boolean) {
		const start = this.inputElem.selectionStart, end = this.inputElem.selectionEnd;
		container.appendChild(this.widgetElem);
		if (restoreFocus) {
			this.inputElem.focus({ preventScroll: true });
			this.inputElem.setSelectionRange(start, end);
		}
	}

	public show() {
		this.inputElem.focus({ preventScroll: true });
		this.inputElem.select();
	}

	public close() {
		this.text = '';
		this.inputElem.value = '';
		if (this.hasFocus()) (<HTMLElement>document.activeElement).blur();
		this.findMatches(null, false);
	}

	public refresh() {
		this.findMatches(this.getCurrentHash(), false);
	}

	public setColour(colour: string) {
		document.body.style.setProperty('--git-graph-findMatch', colour);
		document.body.style.setProperty('--git-graph-findMatchCommit', modifyColourOpacity(colour, 0.5));
	}

	public getState(): FindWidgetState {
		return { text: this.text, currentHash: this.getCurrentHash(), visible: this.isVisible(), regex: this.regex };
	}

	public getCurrentHash() {
		return this.position > -1 ? this.matches[this.position].hash : null;
	}

	public restoreState(state: FindWidgetState) {
		this.regex = state.regex === true;
		this.updateMode();
		this.text = state.visible ? state.text : '';
		this.inputElem.value = this.text;
		this.findMatches(state.currentHash, false);
	}

	public isVisible() {
		return this.text !== '' || this.hasFocus();
	}

	private updateMode() {
		this.modeElem.textContent = this.regex ? '正则' : '模糊';
		this.modeElem.setAttribute('aria-pressed', String(this.regex));
		this.modeElem.title = this.regex ? '正则匹配，点击切换为模糊匹配' : '模糊匹配，点击切换为正则匹配';
	}

	private failSearch(message: string) {
		this.error = message;
		this.clearMatches();
		this.matches = [];
		this.position = -1;
		this.updatePosition(-1, false);
	}

	private search() {
		if (this.text === this.inputElem.value) return;
		this.text = this.inputElem.value;
		this.findMatches(null, true);
	}

	private findMatches(currentHash: string | null, scrollToCommit: boolean) {
		this.clearMatches();
		this.matches = [];
		this.position = -1;
		this.error = null;
		if (this.text !== '') {
			let pattern: RegExp;
			try {
				pattern = new RegExp(this.regex ? this.text : this.text.replace(/[\\\[\](){}|.*+?^$]/g, '\\$&'), 'giu');
			} catch (error) {
				this.failSearch('Invalid regular expression: ' + (error as Error).message);
				return;
			}
			const commits = this.view.getCommits(), rows = getCommitElems();
			for (let i = 0; i < rows.length; i++) {
				const commit = commits[parseInt(rows[i].dataset.id!)];
				const description = rows[i].querySelector('.description');
				if (!commit || commit.hash === UNCOMMITTED || description === null) continue;
				pattern.lastIndex = 0;
				if (!pattern.test(description.textContent || '')) continue;
				this.matches.push({ hash: commit.hash, elem: rows[i] });
				for (const node of getChildNodesWithTextContent(description)) {
					const text = node.textContent!;
					const fragment = document.createDocumentFragment();
					let end = 0, match: RegExpExecArray | null;
					pattern.lastIndex = 0;
					while (match = pattern.exec(text)) {
						if (match[0].length === 0) {
							this.failSearch('Regular expressions must match at least one character');
							return;
						}
						fragment.appendChild(document.createTextNode(text.substring(end, match.index)));
						const span = document.createElement('span');
						span.className = CLASS_FIND_MATCH;
						span.textContent = match[0];
						fragment.appendChild(span);
						end = pattern.lastIndex;
					}
					if (end > 0) {
						fragment.appendChild(document.createTextNode(text.substring(end)));
						node.parentNode!.replaceChild(fragment, node);
					}
				}
			}
		}
		const previousIndex = currentHash === null ? -1 : this.matches.findIndex(match => match.hash === currentHash);
		this.updatePosition(this.matches.length === 0 ? -1 : Math.max(0, previousIndex), scrollToCommit);
	}

	private clearMatches() {
		for (const match of this.matches) {
			match.elem.classList.remove(CLASS_FIND_CURRENT_COMMIT);
			for (const span of Array.from(match.elem.querySelectorAll('.' + CLASS_FIND_MATCH))) {
				const parent = span.parentNode!;
				parent.replaceChild(document.createTextNode(span.textContent || ''), span);
				parent.normalize();
			}
		}
	}

	private updatePosition(position: number, scrollToCommit: boolean) {
		if (this.position > -1) this.matches[this.position].elem.classList.remove(CLASS_FIND_CURRENT_COMMIT);
		this.position = position;
		if (position > -1) {
			this.matches[position].elem.classList.add(CLASS_FIND_CURRENT_COMMIT);
			if (scrollToCommit) this.view.scrollToCommit(this.matches[position].hash, false);
		}
		this.prevElem.hidden = this.nextElem.hidden = this.matches.length === 0;
		this.clearElem.hidden = this.text === '' && !this.hasFocus();
		alterClass(this.widgetElem, 'hasText', this.inputElem.value !== '');
		const count = this.matches.length > 0 ? (position + 1) + ' of ' + this.matches.length : 'No matches';
		this.inputElem.title = this.error !== null ? this.error : this.text === '' ? 'Search descriptions' : 'Search descriptions: ' + count;
		this.inputElem.setAttribute('aria-invalid', String(this.error !== null));
		this.view.saveState();
	}

	private move(direction: number) {
		if (this.matches.length === 0) return;
		this.updatePosition((this.position + direction + this.matches.length) % this.matches.length, true);
	}
}
