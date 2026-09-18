import {execFile} from 'child_process';
import {promisify} from 'util';
import type {NagiosReturnCode} from '../src/types/nagios';
import {NagiosReturnCodes} from '../src/types/nagios';
import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../src/types/plugin';

/**
 * lm-sensors temperature checker.
 *
 * Runs `sensors -j` (lm-sensors JSON output) and evaluates every temperature
 * sensor it can find against configurable thresholds, optionally honouring the
 * chip's own `*_crit` / `*_max` limits and hardware `*_alarm` flags.
 *
 * The JSON shape produced by libsensors is:
 *
 *   {
 *     "<chip>": {
 *       "Adapter": "<adapter>",
 *       "<feature label>": {
 *         "temp1_input": 57.0,
 *         "temp1_max": 100.0,
 *         "temp1_crit": 100.0,
 *         "temp1_crit_alarm": 0.0
 *       }
 *     }
 *   }
 *
 * Only `tempN_input` readings are turned into monitored values; the matching
 * `tempN_crit` / `tempN_max` / `tempN_alarm` / `tempN_crit_alarm` keys provide
 * the per-sensor limits and alarm state.
 */

type CommandOutput = {
	stdout: string;
	stderr: string;
};

type CommandRunner = () => Promise<CommandOutput>;

type TempReading = {
	chip: string;
	feature: string;
	value: number;
	crit?: number;
	max?: number;
	alarm: boolean;
};

type ThresholdConfig = {
	warningTempC: number;
	criticalTempC: number;
	useChipLimits: boolean;
	checkAlarms: boolean;
	includeChips: string[];
	excludeChips: string[];
};

export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-lmsensors[?warningTempC=<number>&criticalTempC=<number>&useChipLimits=<true | false>&checkAlarms=<true | false>&includeChips=<csv>&excludeChips=<csv>]',
		shell:
			'./check_nest.sh check-lmsensors [warningTempC=<number>] [criticalTempC=<number>] [useChipLimits=<true | false>] [checkAlarms=<true | false>] [includeChips=<csv>] [excludeChips=<csv>]',
	},
	help: `<h1>check-lmsensors</h1>
<p>Monitors hardware temperatures using <code>lm-sensors</code> (<code>sensors -j</code>) and reports results in Nagios-compatible format.</p>

<h2>What This Plugin Checks</h2>
<ul>
  <li>Every <code>tempN_input</code> reading reported by <code>sensors -j</code></li>
  <li>Temperature against configurable global warning/critical thresholds</li>
  <li>The chip's own <code>*_crit</code> (critical) and <code>*_max</code> (warning) limits</li>
  <li>Hardware <code>*_alarm</code> / <code>*_crit_alarm</code> flags</li>
  <li>Optional chip include/exclude filtering (substring match)</li>
</ul>

<h2>Parameters</h2>
<table>
  <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
    <tr>
      <td><code>warningTempC</code></td>
      <td>number</td>
      <td>80</td>
      <td>Global warning threshold for any temperature sensor (&deg;C)</td>
    </tr>
    <tr>
      <td><code>criticalTempC</code></td>
      <td>number</td>
      <td>95</td>
      <td>Global critical threshold for any temperature sensor (&deg;C)</td>
    </tr>
    <tr>
      <td><code>useChipLimits</code></td>
      <td>boolean</td>
      <td>true</td>
      <td>Also alarm on each chip's own <code>*_crit</code> / <code>*_max</code> limits</td>
    </tr>
    <tr>
      <td><code>checkAlarms</code></td>
      <td>boolean</td>
      <td>true</td>
      <td>Treat a raised <code>*_alarm</code> / <code>*_crit_alarm</code> flag as CRITICAL</td>
    </tr>
    <tr>
      <td><code>includeChips</code></td>
      <td>string</td>
      <td>-</td>
      <td>Comma-separated list; only chips whose name contains one of these are checked</td>
    </tr>
    <tr>
      <td><code>excludeChips</code></td>
      <td>string</td>
      <td>-</td>
      <td>Comma-separated list; chips whose name contains one of these are skipped</td>
    </tr>
  </tbody>
</table>

<h2>Return Codes</h2>
<table>
  <tr><th>Code</th><th>Status</th><th>Description</th></tr>
  <tr><td>0</td><td>OK</td><td>All temperature sensors are within limits</td></tr>
  <tr><td>1</td><td>WARNING</td><td>One or more sensors are at/above a warning limit</td></tr>
  <tr><td>2</td><td>CRITICAL</td><td>A sensor is at/above a critical limit or a hardware alarm is raised</td></tr>
  <tr><td>3</td><td>UNKNOWN</td><td><code>sensors</code> missing, unparsable output, no temperature sensors, or invalid parameters</td></tr>
</table>

<h2>Prerequisites</h2>
<ul>
  <li><code>lm-sensors</code> installed and configured (<code>sensors-detect</code>)</li>
  <li><code>sensors</code> available in PATH and supporting the <code>-j</code> JSON flag</li>
</ul>

<h2>Examples</h2>
<h3>Basic check with defaults</h3>
<pre><code>./check_nest.sh check-lmsensors</code></pre>

<h3>Custom thresholds, ignore a noisy chip</h3>
<pre><code>./check_nest.sh check-lmsensors warningTempC=75 criticalTempC=90 excludeChips=iwlwifi_1</code></pre>

<h3>Only check the CPU package</h3>
<pre><code>GET /plugins/check-lmsensors?includeChips=coretemp</code></pre>` as HtmlTemplateString,
	examples: [
		{
			label: 'Check all sensors with default thresholds',
			method: 'GET',
			path: '/plugins/check-lmsensors',
			fields: [
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
					defaultValue: '95',
				},
			],
		},
		{
			label: 'Custom thresholds and chip filter',
			method: 'GET',
			path: '/plugins/check-lmsensors',
			fields: [
				{
					name: 'warningTempC',
					label: 'Warning Temperature (C)',
					required: false,
					defaultValue: '75',
				},
				{
					name: 'criticalTempC',
					label: 'Critical Temperature (C)',
					required: false,
					defaultValue: '90',
				},
				{
					name: 'excludeChips',
					label: 'Exclude Chips (csv)',
					required: false,
					defaultValue: 'iwlwifi_1',
				},
			],
		},
	],
} satisfies PluginMeta;

