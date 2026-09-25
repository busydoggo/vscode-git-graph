import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';

const { JSDOM } = require('jsdom');
const script = ['utils', 'findWidget'].map(name => ts.transpileModule(
	fs.readFileSync(path.join(__dirname, '../web/' + name + '.ts'), 'utf8'),
	{ compilerOptions: { target: ts.ScriptTarget.ES2015 } }
).outputText).join('\n');

function setup() {
	const dom = new JSDOM('<body><table><thead><tr><th id="header"></th></tr></thead><tbody id="rows"></tbody></table></body>');
	const document = dom.window.document;
	const commits = [{ hash: 'a' }, { hash: 'b' }, { hash: 'c' }];
	const rows = '<tr class="commit" data-id="0"><td><span class="description">Fix a.b &lt;b&gt;problem&lt;/b&gt;</span></td><td>UniqueAuthor</td></tr><tr class="commit" data-id="1"><td><span class="description">Other change</span></td><td>Fix</td></tr><tr class="commit" data-id="2"><td><span class="description"><span>FIX</span> another problem</span></td><td>Bob</td></tr>';
	document.getElementById('rows').innerHTML = rows;
	const Widget = vm.runInNewContext(script + '\nFindWidget;', {
		document: document,
		window: dom.window,
		acquireVsCodeApi: () => ({}),
		getCommitElems: () => document.querySelectorAll('tr.commit')
	});
	const view = { getCommits: () => commits, saveState: jest.fn(), scrollToCommit: jest.fn() };
	const widget = new Widget(view);
	widget.mount(document.getElementById('header'), false);
	const input = document.getElementById('findInput');
	const search = (text: string) => {
		input.value = text;
		input.dispatchEvent(new dom.window.Event('input'));
	};
	return { dom, document, rows, widget, input, search, view };
}

describe('Description header search', () => {
	it('Searches descriptions without filtering rows or matching author cells', () => {
		const { document, search, widget } = setup();
		search('fix');
		expect(document.querySelectorAll('tr.commit').length).toBe(3);
		expect(document.querySelectorAll('.findMatch').length).toBe(2);
		expect(widget.getCurrentHash()).toBe('a');
		expect(document.getElementById('findPrev').hidden).toBe(false);
		search('UniqueAuthor');
		expect(document.querySelectorAll('.findMatch').length).toBe(0);
		expect(document.getElementById('findNext').hidden).toBe(true);
		expect(document.getElementById('findClose').hidden).toBe(false);
	});

	it('Navigates matches in both directions and wraps at either end', () => {
		const { dom, document, input, search, widget, view } = setup();
		search('fix');
		document.getElementById('findPrev').click();
		expect(widget.getCurrentHash()).toBe('c');
		expect(view.scrollToCommit).toHaveBeenLastCalledWith('c', false);
		document.getElementById('findNext').click();
		expect(widget.getCurrentHash()).toBe('a');
		input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
		expect(widget.getCurrentHash()).toBe('c');
	});

	it('Clears input, highlights and navigation with the clear button', () => {
		const { document, search, input, widget } = setup();
		search('fix');
		document.getElementById('findClose').click();
		expect(input.value).toBe('');
		expect(widget.getCurrentHash()).toBeNull();
		expect(document.querySelectorAll('.findMatch, .findCurrentCommit').length).toBe(0);
		expect(document.getElementById('findPrev').hidden).toBe(true);
		expect(document.getElementById('findClose').hidden).toBe(true);
		expect(document.activeElement).not.toBe(input);
		expect(widget.isVisible()).toBe(false);
	});

	it('Shows exit immediately on focus and exits an empty search without typing', () => {
		const { document, input, widget } = setup();
		input.focus();
		expect(input.value).toBe('');
		expect(document.getElementById('findClose').hidden).toBe(false);
		document.getElementById('findClose').focus();
		expect(document.getElementById('findClose').hidden).toBe(false);
		document.getElementById('findClose').click();
		expect(document.getElementById('findClose').hidden).toBe(true);
		expect(widget.hasFocus()).toBe(false);
		expect(widget.isVisible()).toBe(false);
	});

	it('Preserves focus, search and current match across table rebuilds without duplicating highlights', () => {
		const { document, rows, search, input, widget } = setup();
		search('fix');
		document.getElementById('findNext').click();
		input.focus();
		input.setSelectionRange(1, 2);
		const focus = widget.hasFocus();
		document.getElementById('header').innerHTML = '';
		document.getElementById('rows').innerHTML = rows;
		widget.mount(document.getElementById('header'), focus);
		widget.refresh();
		widget.refresh();
		expect(document.activeElement).toBe(input);
		expect(input.selectionStart).toBe(1);
		expect(widget.getCurrentHash()).toBe('c');
		expect(document.querySelectorAll('.findMatch').length).toBe(2);
	});

	it('Treats punctuation and HTML-like text literally, and waits for IME composition', () => {
		const { dom, document, input, search, widget } = setup();
		search('a.b');
		expect(document.querySelector('.findMatch').textContent).toBe('a.b');
		search('<b>');
		expect(document.querySelector('.findMatch').textContent).toBe('<b>');
		expect(document.querySelectorAll('b').length).toBe(0);
		input.value = 'Other';
		input.dispatchEvent(new dom.window.InputEvent('input', { isComposing: true }));
		expect(widget.getCurrentHash()).toBe('a');
		input.dispatchEvent(new dom.window.Event('compositionend'));
		expect(widget.getCurrentHash()).toBe('b');
	});
	it('Switches between literal partial matching and regular expressions, retaining input focus', () => {
		const { document, input, search, widget } = setup();
		input.focus();
		search('^fix');
		expect(widget.getCurrentHash()).toBeNull();
		document.getElementById('findMode').click();
		expect(document.getElementById('findMode').textContent).toBe('正则');
		expect(document.querySelectorAll('.findMatch').length).toBe(2);
		expect(document.activeElement).toBe(input);
		const state = widget.getState();
		document.getElementById('findMode').click();
		expect(widget.getCurrentHash()).toBeNull();
		widget.restoreState(state);
		expect(document.getElementById('findMode').getAttribute('aria-pressed')).toBe('true');
		expect(document.querySelectorAll('.findMatch').length).toBe(2);
	});

	it('Handles invalid and zero-length regular expressions, and recovers when corrected', () => {
		const { document, input, search, widget } = setup();
		document.getElementById('findMode').click();
		search('[');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(document.getElementById('findNext').hidden).toBe(true);
		search('^');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(widget.getCurrentHash()).toBeNull();
		search('fix|other');
		expect(input.getAttribute('aria-invalid')).toBe('false');
		expect(document.querySelectorAll('.findMatch').length).toBe(4);
	});

});
