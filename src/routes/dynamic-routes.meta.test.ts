import {isPluginMeta} from './dynamic-routes';

describe('isPluginMeta', () => {
	test('returns true for valid PluginMeta with string usage', () => {
		const result = isPluginMeta({
			usage: 'test usage',
			help: '<p>Help text</p>',
			examples: [],
		});
		expect(result).toBe(true);
	});

	test('returns true for valid PluginMeta with object usage', () => {
		const result = isPluginMeta({
			usage: {http: '/test', shell: './test.sh'},
			help: '<p>Help text</p>',
			examples: [],
		});
		expect(result).toBe(true);
	});

	test('returns false when value is null', () => {
		const result = isPluginMeta(null);
		expect(result).toBe(false);
	});

	test('returns false when value is undefined', () => {
		const result = isPluginMeta(undefined);
		expect(result).toBe(false);
	});

	test('returns false when value is a string', () => {
		const result = isPluginMeta('not an object');
		expect(result).toBe(false);
	});

	test('returns false when value is a number', () => {
		const result = isPluginMeta(123);
		expect(result).toBe(false);
	});

	test('returns false when value is an array', () => {
		const result = isPluginMeta([]);
		expect(result).toBe(false);
	});

	test('returns false when usage field is missing', () => {
		const result = isPluginMeta({
			help: '<p>Help text</p>',
			examples: [],
		});
		expect(result).toBe(false);
	});

	test('returns false when usage is a number', () => {
		const result = isPluginMeta({
			usage: 123,
			help: '<p>Help text</p>',
			examples: [],
		});
		expect(result).toBe(false);
	});

	test('returns false when usage is null', () => {
		const result = isPluginMeta({
			usage: null,
			help: '<p>Help text</p>',
			examples: [],
		});
		expect(result).toBe(false);
	});

	test('returns false when usage object has non-string http', () => {
		const result = isPluginMeta({
			usage: {http: 123},
			help: '<p>Help text</p>',
			examples: [],
		});
		expect(result).toBe(false);
	});

	test('returns false when usage object has non-string shell', () => {
		const result = isPluginMeta({
			usage: {shell: 123},
			help: '<p>Help text</p>',
			examples: [],
		});
		expect(result).toBe(false);
	});

	test('returns false when help field is missing', () => {
		const result = isPluginMeta({
			usage: 'test',
			examples: [],
		});
		expect(result).toBe(false);
	});

	test('returns false when help is not a valid HTML template string', () => {
		const result = isPluginMeta({
			usage: 'test',
			help: null,
			examples: [],
		});
		expect(result).toBe(false);
	});

	test('returns false when examples field is missing', () => {
		const result = isPluginMeta({
			usage: 'test',
			help: '<p>Help text</p>',
		});
		expect(result).toBe(false);
	});

	test('returns false when examples is not an array', () => {
		const result = isPluginMeta({
			usage: 'test',
			help: '<p>Help text</p>',
			examples: 'not-an-array',
		});
		expect(result).toBe(false);
	});

	test('returns false when examples is an object', () => {
		const result = isPluginMeta({
			usage: 'test',
			help: '<p>Help text</p>',
			examples: {},
		});
		expect(result).toBe(false);
	});

	test('returns false when examples is a number', () => {
		const result = isPluginMeta({
			usage: 'test',
			help: '<p>Help text</p>',
			examples: 123,
		});
		expect(result).toBe(false);
	});
});
