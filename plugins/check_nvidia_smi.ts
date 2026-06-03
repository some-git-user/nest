import {execFile} from 'child_process';
import {promisify} from 'util';
import type {PluginMeta} from '../src/types/plugin-meta';

type CommandOutput = {
	stdout: string;
	stderr: string;
};

type CommandRunner = () => Promise<CommandOutput>;

type GpuMetrics = {
	index: number;
	name: string;
	driverVersion?: string;
	temperatureC: number;
	utilizationGpuPercent: number;
	memoryUsedMiB: number;
	memoryTotalMiB: number;
	memoryUsagePercent: number;
	powerDrawW?: number;
	powerLimitW?: number;
	powerUsagePercent?: number;
};

type NvidiaSmiAnalysis = {
	metrics: GpuMetrics[];
	hasDriverCommunicationFailure: boolean;
	hasNvidiaSmiBanner: boolean;
};

type ThresholdConfig = {
	warningTempC?: number;
	criticalTempC?: number;
	warningUtilizationPercent?: number;
	criticalUtilizationPercent?: number;
	warningMemoryUsagePercent?: number;
	criticalMemoryUsagePercent?: number;
	warningPowerUsagePercent?: number;
	criticalPowerUsagePercent?: number;
};

const STATUS_OK = 0;
const STATUS_WARNING = 1;
const STATUS_CRITICAL = 2;
const STATUS_UNKNOWN = 3;

export const meta = {
	usage: {
		http: '/plugins/check-nvidia-smi[?expectedGpuCount=<number>&warningTempC=<number>&criticalTempC=<number>&warningUtilizationPercent=<number>&criticalUtilizationPercent=<number>&warningMemoryUsagePercent=<number>&criticalMemoryUsagePercent=<number>&warningPowerUsagePercent=<number>&criticalPowerUsagePercent=<number>]',
		shell:
			'./check_nest.sh check-nvidia-smi [expectedGpuCount=<number>] [warningTempC=<number>] [criticalTempC=<number>] [warningUtilizationPercent=<number>] [criticalUtilizationPercent=<number>] [warningMemoryUsagePercent=<number>] [criticalMemoryUsagePercent=<number>] [warningPowerUsagePercent=<number>] [criticalPowerUsagePercent=<number>]',
	},
	examples: [
		{
			label: 'Check NVIDIA driver and detect at least one GPU',
			method: 'GET',
			path: '/plugins/check-nvidia-smi',
			fields: [
				{
					name: 'expectedGpuCount',
					label: 'Expected GPU Count',
					required: false,
					defaultValue: '1',
				},
				{
					name: 'warningTempC',
					label: 'Warning Temperature (C)',
					required: false,
					defaultValue: '80',
				},
				{
					name: 'criticalTempC',
					label: 'Critical Temperature (C)',
					required: false,
					defaultValue: '90',
				},
				{
					name: 'warningUtilizationPercent',
					label: 'Warning GPU Utilization (%)',
					required: false,
					defaultValue: '85',
				},
				{
					name: 'criticalUtilizationPercent',
					label: 'Critical GPU Utilization (%)',
					required: false,
					defaultValue: '95',
				},
				{
					name: 'warningMemoryUsagePercent',
					label: 'Warning Memory Usage (%)',
					required: false,
					defaultValue: '85',
				},
				{
					name: 'criticalMemoryUsagePercent',
					label: 'Critical Memory Usage (%)',
					required: false,
					defaultValue: '95',
				},
				{
					name: 'warningPowerUsagePercent',
					label: 'Warning Power Usage (%)',
					required: false,
					defaultValue: '85',
				},
				{
					name: 'criticalPowerUsagePercent',
					label: 'Critical Power Usage (%)',
					required: false,
					defaultValue: '95',
				},
			],
		},
	],
} satisfies PluginMeta;

const execFileAsync = promisify(execFile);

const EXEC_TIMEOUT_MS = 10_000;
const EXEC_MAX_BUFFER_BYTES = 1024 * 1024;

const QUERY_FIELDS = [
	'index',
	'driver_version',
	'name',
	'temperature.gpu',
	'utilization.gpu',
	'memory.used',
	'memory.total',
	'power.draw',
	'power.limit',
].join(',');