const execFileAsync = promisify(execFile);

const EXEC_TIMEOUT_MS = 10_000;
const EXEC_MAX_BUFFER_BYTES = 1024 * 1024;

const DEFAULT_WARNING_TEMP_C = 80;
const DEFAULT_CRITICAL_TEMP_C = 95;
const ABSOLUTE_ZERO_C = -273.15;

const TEMP_INPUT_PATTERN = /^(temp\d+)_input$/;

const runSensors: CommandRunner = async () => {
	const result = await execFileAsync('sensors', ['-j'], {
		timeout: EXEC_TIMEOUT_MS,
		maxBuffer: EXEC_MAX_BUFFER_BYTES,
	});
	return {
		stdout: result.stdout,
		stderr: result.stderr,
	};
};

export const getStatusText = (
	status: number,
): 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN' => {
	if (status === NagiosReturnCodes.OK) {
		return 'OK';
	}
	if (status === NagiosReturnCodes.WARNING) {
		return 'WARNING';
	}
	if (status === NagiosReturnCodes.CRITICAL) {
		return 'CRITICAL';
	}

	return 'UNKNOWN';
};

const toFiniteNumber = (value: unknown): number | undefined => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	return undefined;
};

const isAlarmRaised = (value: unknown): boolean => {
	return typeof value === 'number' && value !== 0;
};

const sanitizeLabel = (value: string): string => {
	return value.replace(/[^A-Za-z0-9_]/g, '_');
};

const splitCsv = (value: unknown): string[] => {
	if (typeof value !== 'string') {
		return [];
	}

	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
};

