import {
	analyzeNvidiaSmiOutput,
	checkNvidiaSmi,
	getStatusText,
	meta,
} from './check_nvidia_smi';

const nvidiaSmiDriverFailureOutput = `NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running.`;

const nvidiaSmiSuccessTableOutput = `Wed Jun  3 19:47:35 2026
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 610.43.02              KMD Version: 610.43.02     CUDA UMD Version: 13.3     |
+-----------------------------------------+------------------------+----------------------+
| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |
| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |
|                                         |                        |               MIG M. |
|=========================================+========================+======================|
|   0  NVIDIA GeForce RTX 5060 Ti     Off |   00000000:02:00.0 Off |                  N/A |
| 37%   38C    P0             19W /  180W |       0MiB /  16311MiB |      0%      Default |
|                                         |                        |                  N/A |
+-----------------------------------------+------------------------+----------------------+
`;

const nvidiaSmiSuccessCsvSingleGpu =
	'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 38, 20, 0, 16311, 19, 180\n';

const nvidiaSmiSuccessCsvMultiGpu =
	'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 38, 20, 100, 16311, 19, 180\n1, 610.43.02, NVIDIA RTX 4000, 86, 92, 14000, 16384, 170, 200\n';

const nvidiaSmiCsvNoDriver =
	'0, N/A, NVIDIA GeForce RTX 5060 Ti, 38, 20, 100, 16311, 19, 180\n';

const nvidiaSmiCsvNotSupportedPower =
	'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 38, 20, 100, 16311, [Not Supported], [Not Supported]\n';

const nvidiaSmiCsvCriticalUtilization =
	'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 40, 99, 100, 16311, 19, 180\n';

const nvidiaSmiCsvCriticalMemoryUsage =
	'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 40, 20, 16000, 16311, 19, 180\n';

const nvidiaSmiCsvCriticalPowerUsage =
	'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 40, 20, 100, 16311, 190, 200\n';

const nvidiaSmiCsvPowerDrawNoLimit =
	'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 40, 20, 100, 16311, 150, N/A\n';

const nvidiaSmiCsvZeroMemoryTotal =
	'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 40, 20, 0, 0, 19, 180\n';

const nvidiaSmiCsvMixedDriverVersions =
	'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 38, 20, 100, 16311, 19, 180\n1, 620.00.01, NVIDIA RTX 4000, 45, 25, 200, 16384, 20, 200\n';

const nvidiaSmiCsvQuotedNameWithComma =
	'0, 610.43.02, "NVIDIA RTX 4000, Ada", 45, 25, 200, 16384, 20, 200\n';

const nvidiaSmiCsvQuotedNameWithEscapedQuote =
	'0, 610.43.02, "NVIDIA RTX ""Special"" Edition", 45, 25, 200, 16384, 20, 200\n';