const DRIVER_COMMUNICATION_FAILURE =
	"NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver";

const runNvidiaSmi: CommandRunner = async () => {
	const result = await execFileAsync(
		'nvidia-smi',
		[`--query-gpu=${QUERY_FIELDS}`, '--format=csv,noheader,nounits'],
		{
			timeout: EXEC_TIMEOUT_MS,
			maxBuffer: EXEC_MAX_BUFFER_BYTES,
		},
	);
	return {
		stdout: result.stdout,
		stderr: result.stderr,
	};
};

const parseNumber = (value: string): number | undefined => {
	const trimmed = value.trim();
	if (
		trimmed.length === 0 ||
		trimmed.toUpperCase() === 'N/A' ||
		trimmed.toUpperCase() === '[N/A]' ||
		trimmed.toUpperCase() === 'NOT SUPPORTED' ||
		trimmed.toUpperCase() === '[NOT SUPPORTED]'
	) {
		return undefined;
	}

	const numericMatch = trimmed.match(/-?\d+(?:\.\d+)?/);
	if (!numericMatch) {
		return undefined;
	}

	const parsed = Number(numericMatch[0]);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const parseOptionalThreshold = (
	value: string | undefined,
	parameterName: keyof ThresholdConfig,
): {value?: number; error?: string} => {
	if (value === undefined) {
		return {};
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return {error: `${parameterName} must be a valid number`};
	}

	return {value: parsed};
};

const parseExpectedGpuCount = (
	value: string | undefined,
): number | undefined => {
	if (value === undefined) {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		return undefined;
	}

	return parsed;
};

const getThresholds = (
	params: Record<string, string>,
): {thresholds: ThresholdConfig; error?: string} => {
	const thresholdEntries: Array<keyof ThresholdConfig> = [
		'warningTempC',
		'criticalTempC',
		'warningUtilizationPercent',
		'criticalUtilizationPercent',
		'warningMemoryUsagePercent',
		'criticalMemoryUsagePercent',
		'warningPowerUsagePercent',
		'criticalPowerUsagePercent',
	];
	const thresholds: ThresholdConfig = {};

	for (const thresholdName of thresholdEntries) {
		const parsedThreshold = parseOptionalThreshold(
			params[thresholdName],
			thresholdName,
		);
		if (parsedThreshold.error) {
			return {thresholds: {}, error: parsedThreshold.error};
		}

		if (parsedThreshold.value !== undefined) {
			thresholds[thresholdName] = parsedThreshold.value;
		}
	}

	return {thresholds};
};

const validateThresholds = (
	thresholds: ThresholdConfig,
): string | undefined => {
	if (
		(thresholds.warningUtilizationPercent !== undefined &&
			(thresholds.warningUtilizationPercent < 0 ||
				thresholds.warningUtilizationPercent > 100)) ||
		(thresholds.criticalUtilizationPercent !== undefined &&
			(thresholds.criticalUtilizationPercent < 0 ||
				thresholds.criticalUtilizationPercent > 100))
	) {
		return 'utilization thresholds must be between 0 and 100';
	}

	if (
		(thresholds.warningMemoryUsagePercent !== undefined &&
			(thresholds.warningMemoryUsagePercent < 0 ||
				thresholds.warningMemoryUsagePercent > 100)) ||
		(thresholds.criticalMemoryUsagePercent !== undefined &&
			(thresholds.criticalMemoryUsagePercent < 0 ||
				thresholds.criticalMemoryUsagePercent > 100))
	) {
		return 'memory usage thresholds must be between 0 and 100';
	}

	if (
		(thresholds.warningPowerUsagePercent !== undefined &&
			(thresholds.warningPowerUsagePercent < 0 ||
				thresholds.warningPowerUsagePercent > 100)) ||
		(thresholds.criticalPowerUsagePercent !== undefined &&
			(thresholds.criticalPowerUsagePercent < 0 ||
				thresholds.criticalPowerUsagePercent > 100))
	) {
		return 'power usage thresholds must be between 0 and 100';
	}

	if (
		(thresholds.warningTempC !== undefined &&
			thresholds.warningTempC < -273.15) ||
		(thresholds.criticalTempC !== undefined &&
			thresholds.criticalTempC < -273.15)
	) {
		return 'temperature thresholds must be greater than or equal to -273.15';
	}

	if (
		thresholds.warningTempC !== undefined &&
		thresholds.criticalTempC !== undefined &&
		thresholds.warningTempC > thresholds.criticalTempC
	) {
		return 'warningTempC must be less than or equal to criticalTempC';
	}

	if (
		thresholds.warningUtilizationPercent !== undefined &&
		thresholds.criticalUtilizationPercent !== undefined &&
		thresholds.warningUtilizationPercent > thresholds.criticalUtilizationPercent
	) {
		return 'warningUtilizationPercent must be less than or equal to criticalUtilizationPercent';
	}

	if (
		thresholds.warningMemoryUsagePercent !== undefined &&
		thresholds.criticalMemoryUsagePercent !== undefined &&
		thresholds.warningMemoryUsagePercent > thresholds.criticalMemoryUsagePercent
	) {
		return 'warningMemoryUsagePercent must be less than or equal to criticalMemoryUsagePercent';
	}

	if (
		thresholds.warningPowerUsagePercent !== undefined &&
		thresholds.criticalPowerUsagePercent !== undefined &&
		thresholds.warningPowerUsagePercent > thresholds.criticalPowerUsagePercent
	) {
		return 'warningPowerUsagePercent must be less than or equal to criticalPowerUsagePercent';
	}

	return undefined;
};

const parseCsvFields = (line: string): string[] => {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		if (char === '"') {
			const isEscapedQuote = inQuotes && line[i + 1] === '"';
			if (isEscapedQuote) {
				current += '"';
				i += 1;
				continue;
			}

			inQuotes = !inQuotes;
			continue;
		}

		if (char === ',' && !inQuotes) {
			fields.push(current.trim());
			current = '';
			continue;
		}

		current += char;
	}

	fields.push(current.trim());
	return fields;
};

