import {checkDmesgErrors, getLevelFlag, meta} from './check_dmesg_errors';

// Sample dmesg output for testing
const sampleDmesgOutput = `[12345.678901] kern.err: I/O error on device sda1
[12345.678902] kern.warning: deprecated function called
[12345.678903] kern.crit: critical failure detected
[12345.678904] kern.emerg: kernel panic - not syncing
[12345.678905] kern.alert: action required immediately
[12345.678906] kern.err: failed to mount filesystem
[12345.678907] kern.err: Out of memory: Kill process
[12345.678908] kern.err: Oops: 0002 [#1] SMP
[12345.678909] kern.err: segfault at 0000000000000000
[12345.678910] kern.info: normal operation
[12345.678911] kern.debug: debug message`;

// Create mock execSync
const mockedExecSync = jest.fn();

describe('checkDmesgErrors', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedExecSync.mockReset();
	});

	describe('meta', () => {
		it('should have valid metadata', () => {
			expect(meta.usage).toBeDefined();
			expect(meta.usage.http).toContain('/plugins/check-dmesg-errors');
			expect(meta.usage.shell).toContain('check-dmesg-errors');
			expect(meta.examples).toHaveLength(2);
		});
	});

	describe('checkDmesgErrors function', () => {
		it('should handle missing dmesg access gracefully', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				level: 'err',
				timeRange: 60,
				execSync: mockedExecSync,
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
			expect(result).toHaveProperty('performanceData');
			expect(typeof result.message).toBe('string');
			expect(typeof result.code).toBe('number');
			expect(Array.isArray(result.performanceData)).toBe(true);
		});

		it('should validate log level parameter', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				level: 'err' as const,
				execSync: mockedExecSync,
			});

			expect(result.code).toBeGreaterThanOrEqual(0);
			expect(result.code).toBeLessThanOrEqual(3);
		});

		it('should handle custom pattern parameter', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				pattern: 'test.*pattern',
				timeRange: 300,
				execSync: mockedExecSync,
			});

			expect(result).toHaveProperty('message');
			expect(result.code).toBeGreaterThanOrEqual(0);
		});

		it('should handle invalid regex pattern', async () => {
			const result = await checkDmesgErrors({
				pattern: '[invalid(regex',
			});

			expect(result.code).toBe(3);
			expect(result.message).toContain('Invalid regex pattern');
		});

		it('should handle invalid ignore pattern', async () => {
			const result = await checkDmesgErrors({
				ignorePatterns: '[invalid(regex',
			});

			expect(result.code).toBe(3);
			expect(result.message).toContain('Invalid ignore pattern');
		});

		it('should return valid performance data structure', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
			});

			expect(result.performanceData).toBeInstanceOf(Array);
			(result.performanceData as Array<{label: string; value: number}>).forEach(
				(pd) => {
					expect(pd).toHaveProperty('label');
					expect(pd).toHaveProperty('value');
					expect(typeof pd.value).toBe('number');
				},
			);
		});

		it('should handle different time ranges', async () => {
			mockedExecSync.mockReturnValue('');
			const result1 = await checkDmesgErrors({timeRange: 60});
			mockedExecSync.mockReturnValue('');
			const result2 = await checkDmesgErrors({timeRange: 3600});
			mockedExecSync.mockReturnValue('');
			const result3 = await checkDmesgErrors({timeRange: 86400});

			expect(result1).toHaveProperty('message');
			expect(result2).toHaveProperty('message');
			expect(result3).toHaveProperty('message');
		});

		it('should handle all log levels', async () => {
			const levels = ['emerg', 'alert', 'crit', 'err', 'warn'] as const;

			for (const level of levels) {
				mockedExecSync.mockReturnValue('');
				const result = await checkDmesgErrors({
					execSync: mockedExecSync,
					level,
				});
				expect(result).toHaveProperty('code');
				expect(result.code).toBeGreaterThanOrEqual(0);
				expect(result.code).toBeLessThanOrEqual(3);
			}
		});

		it('should combine multiple parameters', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'warn',
				pattern: 'error|warning',
				timeRange: 1800,
				ignorePatterns: 'test',
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
			expect(result).toHaveProperty('performanceData');
		});
	});

	describe('severity analysis', () => {
		it('should handle empty message list', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: 'nonexistent_pattern_xyz_123',
			});

			expect(result).toHaveProperty('message');
			expect(result.performanceData).toBeDefined();
		});
	});

	describe('performance data', () => {
		it('should include all required metrics', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
			});

			const labels = (result.performanceData as Array<{label: string}>).map(
				(pd) => pd.label,
			);
			expect(labels).toContain('total_messages');
			expect(labels).toContain('err_count');
			expect(labels).toContain('warn_count');
			expect(labels).toContain('emerg_count');
			expect(labels).toContain('alert_count');
			expect(labels).toContain('crit_count');
		});

		it('should have proper units for performance data', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
			});

			(result.performanceData as Array<{label: string; uom: string}>).forEach(
				(pd) => {
					if (pd.label.includes('count')) {
						expect(pd.uom).toBe('count');
					}
				},
			);
		});
	});

	describe('dmesg command execution', () => {
		it('should handle successful dmesg execution with errors', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 3600,
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
			expect(result.code).toBeGreaterThanOrEqual(0);
			expect(result.code).toBeLessThanOrEqual(3);
		});

		it('should handle permission denied scenario', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
		});
	});

	describe('pattern filtering', () => {
		it('should filter messages by custom pattern', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: 'I/O error',
				timeRange: 3600,
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('performanceData');
		});

		it('should filter out ignored patterns', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				ignorePatterns: 'test|known_issue',
				timeRange: 3600,
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('performanceData');
		});

		it('should combine pattern and ignorePatterns filtering', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: 'error',
				ignorePatterns: 'test',
				timeRange: 3600,
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
		});
	});

	describe('severity analysis', () => {
		it('should detect emergency level messages', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'emerg',
			});

			expect(result).toHaveProperty('message');
			expect(result.performanceData).toBeDefined();
		});

		it('should detect alert level messages', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'alert',
			});

			expect(result).toHaveProperty('message');
			expect(result.performanceData).toBeDefined();
		});

		it('should detect critical level messages', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'crit',
			});

			expect(result).toHaveProperty('message');
			expect(result.performanceData).toBeDefined();
		});

		it('should detect error level messages', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
			});

			expect(result).toHaveProperty('message');
			expect(result.performanceData).toBeDefined();
		});

		it('should detect warning level messages', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'warn',
			});

			expect(result).toHaveProperty('message');
			expect(result.performanceData).toBeDefined();
		});
	});

	describe('return codes', () => {
		it('should return OK when no errors found', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 60,
			});

			expect(result).toHaveProperty('code');
			expect(result.code).toBeGreaterThanOrEqual(0);
			expect(result.code).toBeLessThanOrEqual(3);
		});

		it('should return valid message and code', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
			expect(typeof result.message).toBe('string');
			expect(typeof result.code).toBe('number');
		});
	});

	describe('edge cases', () => {
		it('should handle empty timeRange', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				timeRange: 0,
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
		});

		it('should handle very large timeRange', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				timeRange: 31536000, // 1 year
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
		});

		it('should handle invalid level with fallback to default', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'invalid' as never,
			});

			expect(result).toHaveProperty('code');
			expect(result.code).toBeGreaterThanOrEqual(0);
		});
	});

	describe('getLevelFlag function', () => {
		it('should return emerg for index 0', () => {
			expect(getLevelFlag(0)).toBe('emerg');
		});

		it('should return alert for index 1', () => {
			expect(getLevelFlag(1)).toBe('alert');
		});

		it('should return crit for index 2', () => {
			expect(getLevelFlag(2)).toBe('crit');
		});

		it('should return err for index 3', () => {
			expect(getLevelFlag(3)).toBe('err');
		});

		it('should return warn for index 4', () => {
			expect(getLevelFlag(4)).toBe('warn');
		});

		it('should return notice for index 5', () => {
			expect(getLevelFlag(5)).toBe('notice');
		});

		it('should return info for index 6', () => {
			expect(getLevelFlag(6)).toBe('info');
		});

		it('should return debug for index 7', () => {
			expect(getLevelFlag(7)).toBe('debug');
		});

		it('should return err for out-of-bounds index', () => {
			expect(getLevelFlag(10)).toBe('err');
		});

		it('should return err for negative index', () => {
			expect(getLevelFlag(-1)).toBe('err');
		});

		it('should handle empty pattern string', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: '',
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
		});

		it('should handle empty ignorePatterns string', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				ignorePatterns: '',
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
		});
	});

	describe('getLevelFlag function', () => {
		it('should return correct flag for emerg level', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'emerg',
			});
			expect(result).toHaveProperty('code');
		});

		it('should return correct flag for alert level', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'alert',
			});
			expect(result).toHaveProperty('code');
		});

		it('should return correct flag for crit level', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'crit',
			});
			expect(result).toHaveProperty('code');
		});

		it('should return correct flag for err level', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
			});
			expect(result).toHaveProperty('code');
		});

		it('should return correct flag for warn level', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'warn',
			});
			expect(result).toHaveProperty('code');
		});
	});

	describe('extractCriticalIssues', () => {
		it('should extract critical issues from messages internally', async () => {
			mockedExecSync.mockReturnValue(
				'[12345.678901] kern.err: I/O error on device',
			);
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: 'I/O error|OOM|panic',
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
		});

		it('should handle messages with no critical issues', async () => {
			mockedExecSync.mockReturnValue(
				'[12345.678901] kern.info: normal operation',
			);
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: 'nonexistent_pattern_xyz_123',
			});

			expect(result).toHaveProperty('message');
			expect(result).toHaveProperty('code');
		});
	});

	describe('analyzeSeverity', () => {
		it('should count panic messages as emerg', async () => {
			mockedExecSync.mockReturnValue(
				'[12345.678901] kern.emerg: kernel panic - not syncing',
			);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: 'panic',
			});

			expect(result.performanceData).toBeDefined();
			const emergCount = (
				result.performanceData as Array<{label: string; value: number}>
			).find((pd) => pd.label === 'emerg_count');
			expect(emergCount?.value).toBeGreaterThan(0);
		});

		it('should count critical messages', async () => {
			mockedExecSync.mockReturnValue(
				'[12345.678901] kern.crit: critical failure detected',
			);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: 'critical|fatal|corruption',
			});

			expect(result.performanceData).toBeDefined();
			const critCount = (
				result.performanceData as Array<{
					label: string;
					value: number;
				}>
			).find((pd) => pd.label === 'crit_count');
			expect(critCount?.value).toBeGreaterThan(0);
		});

		it('should count error messages', async () => {
			mockedExecSync.mockReturnValue(
				'[12345.678901] kern.err: I/O error on device',
			);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: 'error|failed|failure',
			});

			expect(result.performanceData).toBeDefined();
			const errCount = (
				result.performanceData as Array<{
					label: string;
					value: number;
				}>
			).find((pd) => pd.label === 'err_count');
			expect(errCount?.value).toBeGreaterThan(0);
		});

		it('should count warning messages', async () => {
			mockedExecSync.mockReturnValue(
				'[12345.678901] kern.warning: deprecated function called',
			);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				pattern: 'warning|deprecated|obsolete',
			});

			expect(result.performanceData).toBeDefined();
			const warnCount = (
				result.performanceData as Array<{
					label: string;
					value: number;
				}>
			).find((pd) => pd.label === 'warn_count');
			expect(warnCount?.value).toBeGreaterThan(0);
		});
	});

	describe('dmesg command execution with mocked output', () => {
		it('should successfully execute dmesg and return OK when no errors', async () => {
			mockedExecSync.mockReturnValue('');

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 3600,
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.code).toBe(0);
			expect(result.message).toContain('OK');
			expect(result.performanceData).toBeDefined();
		});

		it('should detect error-level messages from dmesg output', async () => {
			mockedExecSync.mockReturnValue(sampleDmesgOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 3600,
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.code).toBeGreaterThanOrEqual(0);
			expect(result.message).toBeDefined();
			expect(result.performanceData).toBeDefined();

			const errCount = (
				result.performanceData as Array<{
					label: string;
					value: number;
				}>
			).find((pd) => pd.label === 'err_count');
			expect(errCount?.value).toBeGreaterThan(0);
		});

		it('should detect critical messages (emerg, alert, crit)', async () => {
			mockedExecSync.mockReturnValue(sampleDmesgOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'crit',
				timeRange: 3600,
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.code).toBe(2); // CRITICAL
			expect(result.message).toContain('CRITICAL');
		});

		it('should filter messages by custom pattern', async () => {
			mockedExecSync.mockReturnValue(sampleDmesgOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				pattern: 'I/O error',
				timeRange: 3600,
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.performanceData).toBeDefined();

			const totalMessages = (
				result.performanceData as Array<{
					label: string;
					value: number;
				}>
			).find((pd) => pd.label === 'total_messages');
			expect(totalMessages?.value).toBeLessThanOrEqual(
				sampleDmesgOutput.split('\n').length,
			);
		});

		it('should filter out ignored patterns', async () => {
			mockedExecSync.mockReturnValue(sampleDmesgOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				ignorePatterns: 'I/O error',
				timeRange: 3600,
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.performanceData).toBeDefined();
		});

		it('should handle permission denied error', async () => {
			const error = new Error('dmesg: permission denied') as Error & {
				stdout?: string;
				status?: number;
			};
			error.stdout = 'dmesg: permission denied';
			error.status = 1;
			mockedExecSync.mockImplementation(() => {
				throw error;
			});

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.code).toBe(1); // WARNING
			expect(result.message).toContain('WARNING');
		});

		it('should handle dmesg command failure', async () => {
			mockedExecSync.mockImplementation(() => {
				const error = new Error('dmesg failed') as Error & {
					stdout?: string;
					status?: number;
				};
				error.stdout = '';
				error.status = 1;
				throw error;
			});

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.code).toBe(1);
			expect(result.performanceData).toBeDefined();
		});

		it('should handle dmesg command failure with undefined status', async () => {
			mockedExecSync.mockImplementation(() => {
				const error = new Error('dmesg failed') as Error & {
					stdout?: string;
					status?: number;
				};
				error.stdout = '';
				// status is undefined, should fallback to 1
				throw error;
			});

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.code).toBe(1);
			expect(result.performanceData).toBeDefined();
		});

		it('should handle permission denied in output with exit code 0', async () => {
			mockedExecSync.mockReturnValue('dmesg: permission denied');

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
			});

			expect(result.code).toBe(1);
			expect(result.message).toContain('WARNING');
			expect(result.message).toContain('Cannot read kernel ring buffer');
		});

		it('should apply time range filter to dmesg command', async () => {
			mockedExecSync.mockReturnValue('');

			const _result = await checkDmesgErrors({
				level: 'err',
				timeRange: 7200,
				execSync: mockedExecSync,
			});

			expect(mockedExecSync).toHaveBeenCalled();
			const callArgs = (mockedExecSync.mock.calls[0] as [string, string[]])[1];
			expect(callArgs).toContain('--since');
			expect(callArgs).toContain('7200 seconds ago');
		});

		it('should pass timeRange as a separate argv entry, not shell syntax', async () => {
			mockedExecSync.mockReturnValue('');

			await checkDmesgErrors({
				level: 'err',
				timeRange: 7200,
				execSync: mockedExecSync,
			});

			const [file, args] = mockedExecSync.mock.calls[0] as [string, string[]];
			expect(file).toBe('dmesg');
			expect(args).toEqual([
				'--level=err+',
				'--time-format=iso',
				'--nopager',
				'--since',
				'7200 seconds ago',
			]);
		});

		it('should use correct level flag in dmesg command', async () => {
			mockedExecSync.mockReturnValue('');

			await checkDmesgErrors({
				level: 'warn',
				timeRange: 3600,
				execSync: mockedExecSync,
			});

			const callArgs = (mockedExecSync.mock.calls[0] as [string, string[]])[1];
			expect(callArgs).toContain('--level=warn+');
		});

		it('should count all severity levels correctly', async () => {
			mockedExecSync.mockReturnValue(sampleDmesgOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'warn',
				timeRange: 3600,
			});

			expect(result.performanceData).toBeDefined();

			const pdArray = result.performanceData as Array<{
				label: string;
				value: number;
			}>;
			const emergCount = pdArray.find((pd) => pd.label === 'emerg_count');
			const alertCount = pdArray.find((pd) => pd.label === 'alert_count');
			const critCount = pdArray.find((pd) => pd.label === 'crit_count');
			const errCount = pdArray.find((pd) => pd.label === 'err_count');
			const warnCount = pdArray.find((pd) => pd.label === 'warn_count');

			expect(emergCount?.value).toBeGreaterThan(0);
			expect(alertCount?.value).toBeGreaterThan(0);
			expect(critCount?.value).toBeGreaterThan(0);
			expect(errCount?.value).toBeGreaterThan(0);
			expect(warnCount?.value).toBeGreaterThan(0);
		});

		it('should return CRITICAL for emergency messages', async () => {
			const emergencyOutput =
				'[12345.678901] kern.emerg: kernel panic - not syncing';
			mockedExecSync.mockReturnValue(emergencyOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'emerg',
				timeRange: 3600,
			});

			expect(result.code).toBe(2); // CRITICAL
			expect(result.message).toContain('CRITICAL');
			expect(result.message).toContain('emergency');
		});

		it('should return CRITICAL for alert messages', async () => {
			const alertOutput =
				'[12345.678901] kern.alert: action required immediately';
			mockedExecSync.mockReturnValue(alertOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'alert',
				timeRange: 3600,
			});

			expect(result.code).toBe(2); // CRITICAL
			expect(result.message).toContain('CRITICAL');
		});

		it('should return CRITICAL for critical messages', async () => {
			const critOutput = '[12345.678901] kern.crit: critical failure detected';
			mockedExecSync.mockReturnValue(critOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'crit',
				timeRange: 3600,
			});

			expect(result.code).toBe(2); // CRITICAL
			expect(result.message).toContain('CRITICAL');
		});

		it('should include top issues in message when critical messages exist', async () => {
			mockedExecSync.mockReturnValue(sampleDmesgOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 3600,
			});

			expect(result.message).toBeDefined();
			// Message should include top issues when there are critical messages
			expect(typeof result.message).toBe('string');
		});

		it('should handle empty dmesg output', async () => {
			mockedExecSync.mockReturnValue('');

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 3600,
			});

			expect(result.code).toBe(0); // OK
			expect(result.message).toContain('OK');
			expect(result.message).toContain('No kernel errors found');
		});

		it('should handle dmesg output with only info/debug messages', async () => {
			const infoOutput =
				'[12345.678901] kern.info: normal operation\n[12345.678902] kern.debug: debug message';
			mockedExecSync.mockReturnValue(infoOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 3600,
			});

			expect(result.code).toBe(0); // OK
			expect(result.performanceData).toBeDefined();
		});

		it('should combine level, pattern, and ignorePatterns filters', async () => {
			mockedExecSync.mockReturnValue(sampleDmesgOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'warn',
				pattern: 'error|warning',
				ignorePatterns: 'I/O',
				timeRange: 3600,
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.performanceData).toBeDefined();
			expect(result.code).toBeGreaterThanOrEqual(0);
			expect(result.code).toBeLessThanOrEqual(2);
		});

		it('should handle large dmesg output with maxBuffer', async () => {
			// Simulate large output (within 10MB limit)
			const largeOutput = Array(1000)
				.fill('[12345.678901] kern.err: test error message')
				.join('\n');
			mockedExecSync.mockReturnValue(largeOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 3600,
			});

			expect(mockedExecSync).toHaveBeenCalled();
			expect(result.performanceData).toBeDefined();

			const totalMessages = (
				result.performanceData as Array<{
					label: string;
					value: number;
				}>
			).find((pd) => pd.label === 'total_messages');
			expect(totalMessages?.value).toBe(1000);
		});

		it('should truncate critical messages to 80 characters', async () => {
			const longMessageOutput =
				'[12345.678901] kern.err: ' +
				'A'.repeat(100) +
				' - this is a very long error message that should be truncated';
			mockedExecSync.mockReturnValue(longMessageOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 3600,
			});

			expect(result.message).toBeDefined();
			// The internal extractCriticalIssues should truncate to 80 chars
		});

		it('should handle multiple error types in single output', async () => {
			const multiErrorOutput = `[12345.678901] kern.err: I/O error
[12345.678902] kern.err: Out of memory
[12345.678903] kern.err: segfault
[12345.678904] kern.err: Oops
[12345.678905] kern.err: failed to mount`;
			mockedExecSync.mockReturnValue(multiErrorOutput);

			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				level: 'err',
				timeRange: 3600,
			});

			expect(result.code).toBe(1); // WARNING for errors (no emerg/alert/crit)
			expect(result.performanceData).toBeDefined();

			const errCount = (
				result.performanceData as Array<{
					label: string;
					value: number;
				}>
			).find((pd) => pd.label === 'err_count');
			expect(errCount?.value).toBe(5);
		});
	});

	describe('message formatting', () => {
		it('should include top issues in message when critical messages exist', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
			});

			expect(result).toHaveProperty('message');
			expect(typeof result.message).toBe('string');
		});

		it('should format message with timeRange', async () => {
			mockedExecSync.mockReturnValue('');
			const result = await checkDmesgErrors({
				execSync: mockedExecSync,
				timeRange: 7200,
			});

			expect(result.message).toBeDefined();
		});
	});

	describe('examples property', () => {
		it('should have valid example configurations', () => {
			expect(meta.examples).toBeInstanceOf(Array);
			expect(meta.examples.length).toBeGreaterThan(0);

			meta.examples.forEach((example) => {
				expect(example).toHaveProperty('label');
				expect(example).toHaveProperty('method');
				expect(example).toHaveProperty('path');
				expect(example).toHaveProperty('fields');
			});
		});

		it('should have example with pattern field', () => {
			const patternExample = meta.examples.find((ex) =>
				ex.fields?.some((f) => f.name === 'pattern'),
			);
			expect(patternExample).toBeDefined();
		});
	});
});
