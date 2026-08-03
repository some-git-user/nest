import type {NagiosReturnCode} from '../src/types/nagios';
import {NagiosReturnCodes} from '../src/types/nagios';
import {checkTest, meta} from './check_test';

describe('check-test plugin', () => {
	describe('meta', () => {
		it('should have valid meta information', () => {
			expect(meta).toBeDefined();
			expect(meta.usage).toBeDefined();
			expect(meta.usage.http).toContain('/plugins/check-test');
			expect(meta.usage.shell).toContain('./check_nest.sh check-test');
			expect(meta.help).toBeDefined();
			expect(meta.help).toContain('check-test');
			expect(meta.examples).toBeDefined();
			expect(meta.examples.length).toBeGreaterThan(0);
		});

		it('should have GET example', () => {
			const getExample = meta.examples?.find((ex) => ex.method === 'GET');
			expect(getExample).toBeDefined();
			expect(getExample?.path).toBe('/plugins/check-test');
			expect(getExample?.fields).toHaveLength(3);
		});

		it('should have POST example', () => {
			const postExample = meta.examples?.find((ex) => ex.method === 'POST');
			expect(postExample).toBeDefined();
			expect(postExample?.path).toBe('/plugins/check-test');
		});
	});

	describe('checkTest function', () => {
		it('should return OK status with default parameters', () => {
			const result = checkTest({
				nagiosReturnMessage: 'Test message',
				nagiosReturnValue: NagiosReturnCodes.OK,
			});

			expect(result.message).toBe('Test message');
			expect(result.code).toBe(NagiosReturnCodes.OK);
			expect(result.performanceData).toEqual([]);
		});

		it('should return WARNING status', () => {
			const result = checkTest({
				nagiosReturnMessage: 'Warning detected',
				nagiosReturnValue: NagiosReturnCodes.WARNING,
			});

			expect(result.message).toBe('Warning detected');
			expect(result.code).toBe(NagiosReturnCodes.WARNING);
		});

		it('should return CRITICAL status', () => {
			const result = checkTest({
				nagiosReturnMessage: 'Critical error',
				nagiosReturnValue: NagiosReturnCodes.CRITICAL,
			});

			expect(result.message).toBe('Critical error');
			expect(result.code).toBe(NagiosReturnCodes.CRITICAL);
		});

		it('should return UNKNOWN status', () => {
			const result = checkTest({
				nagiosReturnMessage: 'Unknown state',
				nagiosReturnValue: NagiosReturnCodes.UNKNOWN,
			});

			expect(result.message).toBe('Unknown state');
			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should use default message when not provided', () => {
			const result = checkTest({
				nagiosReturnValue: NagiosReturnCodes.OK,
			});

			expect(result.message).toContain('Usage:');
			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should use UNKNOWN as default return code when not provided', () => {
			const result = checkTest({
				nagiosReturnMessage: 'Test',
			});

			expect(result.code).toBe(NagiosReturnCodes.UNKNOWN);
		});

		it('should include performance data when enabled', () => {
			const result = checkTest({
				nagiosReturnMessage: 'Test with perf data',
				nagiosReturnValue: NagiosReturnCodes.OK,
				performanceData: true,
			});

			expect(result.performanceData).toHaveLength(2);
			expect(result.performanceData?.[0]).toEqual({
				label: 'WATER BOILER TEMP',
				value: '55',
				uom: 'C°',
				warn: '80',
				crit: '90',
				min: '0',
				max: '100',
			});
			expect(result.performanceData?.[1]).toEqual({
				label: 'OUTDOOR TEMP',
				value: '21',
				uom: 'C°',
				warn: '30',
				crit: '40',
				min: '-20',
				max: '50',
			});
		});

		it('should not include performance data when disabled', () => {
			const result = checkTest({
				nagiosReturnMessage: 'Test without perf data',
				nagiosReturnValue: NagiosReturnCodes.OK,
				performanceData: false,
			});

			expect(result.performanceData).toEqual([]);
		});

		it('should not include performance data when not specified', () => {
			const result = checkTest({
				nagiosReturnMessage: 'Test default perf data',
				nagiosReturnValue: NagiosReturnCodes.OK,
			});

			expect(result.performanceData).toEqual([]);
		});

		it('should handle all return codes correctly', () => {
			const codes: NagiosReturnCode[] = [
				NagiosReturnCodes.OK,
				NagiosReturnCodes.WARNING,
				NagiosReturnCodes.CRITICAL,
				NagiosReturnCodes.UNKNOWN,
			];

			for (const code of codes) {
				const result = checkTest({
					nagiosReturnMessage: `Status ${code}`,
					nagiosReturnValue: code,
				});

				expect(result.code).toBe(code);
			}
		});

		it('should log the parameters (console.log side effect)', () => {
			const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

			checkTest({
				nagiosReturnMessage: 'Log test',
				nagiosReturnValue: NagiosReturnCodes.OK,
				performanceData: true,
			});

			expect(consoleSpy).toHaveBeenCalled();
			expect(consoleSpy.mock.calls[0][0]).toContain('Test plugin received:');
			expect(consoleSpy.mock.calls[0][0]).toContain(
				'nagiosReturnMessage=Log test',
			);

			consoleSpy.mockRestore();
		});

		it('should handle empty message', () => {
			const result = checkTest({
				nagiosReturnMessage: '',
				nagiosReturnValue: NagiosReturnCodes.OK,
			});

			expect(result.message).toBe('');
			expect(result.code).toBe(NagiosReturnCodes.OK);
		});

		it('should handle special characters in message', () => {
			const specialMessage =
				'Test with special chars: <>&"\' and unicode: ñáéíóú';
			const result = checkTest({
				nagiosReturnMessage: specialMessage,
				nagiosReturnValue: NagiosReturnCodes.OK,
			});

			expect(result.message).toBe(specialMessage);
		});

		it('should handle very long message', () => {
			const longMessage = 'A'.repeat(1000);
			const result = checkTest({
				nagiosReturnMessage: longMessage,
				nagiosReturnValue: NagiosReturnCodes.OK,
			});

			expect(result.message).toBe(longMessage);
			expect(result.message.length).toBe(1000);
		});

		it('should work with only required parameters', () => {
			const result = checkTest({
				nagiosReturnMessage: 'Minimal test',
				nagiosReturnValue: NagiosReturnCodes.OK,
			});

			expect(result.message).toBe('Minimal test');
			expect(result.code).toBe(NagiosReturnCodes.OK);
			expect(result.performanceData).toEqual([]);
		});
	});
});