const parseCsvGpuLine = (line: string): GpuMetrics | undefined => {
	const fields = parseCsvFields(line);
	if (fields.length < 9) {
		return undefined;
	}

	const index = parseNumber(fields[0]);
	const driverVersion =
		fields[1] && fields[1].toUpperCase() !== 'N/A' ? fields[1] : undefined;
	const name = fields[2];
	const temperatureC = parseNumber(fields[3]);
	const utilizationGpuPercent = parseNumber(fields[4]);
	const memoryUsedMiB = parseNumber(fields[5]);
	const memoryTotalMiB = parseNumber(fields[6]);
	const powerDrawW = parseNumber(fields[7]);
	const powerLimitW = parseNumber(fields[8]);

	if (
		index === undefined ||
		!name ||
		temperatureC === undefined ||
		utilizationGpuPercent === undefined ||
		memoryUsedMiB === undefined ||
		memoryTotalMiB === undefined
	) {
		return undefined;
	}

	const memoryUsagePercent =
		memoryTotalMiB > 0 ? (memoryUsedMiB / memoryTotalMiB) * 100 : 0;
	const powerUsagePercent =
		powerDrawW !== undefined && powerLimitW !== undefined && powerLimitW > 0
			? (powerDrawW / powerLimitW) * 100
			: undefined;

	return {
		index,
		name,
		driverVersion,
		temperatureC,
		utilizationGpuPercent,
		memoryUsedMiB,
		memoryTotalMiB,
		memoryUsagePercent,
		powerDrawW,
		powerLimitW,
		powerUsagePercent,
	};
};

const parseGpuMetrics = (output: string): GpuMetrics[] => {
	const metrics: GpuMetrics[] = [];
	const seenIndexes = new Set<number>();
	for (const line of output.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.toLowerCase().startsWith('index,')) {
			continue;
		}

		const parsed = parseCsvGpuLine(trimmed);
		if (parsed) {
			if (seenIndexes.has(parsed.index)) {
				return [];
			}

			seenIndexes.add(parsed.index);
			metrics.push(parsed);
		}
	}

	return metrics;
};

export const getStatusText = (
	status: number,
): 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN' => {
	if (status === STATUS_OK) {
		return 'OK';
	}
	if (status === STATUS_WARNING) {
		return 'WARNING';
	}
	if (status === STATUS_CRITICAL) {
		return 'CRITICAL';
	}

	return 'UNKNOWN';
};

