import {
	declaresPluginMeta,
	getPluginMetaHelp,
	getPluginMetaParams,
	getPluginMetaUsage,
	hasParamsDeclaration,
} from './dynamic-routes';

describe('declaresPluginMeta', () => {
	test('returns false for a non-object module', () => {
		expect(declaresPluginMeta(123)).toBe(false);
		expect(declaresPluginMeta(null)).toBe(false);
		expect(declaresPluginMeta(undefined)).toBe(false);
	});

	test('returns false when meta is absent or null', () => {
		expect(declaresPluginMeta({})).toBe(false);
		expect(declaresPluginMeta({meta: null})).toBe(false);
	});

	test('returns true when meta is an object', () => {
		expect(declaresPluginMeta({meta: {}})).toBe(true);
	});
});

describe('getPluginMetaParams', () => {
	test('returns empty array when pluginModule is null', () => {
		const result = getPluginMetaParams(null);
		expect(result).toEqual([]);
	});

	test('returns empty array when pluginModule is undefined', () => {
		const result = getPluginMetaParams(undefined);
		expect(result).toEqual([]);
	});

	test('returns empty array when pluginModule is not an object', () => {
		const result = getPluginMetaParams('string' as unknown);
		expect(result).toEqual([]);
	});

	test('returns empty array when meta is null', () => {
		const result = getPluginMetaParams({meta: null});
		expect(result).toEqual([]);
	});

	test('returns empty array when meta is undefined', () => {
		const result = getPluginMetaParams({});
		expect(result).toEqual([]);
	});

	test('returns empty array when params is not an array', () => {
		const result = getPluginMetaParams({
			meta: {
				usage: 'test',
				help: '<p>test</p>',
				params: 'not-array' as unknown,
			},
		});
		expect(result).toEqual([]);
	});

	test('normalises declared params with defaults, labels and descriptions', () => {
		const result = getPluginMetaParams({
			meta: {
				usage: 'test',
				help: '<p>test</p>',
				params: [
					{
						name: ' device ',
						label: 'Device',
						required: true,
						type: 'text',
						default: '/dev/sda',
						description: 'Disk device to inspect.',
					},
				],
			},
		});
		expect(result).toEqual([
			{
				name: 'device',
				label: 'Device',
				required: true,
				type: 'text',
				default: '/dev/sda',
				description: 'Disk device to inspect.',
			},
		]);
	});

	test('falls back to the param name when label is empty and defaults optional fields', () => {
		const result = getPluginMetaParams({
			meta: {
				usage: 'test',
				help: '<p>test</p>',
				params: [{name: 'warningTempC', label: '', type: 'number'}],
			},
		});
		expect(result).toEqual([
			{
				name: 'warningTempC',
				label: 'warningTempC',
				required: false,
				type: 'number',
			},
		]);
	});

	test('passes through a default verbatim, including one with a space', () => {
		const result = getPluginMetaParams({
			meta: {
				usage: 'test',
				help: '<p>test</p>',
				params: [
					{
						name: 'command',
						label: 'CLI command',
						type: 'text',
						default: 'vdsl status',
					},
					{name: 'empty', label: 'Empty', type: 'text', default: ''},
				],
			},
		});
		// A declared default is carried through unchanged so the run form and
		// admin editor prefill it. A space is fine here: the config serializer
		// quotes it on save. The loader does not strip or transform it.
		expect(result[0]).toEqual({
			name: 'command',
			label: 'CLI command',
			required: false,
			type: 'text',
			default: 'vdsl status',
		});
		expect(result[1]).toEqual({
			name: 'empty',
			label: 'Empty',
			required: false,
			type: 'text',
			default: '',
		});
	});

	test('coerces unknown input types to text and skips malformed entries', () => {
		const result = getPluginMetaParams({
			meta: {
				usage: 'test',
				help: '<p>test</p>',
				params: [
					'name',
					{type: 'mystery'},
					{name: '   '},
					{name: 'ok', type: 'password'},
				],
			},
		});
		expect(result).toEqual([
			{name: 'ok', label: 'ok', required: false, type: 'password'},
		]);
	});
});

describe('hasParamsDeclaration', () => {
	test('returns false when pluginModule is not an object', () => {
		expect(hasParamsDeclaration('string')).toBe(false);
		expect(hasParamsDeclaration(null)).toBe(false);
	});

	test('returns false when meta is missing or null', () => {
		expect(hasParamsDeclaration({})).toBe(false);
		expect(hasParamsDeclaration({meta: null})).toBe(false);
	});

	test('returns false when params is not an array', () => {
		expect(hasParamsDeclaration({meta: {params: 'nope'}})).toBe(false);
	});

	test('returns true when params is an array, even when empty', () => {
		expect(hasParamsDeclaration({meta: {params: []}})).toBe(true);
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
				params: [],
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
				params: [],
			},
		});
		expect(result).toBeUndefined();
	});
});
