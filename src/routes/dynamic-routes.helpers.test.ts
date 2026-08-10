import {
	getPluginMetaExamples,
	getPluginMetaHelp,
	getPluginMetaUsage,
} from './dynamic-routes';

describe('getPluginMetaExamples', () => {
	test('returns empty array when pluginModule is null', () => {
		const result = getPluginMetaExamples(null);
		expect(result).toEqual([]);
	});

	test('returns empty array when pluginModule is undefined', () => {
		const result = getPluginMetaExamples(undefined);
		expect(result).toEqual([]);
	});

	test('returns empty array when pluginModule is not an object', () => {
		const result = getPluginMetaExamples('string' as unknown);
		expect(result).toEqual([]);
	});

	test('returns empty array when meta is null', () => {
		const result = getPluginMetaExamples({meta: null});
		expect(result).toEqual([]);
	});

	test('returns empty array when meta is undefined', () => {
		const result = getPluginMetaExamples({});
		expect(result).toEqual([]);
	});

	test('returns empty array when examples is not an array', () => {
		const result = getPluginMetaExamples({
			meta: {
				usage: 'test',
				help: '<p>test</p>',
				examples: 'not-array' as unknown,
			},
		});
		expect(result).toEqual([]);
	});
});

describe('getPluginMetaUsage', () => {
	test('returns undefined when pluginModule is null', () => {
		const result = getPluginMetaUsage(null);
		expect(result).toBeUndefined();
	});

	test('returns undefined when pluginModule is undefined', () => {
		const result = getPluginMetaUsage(undefined);
		expect(result).toBeUndefined();
	});

	test('returns undefined when pluginModule is not an object', () => {
		const result = getPluginMetaUsage('string' as unknown);
		expect(result).toBeUndefined();
	});

	test('returns undefined when meta is null', () => {
		const result = getPluginMetaUsage({meta: null});
		expect(result).toBeUndefined();
	});

	test('returns undefined when meta is undefined', () => {
		const result = getPluginMetaUsage({});
		expect(result).toBeUndefined();
	});

	test('returns undefined when usage is not a string or object', () => {
		const result = getPluginMetaUsage({
			meta: {
				usage: 123 as unknown,
				help: '<p>test</p>',
				examples: [],
			},
		});
		expect(result).toBeUndefined();
	});
});

describe('getPluginMetaHelp', () => {
	test('returns undefined when pluginModule is null', () => {
		const result = getPluginMetaHelp(null);
		expect(result).toBeUndefined();
	});

	test('returns undefined when pluginModule is undefined', () => {
		const result = getPluginMetaHelp(undefined);
		expect(result).toBeUndefined();
	});

	test('returns undefined when pluginModule is not an object', () => {
		const result = getPluginMetaHelp('string' as unknown);
		expect(result).toBeUndefined();
	});

	test('returns undefined when meta is null', () => {
		const result = getPluginMetaHelp({meta: null});
		expect(result).toBeUndefined();
	});

	test('returns undefined when meta is undefined', () => {
		const result = getPluginMetaHelp({});
		expect(result).toBeUndefined();
	});

	test('returns undefined when meta is not valid PluginMeta', () => {
		const result = getPluginMetaHelp({
			meta: {
				usage: 'test',
				help: 'not-html',
				examples: [],
			},
		});
		expect(result).toBeUndefined();
	});
});
