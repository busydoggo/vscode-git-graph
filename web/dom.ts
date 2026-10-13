/** Update only attributes owned by the renderer, preserving interaction classes. */
function syncRenderedAttributes(current: Element, next: Element, previous: Element = current) {
	const names = new Set(Array.from(previous.attributes, attr => attr.name).concat(Array.from(next.attributes, attr => attr.name)));
	names.forEach(name => {
		const before = previous.getAttribute(name), after = next.getAttribute(name);
		if (before === after) return;
		if (name === 'class') {
			const oldClasses = (before || '').split(' ').filter(Boolean), newClasses = (after || '').split(' ').filter(Boolean);
			oldClasses.filter(value => !newClasses.includes(value)).forEach(value => current.classList.remove(value));
			newClasses.filter(value => !current.classList.contains(value)).forEach(value => current.classList.add(value));
		} else if (after === null) {
			current.removeAttribute(name);
		} else {
			current.setAttribute(name, after);
		}
	});
}

/** Match the named parts of a description independently of their position. */
function syncRenderedChildren(current: Element, next: Element, previous: Element, children = Array.from(current.children)) {
	const key = (element: Element) => [element.tagName, element.classList.item(0), element.getAttribute('data-name'), element.getAttribute('data-remote')].join(':');
	const snapshots = new Map(Array.from(previous.children, element => [key(element), element] as [string, Element]));
	const existing = new Map(children.map(element => [key(element), element] as [string, Element]));
	let cursor = current.firstElementChild;
	Array.from(next.children).forEach(child => {
		const id = key(child), before = snapshots.get(id);
		const element = existing.get(id) || child.cloneNode(true) as Element;
		if (before) syncRenderedElement(element, child, before);
		if (element !== cursor) current.insertBefore(element, cursor);
		cursor = element.nextElementSibling;
		existing.delete(id);
	});
	existing.forEach(element => element.remove());
}

/** Diff against the previous render, not DOM modified by highlights or label overflow. */
function syncRenderedElement(current: Element, next: Element, previous: Element) {
	if (previous.isEqualNode(next)) return;
	syncRenderedAttributes(current, next, previous);
	if (previous.innerHTML === next.innerHTML) return;
	if (next.classList.contains('description') || next.classList.contains('commitSummary')) {
		syncRenderedChildren(current, next, previous);
		return;
	}
	if (next.classList.contains('commitBranches')) {
		// Labels may have moved into the overflow popup; retain their nodes and highlights.
		const inline = current.querySelector('.commitBranchLabels')!;
		syncRenderedChildren(inline, next.querySelector('.commitBranchLabels')!, previous.querySelector('.commitBranchLabels')!, Array.from(current.querySelectorAll('.gitRef')));
		Array.from(inline.children).forEach((label, index) => {
			if (label.getAttribute('data-branch-order') !== String(index)) label.setAttribute('data-branch-order', String(index));
		});
		return;
	}
	if (current.childNodes.length !== previous.childNodes.length || previous.childNodes.length !== next.childNodes.length) {
		current.innerHTML = next.innerHTML;
		return;
	}
	Array.from(next.childNodes).forEach((child, index) => {
		const before = previous.childNodes[index], actual = current.childNodes[index];
		if (before.isEqualNode(child)) return;
		if (actual.nodeType === 1 && before.nodeType === 1 && child.nodeType === 1 && (<Element>actual).tagName === (<Element>child).tagName && (<Element>before).tagName === (<Element>child).tagName) {
			syncRenderedElement(<Element>actual, <Element>child, <Element>before);
		} else if (actual.nodeType === 3 && child.nodeType === 3) {
			actual.textContent = child.textContent;
		} else {
			current.replaceChild(child.cloneNode(true), actual);
		}
	});
}

/** Keep the table, header and commit rows alive across repository data updates. */
class CommitTableRenderer {
	private headerHtml: string = '';
	private rows = new Map<string, { element: HTMLTableRowElement, snapshot: HTMLTableRowElement }>();

	public render(container: HTMLElement, html: string) {
		const next = document.createElement('table');
		next.innerHTML = html;
		let table = container.querySelector('table');
		if (table === null) {
			this.rows.clear();
			this.headerHtml = '';
			table = document.createElement('table');
			container.innerHTML = '';
			container.appendChild(table);
		}
		const body = table.tBodies[0] || table.createTBody();
		const header = <HTMLTableRowElement>next.rows[0];
		const headerChanged = this.headerHtml !== header.outerHTML;
		if (headerChanged) {
			const oldHeader = body.querySelector('#tableColHeaders');
			if (oldHeader) oldHeader.remove();
			body.insertBefore(header.cloneNode(true), body.firstChild);
			this.headerHtml = header.outerHTML;
		}
		const changedRows = new Set<HTMLElement>();
		const hashes = new Set(Array.from(next.rows).slice(1).map(row => row.dataset.hash!));
		this.rows.forEach((row, hash) => {
			if (!hashes.has(hash)) {
				row.element.remove();
				this.rows.delete(hash);
			}
		});
		let cursor: Element | null = body.firstElementChild!.nextElementSibling;
		Array.from(next.rows).slice(1).forEach(snapshot => {
			const hash = snapshot.dataset.hash!;
			const old = this.rows.get(hash);
			const element = old ? old.element : <HTMLTableRowElement>snapshot.cloneNode(true);
			if (old) {
				if (headerChanged || old.snapshot.cells[1].innerHTML !== snapshot.cells[1].innerHTML) changedRows.add(element);
				syncRenderedElement(element, snapshot, old.snapshot);
			} else {
				changedRows.add(element);
			}
			// Inline details belong to a commit and are repositioned by the view afterwards.
			while (cursor && cursor.id === 'cdv') cursor = cursor.nextElementSibling;
			if (element !== cursor) body.insertBefore(element, cursor);
			cursor = element.nextElementSibling;
			this.rows.set(hash, { element, snapshot });
		});
		return { headerChanged, changedRows };
	}
}