const parseOptionalNumber = (
	value: unknown,
	parameterName: string,
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

const parseOptionalBoolean = (
	value: unknown,
	defaultValue: boolean,
): boolean => {
	if (typeof value === 'boolean') {
		return value;
	}

	if (value === 'true') {
		return true;
	}

	if (value === 'false') {
		return false;
	}

	return defaultValue;
};

const getThresholds = (
	params: Record<string, unknown>,
): {config?: ThresholdConfig; error?: string} => {
	const warning = parseOptionalNumber(params.warningTempC, 'warningTempC');
	if (warning.error) {
		return {error: warning.error};
	}

	const critical = parseOptionalNumber(params.criticalTempC, 'criticalTempC');
	if (critical.error) {
		return {error: critical.error};
	}

	const warningTempC = warning.value ?? DEFAULT_WARNING_TEMP_C;
	const criticalTempC = critical.value ?? DEFAULT_CRITICAL_TEMP_C;

	if (warningTempC < ABSOLUTE_ZERO_C || criticalTempC < ABSOLUTE_ZERO_C) {
		return {
			error: 'temperature thresholds must be greater than or equal to -273.15',
		};
	}

	if (warningTempC > criticalTempC) {
		return {error: 'warningTempC must be less than or equal to criticalTempC'};
	}

	return {
		config: {
			warningTempC,
			criticalTempC,
			useChipLimits: parseOptionalBoolean(params.useChipLimits, true),
			checkAlarms: parseOptionalBoolean(params.checkAlarms, true),
			includeChips: splitCsv(params.includeChips),
			excludeChips: splitCsv(params.excludeChips),
		},
	};
};

const chipMatches = (chip: string, patterns: string[]): boolean => {
	return patterns.some((pattern) => chip.includes(pattern));
};

const isChipIncluded = (chip: string, config: ThresholdConfig): boolean => {
	if (
		config.includeChips.length > 0 &&
		!chipMatches(chip, config.includeChips)
	) {
		return false;
	}

	if (chipMatches(chip, config.excludeChips)) {
		return false;
	}

	return true;
};

export const parseTemperatureReadings = (
	data: Record<string, unknown>,
	config: ThresholdConfig,
): TempReading[] => {
	const readings: TempReading[] = [];

	for (const [chip, featuresValue] of Object.entries(data)) {
		if (typeof featuresValue !== 'object' || featuresValue === null) {
			continue;
		}

		if (!isChipIncluded(chip, config)) {
			continue;
		}

		for (const [feature, valuesValue] of Object.entries(
			featuresValue as Record<string, unknown>,
		)) {
			if (typeof valuesValue !== 'object' || valuesValue === null) {
				continue;
			}

			const values = valuesValue as Record<string, unknown>;
			for (const [key, rawValue] of Object.entries(values)) {
				const match = TEMP_INPUT_PATTERN.exec(key);
				if (!match) {
					continue;
				}

				const value = toFiniteNumber(rawValue);
				if (value === undefined) {
					continue;
				}

				const prefix = match[1];
				readings.push({
					chip,
					feature,
					value,
					crit: toFiniteNumber(values[`${prefix}_crit`]),
					max: toFiniteNumber(values[`${prefix}_max`]),
					alarm:
						isAlarmRaised(values[`${prefix}_alarm`]) ||
						isAlarmRaised(values[`${prefix}_crit_alarm`]),
				});
			}
		}
	}

	return readings;
};

type Evaluation = {
	status: number;
	issues: string[];
};

const formatReading = (reading: TempReading): string => {
	return `${reading.chip} "${reading.feature}" ${reading.value}C`;
};

export const evaluateReadings = (
	readings: TempReading[],
	config: ThresholdConfig,
): Evaluation => {
	const criticalIssues: string[] = [];
	const warningIssues: string[] = [];

	for (const reading of readings) {
		if (config.checkAlarms && reading.alarm) {
			criticalIssues.push(`${formatReading(reading)} hardware alarm raised`);
			continue;
		}

		if (
			config.useChipLimits &&
			reading.crit !== undefined &&
			reading.value >= reading.crit
		) {
			criticalIssues.push(
				`${formatReading(reading)} >= chip critical ${reading.crit}C`,
			);
			continue;
		}

		if (reading.value >= config.criticalTempC) {
			criticalIssues.push(
				`${formatReading(reading)} >= critical ${config.criticalTempC}C`,
			);
			continue;
		}

		if (
			config.useChipLimits &&
			reading.max !== undefined &&
			reading.value >= reading.max
		) {
			warningIssues.push(
				`${formatReading(reading)} >= chip max ${reading.max}C`,
			);
			continue;
		}

		if (reading.value >= config.warningTempC) {
			warningIssues.push(
				`${formatReading(reading)} >= warning ${config.warningTempC}C`,
			);
		}
	}

	if (criticalIssues.length > 0) {
		return {status: NagiosReturnCodes.CRITICAL, issues: criticalIssues};
	}

	if (warningIssues.length > 0) {
		return {status: NagiosReturnCodes.WARNING, issues: warningIssues};
	}

	return {status: NagiosReturnCodes.OK, issues: []};
};

const buildPerformanceData = (
	readings: TempReading[],
	config: ThresholdConfig,
): PluginReturn['performanceData'] => {
	const performanceData: NonNullable<PluginReturn['performanceData']> = [
		{
			label: 'temp_sensor_count',
			value: String(readings.length),
			uom: '',
			min: '0',
		},
	];

	for (const reading of readings) {
		performanceData.push({
			label: sanitizeLabel(`${reading.chip}_${reading.feature}_temp`),
			value: String(reading.value),
			uom: 'C',
			warn: String(config.warningTempC),
			crit: String(config.criticalTempC),
			min: '0',
		});
	}

	return performanceData;
};

const findHottest = (readings: TempReading[]): TempReading => {
	return readings.reduce((hottest, reading) =>
		reading.value > hottest.value ? reading : hottest,
	);
};

export const checkLmSensors = async (
	params: Record<string, unknown> = {},
	runner: CommandRunner = runSensors,
): Promise<PluginReturn> => {
	const {config, error: configError} = getThresholds(params);
	if (config === undefined) {
		return {
			message: `UNKNOWN: invalid configuration: ${configError}`,
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	let stdout: string;
	try {
		const output = await runner();
		stdout = output.stdout;
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return {
				message:
					'UNKNOWN: the sensors command was not found on this system. Install lm-sensors.',
				code: NagiosReturnCodes.UNKNOWN,
			};
		}

		return {
			message: `UNKNOWN: failed to execute sensors: ${
				error instanceof Error ? error.message : String(error)
			}`,
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	if (stdout.trim().length === 0) {
		return {
			message:
				'UNKNOWN: sensors returned no output. Run sensors-detect or check the lm-sensors setup.',
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return {
			message:
				'UNKNOWN: sensors output was not valid JSON. Ensure sensors supports the -j flag.',
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return {
			message: 'UNKNOWN: sensors JSON output had an unexpected structure.',
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	const readings = parseTemperatureReadings(
		parsed as Record<string, unknown>,
		config,
	);

	if (readings.length === 0) {
		return {
			message:
				'UNKNOWN: no temperature sensors were found in sensors output (check includeChips/excludeChips).',
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	const evaluation = evaluateReadings(readings, config);
	const hottest = findHottest(readings);
	const chipCount = new Set(readings.map((reading) => reading.chip)).size;
	const performanceData = buildPerformanceData(readings, config);

	if (evaluation.status !== NagiosReturnCodes.OK) {
		return {
			message: `${getStatusText(evaluation.status)}: lm-sensors detected ${evaluation.issues.length} issue(s); ${evaluation.issues.join('; ')}`,
			code: evaluation.status as NagiosReturnCode,
			performanceData,
		};
	}

	return {
		message: `OK: lm-sensors checked ${chipCount} chip(s), ${readings.length} temperature sensor(s); hottest ${formatReading(hottest)}`,
		code: NagiosReturnCodes.OK,
		performanceData,
	};
};
