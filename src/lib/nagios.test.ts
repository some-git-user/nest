import {
	createNagiosReturnMessage,
	getNagiosStatusText,
	isPerformanceData,
	isPerformanceDataArray,
} from '../lib/nagios';
import {NagiosReturnValuesEnum, PerformanceData} from '../types/nagios';
import {logger} from './logger';

jest.mock('../lib/logger');

describe('createNagiosReturnMessage', () => {
	it('produces correct message and code without performance data', () => {
		const result = createNagiosReturnMessage(
			'Test message',
			NagiosReturnValuesEnum.OK,
		);
		expect(result.message).toBe('Test message');
		expect(result.code).toBe(0);
		expect(result).not.toHaveProperty('performanceData');
	});

	describe('with performance data', () => {
		it('transforms valid data into a string', () => {
			const performanceData: PerformanceData = {
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
				NagiosReturnValuesEnum.OK,
				[performanceData],
			);

			expect(result.message).toBe('Test message');
			expect(result.code).toBe(0);
			expect(result.performanceData).toBe(
				`'${performanceData.label}':42unit;WARN=43;CRIT=44;MIN=40;MAX=50`,
			);
		});

		it('handles multiple performance data', () => {
			const performanceData1: PerformanceData = {
				label: 'Test1',
				value: 42,
				uom: 'unit',
				warn: '43',
				crit: '44',
				min: 1,
				max: 50,
			};

			const performanceData2: PerformanceData = {
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
				NagiosReturnValuesEnum.OK,
				[performanceData1, performanceData2],
			);

			expect(result.performanceData).toBe(
				`'${performanceData1.label}':42unit;WARN=43;CRIT=44;MIN=1;MAX=50 '${performanceData2.label}':42unit;WARN=43;CRIT=44;MIN=1;MAX=100`,
			);
		});

		it('handles null performance data', () => {
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnValuesEnum.OK,
				undefined,
			);
			expect(result.message).toBe('Test message');
			expect(result.code).toBe(0);
		});

		it('handles empty performance data array', () => {
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnValuesEnum.OK,
				[],
			);
			expect(result.message).toBe('Test message');
			expect(result.code).toBe(0);
			expect(result.performanceData).toBe('');
		});

		it('accepts a single performance object and omits optional fields when absent', () => {
			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnValuesEnum.WARNING,
				{label: 'disk', value: 0, uom: '%'},
			);

			expect(result.code).toBe(1);
			expect(result.performanceData).toBe("'disk':");
		});

		it('formats value without label or uom when those fields are empty', () => {
			const performanceDataWithoutLabelOrUom: PerformanceData = {
				label: '',
				value: 5,
				uom: '',
			};

			const result = createNagiosReturnMessage(
				'Test message',
				NagiosReturnValuesEnum.OK,
				[performanceDataWithoutLabelOrUom],
			);

			expect(result.performanceData).toBe('5');
		});

		it('logs an error when performance data array contains invalid entries', () => {
			const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

			const result = createNagiosReturnMessage(
				'Bad perf',
				NagiosReturnValuesEnum.UNKNOWN,
				[null as unknown as PerformanceData],
			);

			expect(result).not.toHaveProperty('performanceData');
			expect(errorSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('performance data type guards', () => {
		it('rejects non-object values and objects missing required fields', () => {
			expect(isPerformanceData('not-an-object')).toBe(false);

			expect(
				isPerformanceData({
					label: 'cpu',
					uom: '%',
				}),
			).toBe(false);

			expect(
				isPerformanceData({
					label: 'cpu',
					value: 1,
				}),
			).toBe(false);
		});

		it('accepts a valid PerformanceData object', () => {
			expect(
				isPerformanceData({
					label: 'cpu',
					value: '42.5',
					uom: '%',
					warn: '80',
					crit: '90',
					min: 'U',
					max: 100,
				}),
			).toBe(true);
		});

		it('rejects invalid labels and invalid uom values', () => {
			expect(
				isPerformanceData({
					label: "bad'label",
					value: 1,
					uom: '%',
				}),
			).toBe(false);

			expect(
				isPerformanceData({
					label: 'good',
					value: 1,
					uom: 'ms1',
				}),
			).toBe(false);
		});

		it('rejects invalid value, min and max formats', () => {
			expect(
				isPerformanceData({
					label: 'mem',
					value: 'not-a-number',
					uom: '%',
				}),
			).toBe(false);

			expect(
				isPerformanceData({
					label: 'mem',
					value: '10',
					uom: '%',
					min: 'abc',
				}),
			).toBe(false);

			expect(
				isPerformanceData({
					label: 'mem',
					value: '10',
					uom: '%',
					max: 'xyz',
				}),
			).toBe(false);
		});

		it('rejects invalid warn/crit types and non scalar min/max values', () => {
			expect(
				isPerformanceData({
					label: 'cpu',
					value: 2,
					uom: '%',
					warn: 80 as unknown as string,
				}),
			).toBe(false);

			expect(
				isPerformanceData({
					label: 'cpu',
					value: 2,
					uom: '%',
					crit: true as unknown as string,
				}),
			).toBe(false);

			expect(
				isPerformanceData({
					label: 'cpu',
					value: 2,
					uom: '%',
					min: {bad: true} as unknown as string,
				}),
			).toBe(false);

			expect(
				isPerformanceData({
					label: 'cpu',
					value: 2,
					uom: '%',
					max: [] as unknown as string,
				}),
			).toBe(false);
		});

		it('validates arrays of PerformanceData', () => {
			expect(
				isPerformanceDataArray([
					{label: 'cpu', value: 1, uom: '%'},
					{label: 'mem', value: '2', uom: '%'},
				]),
			).toBe(true);

			expect(
				isPerformanceDataArray([
					{label: 'cpu', value: 1, uom: '%'},
					{label: 'bad=label', value: 2, uom: '%'},
				]),
			).toBe(false);
		});
	});
});

describe('getNagiosStatusText', () => {
	it('returns status labels for known Nagios codes', () => {
		expect(getNagiosStatusText(NagiosReturnValuesEnum.OK)).toBe('OK');
		expect(getNagiosStatusText(NagiosReturnValuesEnum.WARNING)).toBe('WARNING');
		expect(getNagiosStatusText(NagiosReturnValuesEnum.CRITICAL)).toBe(
			'CRITICAL',
		);
		expect(getNagiosStatusText(NagiosReturnValuesEnum.UNKNOWN)).toBe('UNKNOWN');
	});
});
