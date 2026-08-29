import {
	createNagiosReturnMessage,
	describeForLog,
	getNagiosStatusText,
	sanitizePerformanceData,
} from '../lib/nagios';
import type {NagiosPerformanceData} from '../types/nagios';
import {NagiosReturnCodes} from '../types/nagios';
import {logger} from './logger';

jest.mock('../lib/logger');

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

describe('createNagiosReturnMessage', () => {
	it('produces correct message and code without performance data', () => {
		const result = createNagiosReturnMessage(
			'Test message',
			NagiosReturnCodes.OK,
		);
		expect(result.message).toBe('Test message');
		expect(result.code).toBe(0);
		expect(result).not.toHaveProperty('performanceData');
	});

	describe('with performance data', () => {
		it('transforms valid data into a string', () => {
			const performanceData: NagiosPerformanceData = {
				label: 'Test',
				value: 42,
				uom: 'unit',
				warn: '43',
				crit: '44',
				min: 40,
				max: 50,
			};
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnCodes.OK,
				[performanceData],
			);

			expect(result.message).toBe('Test message');
			expect(result.code).toBe(0);
			expect(result.performanceData).toBe(
				`'${performanceData.label}'=42unit;43;44;40;50`,
			);
		});

		it('handles multiple performance data', () => {
			const performanceData1: NagiosPerformanceData = {
				label: 'Test1',
				value: 42,
				uom: 'unit',
				warn: '43',
				crit: '44',
				min: 1,
				max: 50,
			};

			const performanceData2: NagiosPerformanceData = {
				label: 'Test2',
				value: 42,
				uom: 'unit',
				warn: '43',
				crit: '44',
				min: 1,
				max: 100,
			};

			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnCodes.OK,
				[performanceData1, performanceData2],
			);

			expect(result.performanceData).toBe(
				`'${performanceData1.label}'=42unit;43;44;1;50 '${performanceData2.label}'=42unit;43;44;1;100`,
			);
		});

		it('handles null performance data', () => {
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnCodes.OK,
				undefined,
			);
			expect(result.message).toBe('Test message');
			expect(result.code).toBe(0);
		});

		it('handles empty performance data array', () => {
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnCodes.OK,
				[],
			);
			expect(result.message).toBe('Test message');
			expect(result.code).toBe(0);
			expect(result.performanceData).toBeUndefined();
		});

		it('accepts a single performance object and omits optional fields when absent', () => {
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnCodes.WARNING,
				{label: 'disk', value: 0, uom: '%'},
			);

			expect(result.code).toBe(1);
			expect(result.performanceData).toBe("'disk'=0%");
		});

		it('emits a zero value and a zero min instead of dropping them', () => {
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnCodes.OK,
				{label: 'sessions', value: 0, uom: '', min: 0, max: 100},
			);

			expect(result.performanceData).toBe("'sessions'=0;;;0;100");
		});

		it('keeps the field position of a later bound when an earlier one is absent', () => {
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnCodes.OK,
				{label: 'load', value: 1, uom: '', warn: null, crit: '5', min: '0'},
			);

			expect(result.performanceData).toBe("'load'=1;;5;0");
		});

		it('drops trailing absent fields instead of writing empty ones', () => {
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnCodes.OK,
				{
					label: 'load',
					value: 1,
					uom: '',
					warn: '4',
					crit: null,
					min: undefined,
				},
			);

			expect(result.performanceData).toBe("'load'=1;4");
		});

		it('formats value without label or uom when those fields are empty', () => {
			const performanceDataWithoutLabelOrUom: NagiosPerformanceData = {
				label: '',
				value: 5,
				uom: '',
			};

			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnCodes.OK,
				[performanceDataWithoutLabelOrUom],
			);

			expect(result.performanceData).toBe('5');
		});

		it('logs an error when performance data array contains invalid entries', () => {
			const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

			const result = createNagiosReturnMessage(
				'Bad perf',
				NagiosReturnCodes.UNKNOWN,
				[null as unknown as NagiosPerformanceData],
			);

			expect(result).not.toHaveProperty('performanceData');
			expect(errorSpy).toHaveBeenCalledTimes(1);
		});

		it('keeps the entries that are usable when only some of them are broken', () => {
			const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

			const result = createNagiosReturnMessage(
				'Partly bad perf',
				NagiosReturnCodes.UNKNOWN,
				[
					{label: 'cpu', value: 1, uom: '%'},
					null,
					{label: 'mem', value: 'n/a', uom: '%'},
				],
			);

			expect(result.performanceData).toBe("'cpu'=1%");
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy.mock.calls[0][0]).toContain('2 of 3 entries dropped');
		});
	});

	describe('sanitizePerformanceData', () => {
		it('normalizes the shape a plugin really reports', () => {
			// Observed in production: a GPU plugin builds its entries with
			// `warn: thresholds.warningTempC !== undefined ? String(...) : undefined`,
			// which leaves the keys present but undefined. Every entry is real data.
			const {entries, dropped} = sanitizePerformanceData([
				{
					label: 'gpu0_utilization_pct',
					value: '42',
					uom: '%',
					warn: undefined,
					crit: undefined,
					min: undefined,
					max: undefined,
				},
				{
					label: 'gpu0_temperature_c',
					value: '61',
					uom: 'C',
					warn: '85',
					crit: '95',
					min: 0,
					max: 105,
				},
			]);

			expect(dropped).toEqual([]);
			expect(entries).toEqual([
				{label: 'gpu0_utilization_pct', value: '42', uom: '%'},
				{
					label: 'gpu0_temperature_c',
					value: '61',
					uom: 'C',
					warn: '85',
					crit: '95',
					min: 0,
					max: 105,
				},
			]);
		});

		it('accepts a single entry instead of an array', () => {
			const {entries, dropped} = sanitizePerformanceData({
				label: 'disk',
				value: 12,
				uom: '%',
			});

			expect(dropped).toEqual([]);
			expect(entries).toEqual([{label: 'disk', value: 12, uom: '%'}]);
		});

		it('treats null, undefined and an empty array as no data at all', () => {
			expect(sanitizePerformanceData(undefined).entries).toEqual([]);
			expect(sanitizePerformanceData(null).dropped).toEqual([null]);
			expect(sanitizePerformanceData([]).entries).toEqual([]);
		});

		it('drops values that are not objects', () => {
			const {entries, dropped} = sanitizePerformanceData([
				'invalid-string',
				123,
				[{label: 'nested', value: 1, uom: ''}],
			]);

			expect(entries).toEqual([]);
			expect(dropped).toEqual([
				'invalid-string',
				123,
				[{label: 'nested', value: 1, uom: ''}],
			]);
		});

		it('drops an entry only when its value carries no number', () => {
			expect(sanitizePerformanceData({label: 'cpu', uom: '%'}).entries).toEqual(
				[],
			);
			expect(
				sanitizePerformanceData({label: 'cpu', value: 'n/a', uom: '%'}).entries,
			).toEqual([]);
			expect(
				sanitizePerformanceData({label: 'cpu', value: NaN, uom: '%'}).entries,
			).toEqual([]);
			expect(
				sanitizePerformanceData({
					label: 'cpu',
					value: Infinity,
					uom: '%',
				}).entries,
			).toEqual([]);
			expect(
				sanitizePerformanceData({
					label: 'cpu',
					value: true as unknown as number,
					uom: '%',
				}).entries,
			).toEqual([]);
		});

		it('keeps every value shape that holds a number', () => {
			const {entries} = sanitizePerformanceData([
				{label: 'int', value: 1, uom: ''},
				{label: 'float', value: '2.5', uom: ''},
				{label: 'negative', value: '-3', uom: ''},
				{label: 'padded', value: ' 7 ', uom: ''},
				{label: 'unknown', value: 'U', uom: ''},
			]);

			expect(entries.map((entry) => entry.value)).toEqual([
				1,
				'2.5',
				'-3',
				'7',
				'U',
			]);
		});

		it('accepts a threshold as a number and keeps a range expression as written', () => {
			const {entries} = sanitizePerformanceData([
				{label: 'a', value: 1, uom: '', warn: 80, crit: 90},
				{label: 'b', value: 1, uom: '', warn: '10:', crit: '@1:5'},
				{label: 'c', value: 1, uom: '', warn: ' ~25 '},
			]);

			expect(entries.map((entry) => entry.warn)).toEqual(['80', '10:', '~25']);
			expect(entries[1].crit).toBe('@1:5');
		});

		it('strips characters that would shift the positional fields from a threshold', () => {
			const {entries} = sanitizePerformanceData({
				label: 'cpu',
				value: 1,
				uom: '%',
				warn: '80;90',
				crit: '95\n',
			});

			expect(entries[0].warn).toBe('8090');
			expect(entries[0].crit).toBe('95');
		});

		it('drops a threshold that is empty or not a scalar', () => {
			const {entries} = sanitizePerformanceData([
				{label: 'a', value: 1, uom: '', warn: '   ', crit: ';;'},
				{
					label: 'b',
					value: 1,
					uom: '',
					warn: true as unknown as string,
					crit: {at: 5} as unknown as string,
				},
				{label: 'c', value: 1, uom: '', warn: NaN, crit: Infinity},
			]);

			for (const entry of entries) {
				expect(entry).not.toHaveProperty('warn');
				expect(entry).not.toHaveProperty('crit');
			}
		});

		it('normalizes min and max independently of each other', () => {
			const {entries} = sanitizePerformanceData([
				{label: 'a', value: 1, uom: '', min: 'U', max: 100},
				{
					label: 'b',
					value: 1,
					uom: '',
					min: 'abc',
					max: [] as unknown as number,
				},
				{label: 'c', value: 1, uom: '', min: null, max: undefined},
			]);

			expect(entries[0].min).toBe('U');
			expect(entries[0].max).toBe(100);
			expect(entries[1]).not.toHaveProperty('min');
			expect(entries[1]).not.toHaveProperty('max');
			expect(entries[2]).not.toHaveProperty('min');
			expect(entries[2]).not.toHaveProperty('max');
		});

		it('strips characters the spec forbids inside a label or a uom', () => {
			const {entries} = sanitizePerformanceData({
				label: "gpu=0 'die'",
				value: 1,
				uom: 'ms1',
			});

			expect(entries[0].label).toBe('gpu0 die');
			expect(entries[0].uom).toBe('ms');
		});

		it('falls back to an empty label and uom when they are not text or missing', () => {
			const {entries} = sanitizePerformanceData([
				{value: 1},
				{
					label: {name: 'cpu'} as unknown as string,
					value: 1,
					uom: ['%'] as unknown as string,
				},
				{label: 42, value: 1, uom: 7},
			]);

			expect(entries[0]).toEqual({label: '', value: 1, uom: ''});
			expect(entries[1]).toEqual({label: '', value: 1, uom: ''});
			expect(entries[2]).toEqual({label: '42', value: 1, uom: ''});
		});

		it('ignores keys the format does not have', () => {
			const {entries} = sanitizePerformanceData({
				label: 'cpu',
				value: 1,
				uom: '%',
				unit: '%',
				warning: '80',
				extra: {nested: true},
			});

			expect(entries[0]).toEqual({label: 'cpu', value: 1, uom: '%'});
		});
	});

	describe('describeForLog', () => {
		it('writes out undefined and null instead of hiding them', () => {
			// JSON.stringify drops keys with an undefined value, which is what made
			// the original production warning look like a valid payload.
			expect(describeForLog(undefined)).toBe('undefined');
			expect(describeForLog(null)).toBe('null');
			expect(describeForLog({warn: undefined, crit: null})).toBe(
				'{warn: undefined, crit: null}',
			);
		});

		it('quotes strings and renders primitives as they are', () => {
			expect(describeForLog('oops')).toBe('"oops"');
			expect(describeForLog(42)).toBe('42');
			expect(describeForLog(true)).toBe('true');
			expect(describeForLog(10n)).toBe('10');
		});

		it('names the kind of a value that has no readable form', () => {
			expect(describeForLog({fn: () => 1, sym: Symbol('s')})).toBe(
				'{fn: function, sym: symbol}',
			);
		});

		it('renders arrays and nested objects', () => {
			expect(describeForLog([1, 'two', null])).toBe('[1, "two", null]');
			expect(describeForLog([{label: 'cpu', value: undefined}])).toBe(
				'[{label: "cpu", value: undefined}]',
			);
		});

		it('bounds the depth so a cyclic payload cannot hang it', () => {
			const cyclic: Record<string, unknown> = {level: 0};
			cyclic.self = cyclic;

			expect(describeForLog(cyclic)).toBe(
				'{level: 0, self: {level: 0, self: {level: 0, self: {...}}}}',
			);
			expect(describeForLog({a: {b: {c: {d: 'too deep'}}}})).toBe(
				'{a: {b: {c: {...}}}}',
			);
			expect(describeForLog([[[['too deep']]]])).toBe('[[[[...]]]]');
		});
	});
});

describe('getNagiosStatusText', () => {
	it('returns status labels for known Nagios codes', () => {
		expect(getNagiosStatusText(NagiosReturnCodes.OK)).toBe('OK');
		expect(getNagiosStatusText(NagiosReturnCodes.WARNING)).toBe('WARNING');
		expect(getNagiosStatusText(NagiosReturnCodes.CRITICAL)).toBe('CRITICAL');
		expect(getNagiosStatusText(NagiosReturnCodes.UNKNOWN)).toBe('UNKNOWN');
	});
});