const evaluateMetrics = (
	metrics: GpuMetrics[],
	thresholds: ThresholdConfig,
): {status: number; issues: string[]} => {
	const criticalIssues: string[] = [];
	const warningIssues: string[] = [];

	for (const gpu of metrics) {
		if (
			thresholds.criticalTempC !== undefined &&
			gpu.temperatureC >= thresholds.criticalTempC
		) {
			criticalIssues.push(
				`GPU ${gpu.index} (${gpu.name}) temperature ${gpu.temperatureC}C >= critical ${thresholds.criticalTempC}C`,
			);
		} else if (
			thresholds.warningTempC !== undefined &&
			gpu.temperatureC >= thresholds.warningTempC
		) {
			warningIssues.push(
				`GPU ${gpu.index} (${gpu.name}) temperature ${gpu.temperatureC}C >= warning ${thresholds.warningTempC}C`,
			);
		}

		if (
			thresholds.criticalUtilizationPercent !== undefined &&
			gpu.utilizationGpuPercent >= thresholds.criticalUtilizationPercent
		) {
			criticalIssues.push(
				`GPU ${gpu.index} (${gpu.name}) utilization ${gpu.utilizationGpuPercent}% >= critical ${thresholds.criticalUtilizationPercent}%`,
			);
		} else if (
			thresholds.warningUtilizationPercent !== undefined &&
			gpu.utilizationGpuPercent >= thresholds.warningUtilizationPercent
		) {
			warningIssues.push(
				`GPU ${gpu.index} (${gpu.name}) utilization ${gpu.utilizationGpuPercent}% >= warning ${thresholds.warningUtilizationPercent}%`,
			);
		}

		if (
			thresholds.criticalMemoryUsagePercent !== undefined &&
			gpu.memoryUsagePercent >= thresholds.criticalMemoryUsagePercent
		) {
			criticalIssues.push(
				`GPU ${gpu.index} (${gpu.name}) memory usage ${gpu.memoryUsagePercent.toFixed(1)}% >= critical ${thresholds.criticalMemoryUsagePercent}%`,
			);
		} else if (
			thresholds.warningMemoryUsagePercent !== undefined &&
			gpu.memoryUsagePercent >= thresholds.warningMemoryUsagePercent
		) {
			warningIssues.push(
				`GPU ${gpu.index} (${gpu.name}) memory usage ${gpu.memoryUsagePercent.toFixed(1)}% >= warning ${thresholds.warningMemoryUsagePercent}%`,
			);
		}

		if (gpu.powerUsagePercent !== undefined) {
			if (
				thresholds.criticalPowerUsagePercent !== undefined &&
				gpu.powerUsagePercent >= thresholds.criticalPowerUsagePercent
			) {
				criticalIssues.push(
					`GPU ${gpu.index} (${gpu.name}) power usage ${gpu.powerUsagePercent.toFixed(1)}% >= critical ${thresholds.criticalPowerUsagePercent}%`,
				);
			} else if (
				thresholds.warningPowerUsagePercent !== undefined &&
				gpu.powerUsagePercent >= thresholds.warningPowerUsagePercent
			) {
				warningIssues.push(
					`GPU ${gpu.index} (${gpu.name}) power usage ${gpu.powerUsagePercent.toFixed(1)}% >= warning ${thresholds.warningPowerUsagePercent}%`,
				);
			}
		}
	}

	if (criticalIssues.length > 0) {
		return {status: STATUS_CRITICAL, issues: criticalIssues};
	}

	if (warningIssues.length > 0) {
		return {status: STATUS_WARNING, issues: warningIssues};
	}

	return {status: STATUS_OK, issues: []};
};