describe('checkNvidiaSmi plugin', () => {
	test('exports usage metadata', () => {
		expect(meta.usage.http).toContain('/plugins/check-nvidia-smi');
		expect(meta.usage.shell).toContain('./check_nest.sh check-nvidia-smi');
		expect(meta.usage.http).toContain('expectedGpuCount');
		expect(meta.usage.http).toContain('warningTempC');
		expect(meta.usage.http).toContain('warningPowerUsagePercent');
		expect(meta.examples?.[0]).toEqual(
			expect.objectContaining({path: '/plugins/check-nvidia-smi'}),
		);
		if (
			typeof meta.examples?.[0] === 'object' &&
			'fields' in meta.examples[0]
		) {
			expect(meta.examples[0].fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({name: 'expectedGpuCount', required: false}),
					expect.objectContaining({name: 'warningTempC', required: false}),
					expect.objectContaining({
						name: 'criticalPowerUsagePercent',
						required: false,
					}),
				]),
			);
		}
	});

	test('getStatusText returns UNKNOWN for unexpected code', () => {
		expect(getStatusText(999)).toBe('UNKNOWN');
	});

	test('getStatusText returns OK for status 0', () => {
		expect(getStatusText(0)).toBe('OK');
	});

	test('parses gpu data from CSV nvidia-smi query output', () => {
		const analysis = analyzeNvidiaSmiOutput(nvidiaSmiSuccessCsvSingleGpu);

		expect(analysis.metrics).toHaveLength(1);
		expect(analysis.metrics[0]).toEqual(
			expect.objectContaining({
				index: 0,
				driverVersion: '610.43.02',
				name: 'NVIDIA GeForce RTX 5060 Ti',
				temperatureC: 38,
				utilizationGpuPercent: 20,
				memoryUsedMiB: 0,
				memoryTotalMiB: 16311,
				powerDrawW: 19,
				powerLimitW: 180,
			}),
		);
		expect(analysis.hasDriverCommunicationFailure).toBe(false);
		expect(analysis.hasNvidiaSmiBanner).toBe(true);
	});

	test('parses quoted GPU names containing commas', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: nvidiaSmiCsvQuotedNameWithComma,
				stderr: '',
			}),
		);

		expect(result.code).toBe(0);
		expect(result.message).toContain('NVIDIA RTX 4000, Ada');
	});

	test('parses quoted GPU names containing escaped quotes', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: nvidiaSmiCsvQuotedNameWithEscapedQuote,
				stderr: '',
			}),
		);

		expect(result.code).toBe(0);
		expect(result.message).toContain('NVIDIA RTX "Special" Edition');
	});

	test('keeps compatibility with provided table-format success output', () => {
		const analysis = analyzeNvidiaSmiOutput(nvidiaSmiSuccessTableOutput);

		expect(analysis.hasNvidiaSmiBanner).toBe(true);
		expect(analysis.metrics).toHaveLength(0);
	});

	test('skips CSV header/blank lines and malformed rows safely', () => {
		const analysis = analyzeNvidiaSmiOutput(
			'index, driver_version, name, temperature.gpu, utilization.gpu, memory.used, memory.total, power.draw, power.limit\n\ninvalid,row\n0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 38, 20, 0, 16311, 19, 180\n',
		);

		expect(analysis.metrics).toHaveLength(1);
		expect(analysis.metrics[0].index).toBe(0);
	});

	test('handles non-numeric metric fields by dropping invalid row', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout:
					'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, seventy, 20, 0, 16311, 19, 180\n',
				stderr: '',
			}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('did not return recognizable output');
	});

	test('drops rows with non-finite parsed numeric values', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout:
					'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 9999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999, 20, 0, 16311, 19, 180\n',
				stderr: '',
			}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('did not return recognizable output');
	});

	test('returns OK when driver and gpu are detected', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: nvidiaSmiSuccessCsvSingleGpu,
				stderr: '',
			}),
		);

		expect(result.code).toBe(0);
		expect(result.message).toContain('OK: NVIDIA driver 610.43.02 detected');
		expect(result.message).toContain('NVIDIA GeForce RTX 5060 Ti');
		expect(result.performanceData).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: 'gpu_count',
					value: '1',
				}),
				expect.objectContaining({
					label: 'gpu0_temp_c',
					value: '38',
				}),
				expect.objectContaining({
					label: 'gpu0_power_draw_w',
					value: '19.0',
				}),
				expect.objectContaining({
					label: 'gpu0_power_used_pct',
					value: '10.6',
				}),
			]),
		);
	});

	test('does not evaluate telemetry thresholds when none are provided', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout:
					'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 95, 99, 16000, 16311, 190, 200\n',
				stderr: '',
			}),
		);

		expect(result.code).toBe(0);
		expect(result.message).toContain('OK: NVIDIA driver 610.43.02 detected');
		expect(result.message).not.toContain('WARNING:');
		expect(result.message).not.toContain('CRITICAL:');
	});

	test('returns WARNING with configurable thresholds and per-gpu perfdata for multiple gpus', async () => {
		const result = await checkNvidiaSmi(
			{
				warningTempC: '85',
				criticalTempC: '90',
				warningUtilizationPercent: '90',
				criticalUtilizationPercent: '95',
				warningMemoryUsagePercent: '85',
				criticalMemoryUsagePercent: '95',
				warningPowerUsagePercent: '80',
				criticalPowerUsagePercent: '95',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvMultiGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(1);
		expect(result.message).toContain('WARNING:');
		expect(result.message).toContain(
			'GPU 1 (NVIDIA RTX 4000) temperature 86C >= warning 85C',
		);
		expect(result.message).toContain(
			'GPU 1 (NVIDIA RTX 4000) power usage 85.0% >= warning 80%',
		);
		expect(result.performanceData).toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'gpu0_temp_c', value: '38'}),
				expect.objectContaining({label: 'gpu1_temp_c', value: '86'}),
				expect.objectContaining({label: 'gpu0_utilization_pct', value: '20'}),
				expect.objectContaining({label: 'gpu1_utilization_pct', value: '92'}),
				expect.objectContaining({label: 'gpu1_power_draw_w', value: '170.0'}),
				expect.objectContaining({label: 'gpu1_power_used_pct', value: '85.0'}),
			]),
		);
	});

	test('returns CRITICAL when configurable thresholds are exceeded', async () => {
		const result = await checkNvidiaSmi(
			{
				warningTempC: '70',
				criticalTempC: '80',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvMultiGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(2);
		expect(result.message).toContain('CRITICAL:');
		expect(result.message).toContain('temperature 86C >= critical 80C');
	});

	test('returns CRITICAL when expectedGpuCount does not match detected GPUs', async () => {
		const result = await checkNvidiaSmi({expectedGpuCount: '1'}, () =>
			Promise.resolve({
				stdout: nvidiaSmiSuccessCsvMultiGpu,
				stderr: '',
			}),
		);

		expect(result.code).toBe(2);
		expect(result.message).toContain('detected 2 GPU(s), expected 1');
		expect(result.performanceData).toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'gpu_count', value: '2'}),
			]),
		);
	});

	test('returns UNKNOWN when expectedGpuCount is not a non-negative integer', async () => {
		const result = await checkNvidiaSmi({expectedGpuCount: '-1'}, () =>
			Promise.resolve({
				stdout: nvidiaSmiSuccessCsvSingleGpu,
				stderr: '',
			}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('invalid expectedGpuCount');
	});

	test('returns UNKNOWN for invalid threshold ordering', async () => {
		const result = await checkNvidiaSmi(
			{
				warningTempC: '95',
				criticalTempC: '90',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvSingleGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('invalid threshold configuration');
	});

	test('returns UNKNOWN for non-numeric threshold params when they are provided', async () => {
		const result = await checkNvidiaSmi(
			{
				warningTempC: 'not-a-number',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvSingleGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('warningTempC must be a valid number');
	});

	test('evaluates a threshold family only when that parameter is provided', async () => {
		const result = await checkNvidiaSmi(
			{
				criticalTempC: '90',
			},
			() =>
				Promise.resolve({
					stdout:
						'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 91, 99, 16000, 16311, 190, 200\n',
					stderr: '',
				}),
		);

		expect(result.code).toBe(2);
		expect(result.message).toContain('temperature 91C >= critical 90C');
		expect(result.message).not.toContain('utilization');
		expect(result.message).not.toContain('memory usage');
		expect(result.message).not.toContain('power usage');
	});

	test('returns UNKNOWN for invalid utilization threshold ordering', async () => {
		const result = await checkNvidiaSmi(
			{
				warningUtilizationPercent: '99',
				criticalUtilizationPercent: '90',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvSingleGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('warningUtilizationPercent');
	});

	test('returns UNKNOWN when utilization thresholds are outside 0..100', async () => {
		const result = await checkNvidiaSmi(
			{
				warningUtilizationPercent: '101',
				criticalUtilizationPercent: '110',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvSingleGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'utilization thresholds must be between 0 and 100',
		);
	});

	test('returns UNKNOWN for invalid memory threshold ordering', async () => {
		const result = await checkNvidiaSmi(
			{
				warningMemoryUsagePercent: '99',
				criticalMemoryUsagePercent: '90',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvSingleGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('warningMemoryUsagePercent');
	});

	test('returns UNKNOWN when memory thresholds are outside 0..100', async () => {
		const result = await checkNvidiaSmi(
			{
				warningMemoryUsagePercent: '-1',
				criticalMemoryUsagePercent: '50',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvSingleGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'memory usage thresholds must be between 0 and 100',
		);
	});

	test('returns UNKNOWN for invalid power threshold ordering', async () => {
		const result = await checkNvidiaSmi(
			{
				warningPowerUsagePercent: '99',
				criticalPowerUsagePercent: '90',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvSingleGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('warningPowerUsagePercent');
	});

	test('returns UNKNOWN when power thresholds are outside 0..100', async () => {
		const result = await checkNvidiaSmi(
			{
				warningPowerUsagePercent: '0',
				criticalPowerUsagePercent: '150',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvSingleGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'power usage thresholds must be between 0 and 100',
		);
	});

	test('returns UNKNOWN for physically impossible temperature threshold', async () => {
		const result = await checkNvidiaSmi(
			{
				warningTempC: '-274',
				criticalTempC: '-273',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiSuccessCsvSingleGpu,
					stderr: '',
				}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'temperature thresholds must be greater than or equal to -273.15',
		);
	});

	test('returns CRITICAL when utilization critical threshold is exceeded', async () => {
		const result = await checkNvidiaSmi(
			{
				warningTempC: '90',
				criticalTempC: '95',
				warningUtilizationPercent: '90',
				criticalUtilizationPercent: '95',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiCsvCriticalUtilization,
					stderr: '',
				}),
		);

		expect(result.code).toBe(2);
		expect(result.message).toContain('utilization 99% >= critical 95%');
	});

	test('returns CRITICAL when memory usage critical threshold is exceeded', async () => {
		const result = await checkNvidiaSmi(
			{
				warningTempC: '90',
				criticalTempC: '95',
				warningMemoryUsagePercent: '90',
				criticalMemoryUsagePercent: '95',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiCsvCriticalMemoryUsage,
					stderr: '',
				}),
		);

		expect(result.code).toBe(2);
		expect(result.message).toContain('memory usage');
		expect(result.message).toContain('>= critical 95%');
	});

	test('returns CRITICAL when power usage critical threshold is exceeded', async () => {
		const result = await checkNvidiaSmi(
			{
				warningTempC: '90',
				criticalTempC: '95',
				warningPowerUsagePercent: '90',
				criticalPowerUsagePercent: '95',
			},
			() =>
				Promise.resolve({
					stdout: nvidiaSmiCsvCriticalPowerUsage,
					stderr: '',
				}),
		);

		expect(result.code).toBe(2);
		expect(result.message).toContain('power usage 95.0% >= critical 95%');
	});

	test('returns CRITICAL when GPU rows have no driver version', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: nvidiaSmiCsvNoDriver,
				stderr: '',
			}),
		);

		expect(result.code).toBe(2);
		expect(result.message).toContain('driver version could not be detected');
	});

	test('parses non-numeric power values without crashing', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: nvidiaSmiCsvNotSupportedPower,
				stderr: '',
			}),
		);

		expect(result.code).toBe(0);
		expect(result.message).toContain('OK: NVIDIA driver 610.43.02 detected');
		expect(result.performanceData).toEqual(
			expect.not.arrayContaining([
				expect.objectContaining({label: 'gpu0_power_draw_w'}),
				expect.objectContaining({label: 'gpu0_power_used_pct'}),
			]),
		);
	});

	test('parses NOT SUPPORTED and [N/A] tokens without crashing', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout:
					'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 38, 20, 100, 16311, NOT SUPPORTED, [N/A]\n',
				stderr: '',
			}),
		);

		expect(result.code).toBe(0);
		expect(result.performanceData).toEqual(
			expect.not.arrayContaining([
				expect.objectContaining({label: 'gpu0_power_draw_w'}),
			]),
		);
	});

	test('handles power draw without power limit and omits power-used percentage perfdata', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: nvidiaSmiCsvPowerDrawNoLimit,
				stderr: '',
			}),
		);

		expect(result.code).toBe(0);
		expect(result.performanceData).toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'gpu0_power_draw_w', value: '150.0'}),
			]),
		);
		expect(result.performanceData).toEqual(
			expect.not.arrayContaining([
				expect.objectContaining({label: 'gpu0_power_used_pct'}),
			]),
		);
	});

	test('handles zero memory total without divide-by-zero and reports memory usage 0%', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: nvidiaSmiCsvZeroMemoryTotal,
				stderr: '',
			}),
		);

		expect(result.code).toBe(0);
		expect(result.performanceData).toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'gpu0_memory_used_pct', value: '0.0'}),
			]),
		);
	});

	test('renders plural driver summary when multiple versions are detected', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: nvidiaSmiCsvMixedDriverVersions,
				stderr: '',
			}),
		);

		expect(result.code).toBe(0);
		expect(result.message).toContain('drivers 610.43.02, 620.00.01');
	});

	test('returns CRITICAL when nvidia-smi reports driver communication failure', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: '',
				stderr: nvidiaSmiDriverFailureOutput,
			}),
		);

		expect(result.code).toBe(2);
		expect(result.message).toContain(
			'could not communicate with the NVIDIA driver',
		);
	});

	test('returns CRITICAL when nvidia-smi output contains no gpu entries', async () => {
		const successWithoutGpuRows = `NVIDIA-SMI 610.43.02`;

		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: successWithoutGpuRows,
				stderr: '',
			}),
		);

		expect(result.code).toBe(2);
		expect(result.message).toContain('no GPU entries were found');
	});

	test('returns UNKNOWN when command is missing', async () => {
		const commandMissingError = new Error(
			'spawn nvidia-smi ENOENT',
		) as Error & {
			code: string;
		};
		commandMissingError.code = 'ENOENT';

		const result = await checkNvidiaSmi({}, () => {
			throw commandMissingError;
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('command was not found');
	});

	test('returns CRITICAL when exec fails but stderr/stdout includes driver communication error', async () => {
		const execError = new Error('Command failed') as Error & {
			stderr: string;
			stdout: string;
		};
		execError.stderr = '';
		execError.stdout = nvidiaSmiDriverFailureOutput;

		const result = await checkNvidiaSmi({}, () => {
			throw execError;
		});

		expect(result.code).toBe(2);
		expect(result.message).toContain(
			'could not communicate with the NVIDIA driver',
		);
	});

	test('returns UNKNOWN for unrecognized command output', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout: 'some random output',
				stderr: '',
			}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('did not return recognizable output');
	});

	test('returns UNKNOWN when duplicate GPU indexes are present in CSV output', async () => {
		const result = await checkNvidiaSmi({}, () =>
			Promise.resolve({
				stdout:
					'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 38, 20, 0, 16311, 19, 180\n0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 39, 21, 10, 16311, 20, 180\n',
				stderr: '',
			}),
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('did not return recognizable output');
	});

	test('returns UNKNOWN for generic execution error', async () => {
		const result = await checkNvidiaSmi({}, () => {
			throw new Error('permission denied');
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('failed to execute nvidia-smi');
	});

	test('returns UNKNOWN with unexpected error when non-Error is thrown', async () => {
		const result = await checkNvidiaSmi({}, async () => {
			await Promise.resolve();
			// Intentional: validates handling of non-Error thrown values.
			// eslint-disable-next-line @typescript-eslint/only-throw-error
			throw {reason: 'plain object'};
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('unexpected error');
	});

	test('handles error objects with stderr but no string stdout', async () => {
		const execError = new Error('Command failed') as Error & {
			stderr: string;
			stdout: number;
		};
		execError.stderr = 'not matching driver error';
		execError.stdout = 42;

		const result = await checkNvidiaSmi({}, () => {
			throw execError;
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'failed to execute nvidia-smi: Command failed',
		);
	});

	test('uses default runner when no custom runner is provided', async () => {
		jest.resetModules();
		const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
		const execFileMock = jest.fn(
			(
				_file: string,
				_args: string[],
				callback: (error: Error | null, stdout: string, stderr: string) => void,
			) => {
				callback(
					null,
					'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 38, 20, 0, 16311, 19, 180\n',
					'',
				);
			},
		);
		(execFileMock as unknown as Record<symbol, unknown>)[promisifyCustom] =
			() =>
				Promise.resolve({
					stdout:
						'0, 610.43.02, NVIDIA GeForce RTX 5060 Ti, 38, 20, 0, 16311, 19, 180\n',
					stderr: '',
				});

		let isolatedModule:
			| {
					checkNvidiaSmi: () => Promise<{code: number; message: string}>;
			  }
			| undefined;
		jest.isolateModules(() => {
			jest.doMock('child_process', () => ({execFile: execFileMock}));
			isolatedModule =
				jest.requireActual<typeof import('./check_nvidia_smi')>(
					'./check_nvidia_smi',
				);
		});

		if (!isolatedModule) {
			throw new Error('Failed to load isolated module');
		}
		const result = await isolatedModule.checkNvidiaSmi();

		expect(result.code).toBe(0);
		expect(result.message).toContain('NVIDIA driver 610.43.02');

		jest.dontMock('child_process');
		jest.resetModules();
	});
});
