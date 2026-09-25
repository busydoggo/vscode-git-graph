import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';

const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../web/main.ts'), 'utf8');
const script = ts.transpileModule(source.slice(0, source.indexOf('/* Main */')), {
	compilerOptions: { target: ts.ScriptTarget.ES2015 }
}).outputText;

function setup(labelWidths: number[] = [100]) {
	const dom = new JSDOM('<body><div id="view"><table id="commitTable"><tr id="tableColHeaders"></tr><tr class="commit"><td class="descriptionCell"><span class="description"><span class="commitSummary"><span class="text">Commit message</span></span><span class="commitBranches"><button class="branchLabelsHint"></button><span class="commitBranchLabels"></span><span class="branchLabelsPopup"></span></span></td></tr></table></div></body>');
	const document = dom.window.document;
	const View = vm.runInNewContext(script + '\nGitGraphView;', { document, getComputedStyle: dom.window.getComputedStyle });
	const view = Object.assign(Object.create(View.prototype), { tableElem: document.getElementById('commitTable'), viewElem: document.getElementById('view') });
	let width = 300;
	Object.defineProperty(document.querySelector('.description'), 'clientWidth', { get: () => Math.round(width) });
	document.querySelector('.description').getBoundingClientRect = () => ({ width });
	document.querySelector('.commitSummary').getBoundingClientRect = () => ({ width: view.tableElem.classList.contains('measuringBranchLabels') ? 160 : width - 108 });
	const text = document.querySelector('.text'), labels = document.querySelector('.commitBranchLabels');
	Object.defineProperties(text, { scrollWidth: { value: 160 }, offsetWidth: { value: 100 }, clientWidth: { value: 100 } });
	const popup = document.querySelector('.branchLabelsPopup');
	Object.defineProperty(popup, 'offsetHeight', { value: 30 });
	labelWidths.forEach((labelWidth, index) => {
		const label = document.createElement('span');
		label.className = 'gitRef head';
		label.dataset.name = 'branch' + index;
		label.textContent = 'branch' + index;
		label.getBoundingClientRect = () => ({ width: labelWidth });
		labels.appendChild(label);
	});
	const group = document.querySelector('.commitBranches');
	group.getBoundingClientRect = () => ({ top: 100, right: 250 });
	document.getElementById('tableColHeaders').getBoundingClientRect = () => ({ bottom: 40 });
	return { view, document, group, labels, popup, resize: (value: number) => { width = value; view.updateBranchLabelLayout(); } };
}

describe('Description branch labels', () => {
	it('Switches between inline labels and a popup as the available width changes', () => {
		const { group, labels, resize } = setup();
		resize(300);
		expect(group.classList.contains('branchLabelsOverflow')).toBe(false);
		resize(220);
		expect(group.classList.contains('branchLabelsOverflow')).toBe(true);
		resize(300);
		expect(group.classList.contains('branchLabelsOverflow')).toBe(false);
		expect(group.querySelector('.commitBranchLabels')).toBe(labels);
		expect(labels.querySelector('.gitRef').closest('tr').className).toBe('commit');
	});

	it('Keeps the complete labels that fit and moves only the remainder into the popup', () => {
		const { document, group, labels, popup, resize } = setup([60, 70, 80]);
		const original = Array.from<any>(labels.children);
		const clicked = jest.fn();
		original[2].addEventListener('click', clicked);
		resize(335);
		expect(Array.from(labels.children)).toEqual(original.slice(0, 2));
		expect(Array.from(popup.children)).toEqual(original.slice(2));
		expect(group.querySelector('.branchLabelsHint').title).toBe('Show 1 more branch label');
		original[2].dispatchEvent(new document.defaultView.MouseEvent('click'));
		expect(clicked).toHaveBeenCalledTimes(1);
		resize(700);
		expect(Array.from(labels.children)).toEqual(original);
		expect(popup.children).toHaveLength(0);
		expect(group.classList.contains('branchLabelsOverflow')).toBe(false);
	});

	it('Skips an oversized label so later short labels can still use the available space', () => {
		const { labels, popup, resize } = setup([190, 60, 60]);
		resize(319);
		expect(Array.from(labels.children, (label: any) => label.dataset.name)).toEqual(['branch1', 'branch2']);
		expect(Array.from(popup.children, (label: any) => label.dataset.name)).toEqual(['branch0']);
		resize(700);
		expect(Array.from(labels.children, (label: any) => label.dataset.name)).toEqual(['branch0', 'branch1', 'branch2']);
		resize(180);
		expect(labels.children).toHaveLength(0);
		expect(popup.children).toHaveLength(3);
	});

	it('Uses natural content width instead of flex-grown whitespace and preserves fractional pixels', () => {
		const { view, document, labels, popup, resize } = setup([100.4]);
		const summary = document.querySelector('.commitSummary');
		summary.getBoundingClientRect = () => ({ width: view.tableElem.classList.contains('measuringBranchLabels') ? 160.2 : 431.6 });
		resize(540);
		expect(labels.children).toHaveLength(1);
		expect(popup.children).toHaveLength(0);
		resize(268.625);
		expect(labels.children).toHaveLength(1);
		expect(popup.children).toHaveLength(0);
		resize(268.5);
		expect(labels.children).toHaveLength(0);
		expect(popup.children).toHaveLength(1);
		expect(view.tableElem.classList.contains('measuringBranchLabels')).toBe(false);
	});

	it('Calculates adjacent commits independently when the preceding row has two labels', () => {
		const { view, document, labels, popup, resize } = setup([100.4]);
		const row = document.querySelector('tr.commit').cloneNode(true);
		row.querySelector('.commitBranchLabels').innerHTML = '<span class="gitRef">first</span><span class="gitRef">second</span>';
		row.querySelector('.description').getBoundingClientRect = () => ({ width: 400 });
		row.querySelector('.commitSummary').getBoundingClientRect = () => ({ width: 160 });
		row.querySelectorAll('.gitRef').forEach((label: any) => {
			label.getBoundingClientRect = () => ({ width: 100.4 });
		});
		document.querySelector('tr.commit').before(row);
		resize(400);
		expect(row.querySelector('.commitBranchLabels').children).toHaveLength(2);
		expect(labels.children).toHaveLength(1);
		expect(popup.children).toHaveLength(0);
		expect(view.tableElem.classList.contains('measuringBranchLabels')).toBe(false);
	});

	it('Bounds the popup to the viewport and opens below rows too close to the header', () => {
		const { view, document, group, resize } = setup();
		resize(220);
		view.positionBranchLabels(document.querySelector('tr.commit'));
		expect(group.style.getPropertyValue('--branch-popup-width')).toBe('242px');
		expect(group.classList.contains('branchLabelsBelow')).toBe(false);
		group.getBoundingClientRect = () => ({ top: 50, right: 250 });
		view.positionBranchLabels(document.querySelector('tr.commit'));
		expect(group.classList.contains('branchLabelsBelow')).toBe(true);
	});
});
