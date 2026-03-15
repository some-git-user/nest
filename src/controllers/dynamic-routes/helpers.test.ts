import {NagiosReturnValuesEnum} from '../../types/nagios';
import {
	buildInvalidCodeResponse,
	clearPluginRequireCache,
	getPluginFunction,
	isKnownNagiosCode,
	normalizePluginResult,
	parseUrlParams,
} from './helpers';

describe('dynamic-routes helpers', () => {
	test('parseUrlParams decodes and splits query parameters', () => {
		const params = parseUrlParams(
			'/check-test?nagiosReturnMessage=hello%20world&nagiosReturnValue=1&performanceData=true',
		);

		expect(params).toEqual({
			'/check-test': undefined,
			nagiosReturnMessage: 'hello world',
			nagiosReturnValue: '1',
			performanceData: 'true',
		});
	});

	test('parseUrlParams keeps unknown keys unchanged', () => {
		const params = parseUrlParams(
			'/check-test?nagiosReturnMessage=hello&nagiosRetunValue=2&performanceData=true',
		);

		expect(params).toEqual({
			'/check-test': undefined,
			nagiosReturnMessage: 'hello',
			nagiosRetunValue: '2',
			performanceData: 'true',
		});
	});

	test('getPluginFunction returns first function export and undefined otherwise', () => {
		const fn = () => Promise.resolve({message: 'ok', code: 0});
		expect(getPluginFunction({checkA: 'x', checkB: fn})).toBe(fn);
		expect(getPluginFunction({checkA: 'x'})).toBeUndefined();
	});

	test('clearPluginRequireCache resolves and deletes cache entry', () => {
		const resolved = '/tmp/check.js';
		require.cache[resolved] = {id: resolved} as unknown as NodeModule;

		const requireFn = {
			resolve: jest.fn().mockReturnValue(resolved),
		} as unknown as NodeJS.Require;
		const warn = jest.fn();

		clearPluginRequireCache(requireFn, resolved, warn);

		expect(requireFn.resolve).toHaveBeenCalledWith(resolved);
		expect(require.cache[resolved]).toBeUndefined();
		expect(warn).not.toHaveBeenCalled();
	});

	test('clearPluginRequireCache warns when resolve fails', () => {
		const requireFn = {
			resolve: jest.fn().mockImplementation(() => {
				throw new Error('resolve failed');
			}),
		} as unknown as NodeJS.Require;
		const warn = jest.fn();

		clearPluginRequireCache(requireFn, '/tmp/check.js', warn);

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				'Could not resolve plugin path for cache clearing',
			),
		);
	});

	test('clearPluginRequireCache stringifies non-Error resolve failures', () => {
		const requireFn = {
			resolve: jest.fn().mockImplementation(() => {
				throw 'resolve failed' as unknown as Error;
			}),
		} as unknown as NodeJS.Require;
		const warn = jest.fn();

		clearPluginRequireCache(requireFn, '/tmp/check.js', warn);

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('Error: resolve failed'),
		);
	});

	test('normalizePluginResult normalizes missing fields and validates perf data', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				code: 999,
				performanceData: {bad: true},
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.message).toContain('did not return a message');
		expect(normalized.code).toBe(NagiosReturnValuesEnum.UNKNOWN);
		expect(normalized.performanceData).toBeUndefined();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('returned invalid performanceData'),
		);
	});

	test('normalizePluginResult throws for invalid non-object result', () => {
		expect(() =>
			normalizePluginResult('bad-result', '/tmp/check.js', jest.fn()),
		).toThrow('did not return a valid object');
	});

	test('isKnownNagiosCode validates known enum values', () => {
		expect(isKnownNagiosCode(NagiosReturnValuesEnum.OK)).toBe(true);
		expect(isKnownNagiosCode(NagiosReturnValuesEnum.WARNING)).toBe(true);
		expect(isKnownNagiosCode(9 as NagiosReturnValuesEnum)).toBe(false);
		expect(
			isKnownNagiosCode(undefined as unknown as NagiosReturnValuesEnum),
		).toBe(false);
	});

	test('buildInvalidCodeResponse creates UNKNOWN nagios payload', () => {
		const response = buildInvalidCodeResponse(
			9 as NagiosReturnValuesEnum,
			'/tmp/check.js',
			'/check-test',
			'localhost',
			5000,
		);

		expect(response.errorMessage).toContain('Invalid return code "9"');
		expect(response.nagiosReturn).toEqual({
			message: response.errorMessage,
			code: 3,
		});
	});
});
