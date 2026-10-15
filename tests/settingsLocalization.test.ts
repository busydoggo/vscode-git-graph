import * as fs from 'fs';
import * as path from 'path';

const readJson = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'));
const manifest = readJson('package.json');
const english: { [key: string]: string } = readJson('package.nls.json');
const chinese: { [key: string]: string } = readJson('package.nls.zh-cn.json');
const properties = manifest.contributes.configuration.properties;
const textFields = new Set(['title', 'description', 'markdownDescription', 'deprecationMessage', 'markdownDeprecationMessage', 'errorMessage', 'patternErrorMessage']);
const arrayFields = new Set(['enumDescriptions', 'markdownEnumDescriptions', 'enumItemLabels']);
const reference = /^%([^%]+)%$/;
const resolve = (value: string, bundle: { [key: string]: string }) => bundle[value.match(reference)![1]];

function collect(value: any, texts: string[] = []) {
	if (Array.isArray(value)) value.forEach(item => collect(item, texts));
	else if (value !== null && typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) {
			if (textFields.has(key) && typeof item === 'string') texts.push(item);
			else if (arrayFields.has(key)) texts.push(...item as string[]);
			else collect(item, texts);
		}
	}
	return texts;
}

describe('Chinese settings localization', () => {
	it('Provides English fallback and Chinese translations for every settings text', () => {
		const texts = collect(manifest.contributes.configuration);
		expect(texts.length).toBeGreaterThan(300);
		const used = new Set<string>();
		for (const value of texts) {
			expect(value).toMatch(reference);
			const key = value.match(reference)![1];
			used.add(key);
			expect(typeof english[key]).toBe('string');
			expect(typeof chinese[key]).toBe('string');
			expect(english[key].trim()).not.toBe('');
			expect(chinese[key].trim()).not.toBe('');
		}
		expect(Array.from(used).sort()).toEqual(Object.keys(english).sort());
		expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
	});

	it('Localizes setting descriptions, nested labels and deprecation messages', () => {
		expect(resolve(manifest.contributes.configuration.title, chinese)).toBe('VS Git Graph 设置');
		expect(resolve(properties['vs-git-graph.contextMenuActionsVisibility'].properties.branch.properties.checkout.title, chinese)).toBe('检出分支');
		for (const setting of Object.values(properties) as any[]) {
			const description = setting.markdownDescription || setting.description;
			expect(resolve(description, chinese)).toMatch(/[\u3400-\u9fff]/);
			if (setting.deprecationMessage) expect(resolve(setting.deprecationMessage, chinese)).toContain('已弃用');
		}
	});

	it('Shows translated options while retaining the values stored in settings.json', () => {
		const fileView = properties['vs-git-graph.commitDetailsView.fileView.type'];
		expect(fileView.enum).toEqual(['File Tree', 'File List']);
		expect(fileView.default).toBe('File Tree');
		expect(fileView.enumItemLabels.map((value: string) => resolve(value, english))).toEqual(fileView.enum);
		expect(fileView.enumItemLabels.map((value: string) => resolve(value, chinese))).toEqual(['文件树', '文件列表']);
		for (const setting of Object.values(properties) as any[]) {
			if (setting.enum) expect(setting.enumItemLabels).toHaveLength(setting.enum.length);
		}
	});

	it('Preserves documentation links, setting references and code examples in translations', () => {
		for (const key of Object.keys(english)) {
			const links = (value: string) => value.match(/https?:\/\/[^\s)]+/g) || [];
			const code = (value: string) => value.match(/`[^`]+`/g) || [];
			expect(links(chinese[key])).toEqual(links(english[key]));
			expect(code(chinese[key])).toEqual(code(english[key]));
		}
	});
});
