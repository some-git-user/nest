import {createNagiosReturnMessage} from '../lib/nagios';
import {NagiosReturnValuesEnum, PerformanceData} from '../types/nagios';

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
	});
});