const buildPerformanceData = (
	metrics: GpuMetrics[],
	thresholds: ThresholdConfig,
): Array<{
	label: string;
	value: string;
	uom: string;
	warn?: string;
	crit?: string;
	min?: string;
	max?: string;
}> => {
	const performanceData: Array<{
		label: string;
		value: string;
		uom: string;
		warn?: string;
		crit?: string;
		min?: string;
		max?: string;
	}> = [
		{
			label: 'gpu_count',
			value: String(metrics.length),
			uom: '',
			min: '0',
		},
	];

	for (const gpu of metrics) {
		performanceData.push({
			label: `gpu${gpu.index}_temp_c`,
			value: String(gpu.temperatureC),
			uom: 'C',
			warn:
				thresholds.warningTempC !== undefined
					? String(thresholds.warningTempC)
					: undefined,
			crit:
				thresholds.criticalTempC !== undefined
					? String(thresholds.criticalTempC)
					: undefined,
			min: '0',
		});
		performanceData.push({
			label: `gpu${gpu.index}_utilization_pct`,
			value: String(gpu.utilizationGpuPercent),
			uom: '%',
			warn:
				thresholds.warningUtilizationPercent !== undefined
					? String(thresholds.warningUtilizationPercent)
					: undefined,
			crit:
				thresholds.criticalUtilizationPercent !== undefined
					? String(thresholds.criticalUtilizationPercent)
					: undefined,
			min: '0',
			max: '100',
		});
		performanceData.push({
			label: `gpu${gpu.index}_memory_used_mib`,
			value: String(gpu.memoryUsedMiB),
			uom: 'MiB',
			min: '0',
			max: String(gpu.memoryTotalMiB),
		});
		performanceData.push({
			label: `gpu${gpu.index}_memory_used_pct`,
			value: gpu.memoryUsagePercent.toFixed(1),
			uom: '%',
			warn:
				thresholds.warningMemoryUsagePercent !== undefined
					? String(thresholds.warningMemoryUsagePercent)
					: undefined,
			crit:
				thresholds.criticalMemoryUsagePercent !== undefined
					? String(thresholds.criticalMemoryUsagePercent)
					: undefined,
			min: '0',
			max: '100',
		});

		if (gpu.powerDrawW !== undefined) {
			performanceData.push({
				label: `gpu${gpu.index}_power_draw_w`,
				value: gpu.powerDrawW.toFixed(1),
				uom: 'W',
				min: '0',
				max:
					gpu.powerLimitW !== undefined
						? gpu.powerLimitW.toFixed(1)
						: undefined,
			});
		}

		if (gpu.powerLimitW !== undefined) {
			performanceData.push({
				label: `gpu${gpu.index}_power_limit_w`,
				value: gpu.powerLimitW.toFixed(1),
				uom: 'W',
				min: '0',
			});
		}

		if (gpu.powerUsagePercent !== undefined) {
			performanceData.push({
				label: `gpu${gpu.index}_power_used_pct`,
				value: gpu.powerUsagePercent.toFixed(1),
				uom: '%',
				warn:
					thresholds.warningPowerUsagePercent !== undefined
						? String(thresholds.warningPowerUsagePercent)
						: undefined,
				crit:
					thresholds.criticalPowerUsagePercent !== undefined
						? String(thresholds.criticalPowerUsagePercent)
						: undefined,
				min: '0',
				max: '100',
			});
		}
	}

	return performanceData;
};

export const analyzeNvidiaSmiOutput = (output: string): NvidiaSmiAnalysis => {
	const normalized = output.trim();
	const metrics = parseGpuMetrics(normalized);

	return {
		metrics,
		hasDriverCommunicationFailure: normalized.includes(
			DRIVER_COMMUNICATION_FAILURE,
		),
		hasNvidiaSmiBanner: normalized.includes('NVIDIA-SMI') || metrics.length > 0,
	};
};

