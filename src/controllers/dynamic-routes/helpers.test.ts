import type {} from '../../types/nagios';
import {NagiosReturnCodes} from '../../types/nagios';
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
			nagiosReturnMessage: 'hello',
			nagiosRetunValue: '2',
			performanceData: 'true',
		});
	});

	test('parseUrlParams returns empty object for URL without query string', () => {
		const params = parseUrlParams('/check-test');
		expect(params).toEqual({});
	});

	test('parseUrlParams returns empty object for empty string', () => {
		const params = parseUrlParams('');
		expect(params).toEqual({});
	});

	test('parseUrlParams handles + as space in query values', () => {
		const params = parseUrlParams('/check-test?message=Hello+World');
		expect(params).toEqual({message: 'Hello World'});
	});

	test('parseUrlParams handles boolean string values', () => {
		const params = parseUrlParams('/check-test?flag=true&disabled=false');
		expect(params).toEqual({flag: 'true', disabled: 'false'});
	});

	test('parseUrlParams handles numeric string values', () => {
		const params = parseUrlParams(
			'/check-test?count=42&price=19.99&negative=-5',
		);
		expect(params).toEqual({count: '42', price: '19.99', negative: '-5'});
	});

	test('coerceParams converts string "true" to boolean true', () => {
		const {coerceParams} = require('./helpers');
		const result = coerceParams({flag: 'true'});
		expect(result).toEqual({flag: true});
	});

	test('coerceParams converts string "false" to boolean false', () => {
		const {coerceParams} = require('./helpers');
		const result = coerceParams({flag: 'false'});
		expect(result).toEqual({flag: false});
	});

	test('coerceParams converts numeric strings to numbers', () => {
		const {coerceParams} = require('./helpers');
		const result = coerceParams({count: '42', price: '19.99', negative: '-5'});
		expect(result).toEqual({count: 42, price: 19.99, negative: -5});
	});

	test('coerceParams keeps non-numeric strings as strings', () => {
		const {coerceParams} = require('./helpers');
		const result = coerceParams({name: 'test', empty: ''});
		expect(result).toEqual({name: 'test', empty: ''});
	});

	test('coerceParams handles mixed parameter types', () => {
		const {coerceParams} = require('./helpers');
		const result = coerceParams({
			flag: 'true',
			count: '42',
			name: 'test',
			price: '19.99',
		});
		expect(result).toEqual({
			flag: true,
			count: 42,
			name: 'test',
			price: 19.99,
		});
	});

	test('getPluginFunction prefers exports named check* and returns undefined otherwise', () => {
		const helperFn = () => Promise.resolve({Accept: 'application/json'});
		const checkFn = () => Promise.resolve({message: 'ok', code: 0});

		expect(
			getPluginFunction({
				meta: {usage: '/plugins/check-fake'},
				buildHeaders: helperFn,
				checkNextcloudServerinfo: checkFn,
			}),
		).toBe(checkFn);
		expect(getPluginFunction({buildHeaders: helperFn})).toBe(helperFn);
		expect(getPluginFunction({checkA: 'x'})).toBeUndefined();
		expect(getPluginFunction(null)).toBeUndefined();
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
		expect(normalized.code).toBe(NagiosReturnCodes.UNKNOWN);
		expect(normalized.performanceData).toEqual([]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('returned invalid performanceData'),
		);
	});

	test('normalizePluginResult warns for invalid performanceData string', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: 0,
				performanceData: 'invalid-string',
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.performanceData).toEqual([]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('returned invalid performanceData'),
		);
	});

	test('normalizePluginResult warns for invalid performanceData number', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: 0,
				performanceData: 123,
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.performanceData).toEqual([]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('returned invalid performanceData'),
		);
	});

	test('normalizePluginResult accepts valid performanceData array', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: 0,
				performanceData: [
					{label: 'cpu', value: 50, uom: '%'},
					{label: 'memory', value: 75, uom: '%'},
				],
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.performanceData).toEqual([
			{label: 'cpu', value: 50, uom: '%'},
			{label: 'memory', value: 75, uom: '%'},
		]);
		expect(warn).not.toHaveBeenCalled();
	});

	test('normalizePluginResult accepts entries whose optional fields are present but undefined', () => {
		// Regression: check_nvidia_smi builds its entries with
		// `warn: thresholds.x !== undefined ? String(...) : undefined`, so a metric
		// without a configured threshold has the key present with an undefined
		// value. That used to invalidate the whole array, which dropped every
		// metric and logged a misleading warning on each run.
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'OK: NVIDIA driver detected',
				code: 0,
				performanceData: [
					{
						label: 'gpu_count',
						value: '1',
						uom: '',
						min: '0',
						max: undefined,
					},
					{
						label: 'gpu0_utilization_pct',
						value: '42',
						uom: '%',
						warn: undefined,
						crit: undefined,
						min: '0',
						max: '100',
					},
				],
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.performanceData).toHaveLength(2);
		expect(warn).not.toHaveBeenCalled();
	});

	test('normalizePluginResult accepts valid single performanceData object', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: 0,
				performanceData: {label: 'disk', value: 80, uom: '%'},
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.performanceData).toEqual([
			{label: 'disk', value: 80, uom: '%'},
		]);
		expect(warn).not.toHaveBeenCalled();
	});

	test('normalizePluginResult throws for invalid non-object result', () => {
		expect(() =>
			normalizePluginResult('bad-result', '/tmp/check.js', jest.fn()),
		).toThrow('did not return a valid object');
	});

	test('isKnownNagiosCode validates known enum values', () => {
		expect(isKnownNagiosCode(NagiosReturnCodes.OK)).toBe(true);
		expect(isKnownNagiosCode(NagiosReturnCodes.WARNING)).toBe(true);
		expect(isKnownNagiosCode(9)).toBe(false);
		expect(isKnownNagiosCode(-1)).toBe(false);
	});

	test('buildInvalidCodeResponse creates UNKNOWN nagios payload', () => {
		const response = buildInvalidCodeResponse(
			9,
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

	test('buildInvalidCodeResponse handles string code', () => {
		const response = buildInvalidCodeResponse(
			'9',
			'/tmp/check.js',
			'/check-test',
			'localhost',
			5000,
		);

		expect(response.errorMessage).toContain('Invalid return code "9"');
		expect(response.nagiosReturn.code).toBe(3);
	});

	test('buildInvalidCodeResponse handles unknown code type', () => {
		const response = buildInvalidCodeResponse(
			undefined,
			'/tmp/check.js',
			'/check-test',
			'localhost',
			5000,
		);

		expect(response.errorMessage).toContain(
			'Invalid return code "unkown code"',
		);
		expect(response.nagiosReturn.code).toBe(3);
	});

	test('normalizePluginResult handles performanceData as array', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: 0,
				performanceData: [],
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.performanceData).toEqual([]);
		expect(warn).not.toHaveBeenCalled();
	});

	test('normalizePluginResult accepts code 0', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: 0,
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(0);
	});

	test('normalizePluginResult accepts code 1', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'warning',
				code: 1,
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(1);
	});

	test('normalizePluginResult accepts code 2', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'critical',
				code: 2,
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(2);
	});

	test('normalizePluginResult accepts code 3', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'unknown',
				code: 3,
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(3);
	});

	test('normalizePluginResult accepts string code "0"', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: '0',
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(0);
	});

	test('normalizePluginResult accepts string code "1"', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'warning',
				code: '1',
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(1);
	});

	test('normalizePluginResult accepts string code "2"', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'critical',
				code: '2',
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(2);
	});

	test('normalizePluginResult accepts string code "3"', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'unknown',
				code: '3',
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(3);
	});

	test('normalizePluginResult handles invalid string code', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: 'invalid',
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(NagiosReturnCodes.UNKNOWN);
	});

	test('normalizePluginResult handles code as boolean', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: true,
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(NagiosReturnCodes.UNKNOWN);
	});

	test('normalizePluginResult handles code as object', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: {value: 0},
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(NagiosReturnCodes.UNKNOWN);
	});

	test('normalizePluginResult handles string code that parses to NaN', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				code: 'not-a-number',
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(NagiosReturnCodes.UNKNOWN);
	});

	test('normalizePluginResult handles missing code field', () => {
		const warn = jest.fn();
		const normalized = normalizePluginResult(
			{
				message: 'ok',
				// code field is missing
			},
			'/tmp/check.js',
			warn,
		);

		expect(normalized.code).toBe(NagiosReturnCodes.UNKNOWN);
	});
});