export const checkNvidiaSmi = async (
	params: Record<string, string> = {},
	runner: CommandRunner = runNvidiaSmi,
) => {
	const {thresholds, error: thresholdParseError} = getThresholds(params);
	const expectedGpuCount = parseExpectedGpuCount(params.expectedGpuCount);
	if (params.expectedGpuCount !== undefined && expectedGpuCount === undefined) {
		return {
			message:
				'UNKNOWN: invalid expectedGpuCount. Provide a non-negative integer value.',
			code: STATUS_UNKNOWN,
		};
	}
	if (thresholdParseError) {
		return {
			message: `UNKNOWN: invalid threshold configuration: ${thresholdParseError}`,
			code: STATUS_UNKNOWN,
		};
	}
	const thresholdValidationError = validateThresholds(thresholds);
	if (thresholdValidationError) {
		return {
			message: `UNKNOWN: invalid threshold configuration: ${thresholdValidationError}`,
			code: STATUS_UNKNOWN,
		};
	}

	try {
		const {stdout, stderr} = await runner();
		const combinedOutput = [stdout, stderr].filter(Boolean).join('\n');
		const analysis = analyzeNvidiaSmiOutput(combinedOutput);

		if (analysis.hasDriverCommunicationFailure) {
			return {
				message:
					'CRITICAL: nvidia-smi could not communicate with the NVIDIA driver. Ensure the NVIDIA driver is installed and running.',
				code: STATUS_CRITICAL,
			};
		}

		if (!analysis.hasNvidiaSmiBanner) {
			return {
				message:
					'UNKNOWN: nvidia-smi did not return recognizable output. Verify command execution and permissions.',
				code: STATUS_UNKNOWN,
			};
		}

		if (analysis.metrics.length === 0) {
			return {
				message:
					'CRITICAL: NVIDIA driver was detected but no GPU entries were found in nvidia-smi output.',
				code: STATUS_CRITICAL,
			};
		}

		if (
			expectedGpuCount !== undefined &&
			analysis.metrics.length !== expectedGpuCount
		) {
			return {
				message: `CRITICAL: detected ${analysis.metrics.length} GPU(s), expected ${expectedGpuCount}.`,
				code: STATUS_CRITICAL,
				performanceData: buildPerformanceData(analysis.metrics, thresholds),
			};
		}

		const driverVersions = [
			...new Set(
				analysis.metrics
					.map((gpu) => gpu.driverVersion)
					.filter((value): value is string =>
						Boolean(value && value.length > 0),
					),
			),
		];
		if (driverVersions.length === 0) {
			return {
				message:
					'CRITICAL: GPU entries were found but NVIDIA driver version could not be detected.',
				code: STATUS_CRITICAL,
			};
		}

		const driverText =
			driverVersions.length === 1
				? `driver ${driverVersions[0]}`
				: `drivers ${driverVersions.join(', ')}`;
		const evaluation = evaluateMetrics(analysis.metrics, thresholds);
		const summary = analysis.metrics
			.map(
				(gpu) =>
					`GPU ${gpu.index} ${gpu.name} temp ${gpu.temperatureC}C util ${gpu.utilizationGpuPercent}% memory ${gpu.memoryUsedMiB}/${gpu.memoryTotalMiB}MiB${
						gpu.powerDrawW !== undefined && gpu.powerLimitW !== undefined
							? ` power ${gpu.powerDrawW.toFixed(1)}/${gpu.powerLimitW.toFixed(1)}W`
							: ''
					}`,
			)
			.join('; ');

		return {
			message:
				evaluation.issues.length > 0
					? `${getStatusText(evaluation.status)}: NVIDIA ${driverText} detected with ${analysis.metrics.length} GPU(s); ${evaluation.issues.join('; ')}`
					: `OK: NVIDIA ${driverText} detected with ${analysis.metrics.length} GPU(s); ${summary}`,
			code: evaluation.status,
			performanceData: buildPerformanceData(analysis.metrics, thresholds),
		};
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return {
				message:
					'UNKNOWN: nvidia-smi command was not found on this system. Install NVIDIA drivers and utilities.',
				code: STATUS_UNKNOWN,
			};
		}

		const errorOutput =
			error instanceof Error &&
			'stderr' in error &&
			typeof error.stderr === 'string'
				? [
						error.stderr,
						'stdout' in error && typeof error.stdout === 'string'
							? error.stdout
							: '',
					]
						.filter(Boolean)
						.join('\n')
				: error instanceof Error
					? error.message
					: '';
		const analysis = analyzeNvidiaSmiOutput(errorOutput);
		if (analysis.hasDriverCommunicationFailure) {
			return {
				message:
					'CRITICAL: nvidia-smi could not communicate with the NVIDIA driver. Ensure the NVIDIA driver is installed and running.',
				code: STATUS_CRITICAL,
			};
		}

		return {
			message: `UNKNOWN: failed to execute nvidia-smi: ${
				error instanceof Error ? error.message : 'unexpected error'
			}`,
			code: STATUS_UNKNOWN,
		};
	}
};
