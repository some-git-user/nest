import fs from 'fs';
import type {
	NagiosPerformanceData,
	NagiosReturnCode,
} from '../src/types/nagios';
import {NagiosReturnCodes} from '../src/types/nagios';
import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../src/types/plugin';

/**
 * Battery health checker.
 *
 * Reads the kernel's own view of the batteries straight from
 * `/sys/class/power_supply/<name>/` rather than shelling out to `upower`: the
 * `type` file identifies which power supplies are batteries, and each battery
 * exposes its charge/energy figures, capacity, status and alarm flag. This
 * needs no external binary, no D-Bus daemon and no root, and it never builds a
 * shell command, so there is no injection surface - the same pure-filesystem
 * shape as `check-mdadm-raid` and `check-reboot-required`.
 *
 * The headline health signal is the battery's State of Health (SOH), i.e. how
 * much charge it can still hold compared to when it was new:
 *
 *   SOH = charge_full / charge_full_design * 100
 *
 * Some batteries report energy instead of charge, so `energy_full` /
 * `energy_full_design` is used as a fallback. A worn battery (low SOH) is the
 * failure mode nothing else flags - it still charges and discharges normally,
 * but no longer holds a useful charge. Current charge (`capacity`) is only
 * alerted on while the machine is actually running on battery, so a laptop
 * parked on its charger at 40 % is not treated as an incident.
 *
 * All sysfs magnitudes are micro-units (`charge_*` in uAh, `energy_*` in uWh,
 * `voltage_*` in uV); they are only ever compared to each other or divided
 * out, so no unit conversion is needed except volts for the perfdata.
 */
export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-battery-health[?warningHealthPercent=<number>&criticalHealthPercent=<number>&warningChargePercent=<number>&criticalChargePercent=<number>&checkCharge=<true | false>&treatNoBatteryAs=<unknown | critical>]',
		shell:
			'./check_nest.sh check-battery-health [warningHealthPercent=80] [criticalHealthPercent=60] [warningChargePercent=20] [criticalChargePercent=10] [checkCharge=true] [treatNoBatteryAs=unknown]',
	},
	help: `<h1>check-battery-health</h1>
<p>Monitors battery health by reading <code>/sys/class/power_supply/&lt;name&gt;/*</code>. No external binary, no D-Bus daemon and no root privileges are required, and no shell command is built.</p>

<h2>What it checks</h2>
<ul>
<li><strong>State of Health (SOH)</strong> - <code>charge_full / charge_full_design</code> (or <code>energy_full / energy_full_design</code>) as a percentage. This is battery wear: how much charge the pack can still hold compared to new. Below the warning threshold it warns, below the critical threshold it is critical.</li>
<li><strong>Current charge</strong> - the <code>capacity</code> percentage, checked against the charge thresholds <em>only while running on battery</em> (status <code>Discharging</code>, or AC offline when status is unavailable). A laptop on its charger is never alerted on for charge level.</li>
<li><strong>Alarm flag</strong> - a raised <code>alarm</code> file means the battery firmware has flagged a fault and is critical.</li>
<li><strong>Presence</strong> - a battery whose <code>present</code> file reads <code>0</code> has been removed or has failed to enumerate and is critical.</li>
</ul>

<h2>Parameters</h2>
<table>
<tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
<tr><td><code>warningHealthPercent</code></td><td>number</td><td><code>80</code></td><td>WARNING when State of Health is at or below this percentage.</td></tr>
<tr><td><code>criticalHealthPercent</code></td><td>number</td><td><code>60</code></td><td>CRITICAL when State of Health is at or below this percentage.</td></tr>
<tr><td><code>warningChargePercent</code></td><td>number</td><td><code>20</code></td><td>WARNING when current charge is at or below this percentage while discharging.</td></tr>
<tr><td><code>criticalChargePercent</code></td><td>number</td><td><code>10</code></td><td>CRITICAL when current charge is at or below this percentage while discharging.</td></tr>
<tr><td><code>checkCharge</code></td><td>boolean</td><td><code>true</code></td><td>Also alert on low current charge while discharging. Set false to monitor wear only.</td></tr>
<tr><td><code>treatNoBatteryAs</code></td><td>string</td><td><code>unknown</code></td><td>Return code when no battery is present: <code>unknown</code> (a desktop has none) or <code>critical</code> (a laptop lost its battery).</td></tr>
</table>

<h2>Return codes</h2>
<ul>
<li><strong>OK</strong> - every battery is present, healthy and (when on battery) adequately charged.</li>
<li><strong>WARNING</strong> - a battery's State of Health is at or below the warning threshold, or its charge is low while discharging.</li>
<li><strong>CRITICAL</strong> - a battery is worn past the critical threshold, critically low while discharging, has raised its alarm flag, is reported not present, or no battery exists and treatNoBatteryAs is <code>critical</code>.</li>
<li><strong>UNKNOWN</strong> - invalid parameters, or no battery exists and treatNoBatteryAs is <code>unknown</code>.</li>
</ul>

<h2>Examples</h2>
<pre>./check_nest.sh check-battery-health</pre>
<pre>./check_nest.sh check-battery-health warningHealthPercent=85 criticalHealthPercent=70</pre>
<pre>./check_nest.sh check-battery-health checkCharge=false treatNoBatteryAs=critical</pre>

<h2>References</h2>
<ul>
<li><a href="https://www.kernel.org/doc/html/latest/power/power_supply_class.html" target="_blank" rel="noopener">Linux power supply class</a></li>
</ul>` as HtmlTemplateString,
	examples: [
		{
			label: 'Check battery health with default thresholds',
			method: 'GET',
			path: '/plugins/check-battery-health',
			fields: [],
		},
		{
			label: 'Custom wear thresholds',
			method: 'GET',
			path: '/plugins/check-battery-health',
			fields: [
				{
					name: 'warningHealthPercent',
					label: 'Warning Health (%)',
					required: false,
					defaultValue: '80',
				},
				{
					name: 'criticalHealthPercent',
					label: 'Critical Health (%)',
					required: false,
					defaultValue: '60',
				},
			],
		},
		{
			label: 'Wear only, treat a missing battery as critical',
			method: 'GET',
			path: '/plugins/check-battery-health',
			fields: [
				{
					name: 'checkCharge',
					label: 'Check Charge (true/false)',
					required: false,
					defaultValue: 'false',
				},
				{
					name: 'treatNoBatteryAs',
					label: 'No Battery As (unknown/critical)',
					required: false,
					defaultValue: 'critical',
				},
			],
		},
	],
} satisfies PluginMeta;

/** The filesystem seam, so tests can supply an in-memory power_supply sysfs. */
type FsLike = {
	readdirSync: (path: string) => string[];
	readFileSync: (path: string, encoding: 'utf-8') => string;
};

type Battery = {
	name: string;
	present?: number;
	alarm?: number;
	capacity?: number;
	healthPercent?: number;
	voltageVolts?: number;
	cycleCount?: number;
	status?: string;
};

type BatteryConfig = {
	warningHealthPercent: number;
	criticalHealthPercent: number;
	warningChargePercent: number;
	criticalChargePercent: number;
	checkCharge: boolean;
	treatNoBatteryAs: 'unknown' | 'critical';
};

type BatteryEvaluation = {
	code: NagiosReturnCode;
	issues: string[];
};

const POWER_SUPPLY_ROOT = '/sys/class/power_supply';

const DEFAULT_WARNING_HEALTH = 80;
const DEFAULT_CRITICAL_HEALTH = 60;
const DEFAULT_WARNING_CHARGE = 20;
const DEFAULT_CRITICAL_CHARGE = 10;

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

const parseOptionalNumber = (
	value: unknown,
	parameterName: string,
	fallback: number,
): {value?: number; error?: string} => {
	if (value === undefined) {
		return {value: fallback};
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

const getConfig = (
	params: Record<string, unknown>,
): {config?: BatteryConfig; error?: string} => {
	const warningHealth = parseOptionalNumber(
		params.warningHealthPercent,
		'warningHealthPercent',
		DEFAULT_WARNING_HEALTH,
	);
	if (warningHealth.error) {
		return {error: warningHealth.error};
	}

	const criticalHealth = parseOptionalNumber(
		params.criticalHealthPercent,
		'criticalHealthPercent',
		DEFAULT_CRITICAL_HEALTH,
	);
	if (criticalHealth.error) {
		return {error: criticalHealth.error};
	}

	const warningCharge = parseOptionalNumber(
		params.warningChargePercent,
		'warningChargePercent',
		DEFAULT_WARNING_CHARGE,
	);
	if (warningCharge.error) {
		return {error: warningCharge.error};
	}

	const criticalCharge = parseOptionalNumber(
		params.criticalChargePercent,
		'criticalChargePercent',
		DEFAULT_CRITICAL_CHARGE,
	);
	if (criticalCharge.error) {
		return {error: criticalCharge.error};
	}

	const treatNoBatteryRaw =
		typeof params.treatNoBatteryAs === 'string'
			? params.treatNoBatteryAs.trim().toLowerCase()
			: 'unknown';
	if (treatNoBatteryRaw !== 'unknown' && treatNoBatteryRaw !== 'critical') {
		return {
			error: 'treatNoBatteryAs must be either "unknown" or "critical"',
		};
	}

	const warningHealthPercent = warningHealth.value as number;
	const criticalHealthPercent = criticalHealth.value as number;
	const warningChargePercent = warningCharge.value as number;
	const criticalChargePercent = criticalCharge.value as number;

	if (warningHealthPercent < criticalHealthPercent) {
		return {
			error:
				'warningHealthPercent must be greater than or equal to criticalHealthPercent',
		};
	}

	if (warningChargePercent < criticalChargePercent) {
		return {
			error:
				'warningChargePercent must be greater than or equal to criticalChargePercent',
		};
	}

	return {
		config: {
			warningHealthPercent,
			criticalHealthPercent,
			warningChargePercent,
			criticalChargePercent,
			checkCharge: parseOptionalBoolean(params.checkCharge, true),
			treatNoBatteryAs: treatNoBatteryRaw,
		},
	};
};

/**
 * Read one sysfs file, returning undefined when it is missing or unreadable.
 * Optional power_supply attributes are simply absent on many batteries, so a
 * failed read is normal and never fatal.
 */
const readValue = (
	fsImpl: FsLike,
	name: string,
	file: string,
): string | undefined => {
	try {
		return fsImpl
			.readFileSync(`${POWER_SUPPLY_ROOT}/${name}/${file}`, 'utf-8')
			.trim();
	} catch {
		return undefined;
	}
};

const readNumber = (
	fsImpl: FsLike,
	name: string,
	file: string,
): number | undefined => {
	const raw = readValue(fsImpl, name, file);
	if (raw === undefined) {
		return undefined;
	}

	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * State of Health as a percentage, preferring charge and falling back to
 * energy. Undefined when the design figure is missing or zero (a divide-by-zero
 * would be meaningless), so the caller simply skips the health check.
 */
const computeHealthPercent = (
	full: number | undefined,
	design: number | undefined,
): number | undefined => {
	if (full === undefined || design === undefined || design <= 0) {
		return undefined;
	}

	return Math.round((full / design) * 1000) / 10;
};

const readBattery = (fsImpl: FsLike, name: string): Battery => {
	const chargeFull = readNumber(fsImpl, name, 'charge_full');
	const chargeFullDesign = readNumber(fsImpl, name, 'charge_full_design');
	const energyFull = readNumber(fsImpl, name, 'energy_full');
	const energyFullDesign = readNumber(fsImpl, name, 'energy_full_design');
	const voltageNow = readNumber(fsImpl, name, 'voltage_now');

	return {
		name,
		present: readNumber(fsImpl, name, 'present'),
		alarm: readNumber(fsImpl, name, 'alarm'),
		capacity: readNumber(fsImpl, name, 'capacity'),
		healthPercent:
			computeHealthPercent(chargeFull, chargeFullDesign) ??
			computeHealthPercent(energyFull, energyFullDesign),
		voltageVolts:
			voltageNow === undefined
				? undefined
				: Math.round(voltageNow / 1000) / 1000,
		cycleCount: readNumber(fsImpl, name, 'cycle_count'),
		status: readValue(fsImpl, name, 'status'),
	};
};

/** Every power supply whose `type` file reads "Battery", sorted by name. */
export const discoverBatteries = (fsImpl: FsLike): string[] => {
	let entries: string[];
	try {
		entries = fsImpl.readdirSync(POWER_SUPPLY_ROOT);
	} catch {
		return [];
	}

	return entries
		.filter((name) => readValue(fsImpl, name, 'type') === 'Battery')
		.sort();
};

const discoverAllSupplies = (fsImpl: FsLike): string[] => {
	try {
		return fsImpl.readdirSync(POWER_SUPPLY_ROOT);
	} catch {
		return [];
	}
};

/**
 * A battery is "on battery" when its status says Discharging, or - when status
 * is unavailable - when no mains supply reports itself online. Charge
 * thresholds only apply in that state.
 */
const isDischarging = (fsImpl: FsLike, battery: Battery): boolean => {
	if (battery.status === 'Discharging') {
		return true;
	}

	if (battery.status !== undefined) {
		return false;
	}

	const acOnline = discoverAllSupplies(fsImpl).some(
		(name) =>
			readValue(fsImpl, name, 'type') === 'Mains' &&
			readNumber(fsImpl, name, 'online') === 1,
	);

	return !acOnline;
};

const fmt = (value: number | undefined, suffix: string): string => {
	return value === undefined ? 'n/a' : `${value}${suffix}`;
};

export const evaluateBattery = (
	fsImpl: FsLike,
	battery: Battery,
	config: BatteryConfig,
): BatteryEvaluation => {
	const issues: string[] = [];
	let code: NagiosReturnCode = NagiosReturnCodes.OK;

	const raise = (candidate: NagiosReturnCode, message: string): void => {
		issues.push(`${battery.name}: ${message}`);
		if (candidate > code) {
			code = candidate;
		}
	};

	if (battery.present === 0) {
		raise(NagiosReturnCodes.CRITICAL, 'battery is not present');
		return {code, issues};
	}

	if (battery.alarm !== undefined && battery.alarm !== 0) {
		raise(NagiosReturnCodes.CRITICAL, 'battery alarm flag is set');
	}

	if (battery.healthPercent !== undefined) {
		if (battery.healthPercent <= config.criticalHealthPercent) {
			raise(
				NagiosReturnCodes.CRITICAL,
				`health ${battery.healthPercent}% <= critical ${config.criticalHealthPercent}%`,
			);
		} else if (battery.healthPercent <= config.warningHealthPercent) {
			raise(
				NagiosReturnCodes.WARNING,
				`health ${battery.healthPercent}% <= warning ${config.warningHealthPercent}%`,
			);
		}
	}

	if (config.checkCharge && isDischarging(fsImpl, battery)) {
		if (
			battery.capacity !== undefined &&
			battery.capacity <= config.criticalChargePercent
		) {
			raise(
				NagiosReturnCodes.CRITICAL,
				`charge ${battery.capacity}% <= critical ${config.criticalChargePercent}% while discharging`,
			);
		} else if (
			battery.capacity !== undefined &&
			battery.capacity <= config.warningChargePercent
		) {
			raise(
				NagiosReturnCodes.WARNING,
				`charge ${battery.capacity}% <= warning ${config.warningChargePercent}% while discharging`,
			);
		}
	}

	return {code, issues};
};

const minOf = (
	batteries: Battery[],
	pick: (battery: Battery) => number | undefined,
): number | undefined => {
	const values = batteries
		.map(pick)
		.filter((value): value is number => value !== undefined);

	if (values.length === 0) {
		return undefined;
	}

	return Math.min(...values);
};

const buildPerformanceData = (
	batteries: Battery[],
	config: BatteryConfig,
): NagiosPerformanceData[] => {
	const performanceData: NagiosPerformanceData[] = [
		{
			label: 'battery_count',
			value: String(batteries.length),
			uom: '',
			min: '0',
		},
		{
			label: 'health_percent',
			value: String(minOf(batteries, (b) => b.healthPercent) ?? ''),
			uom: '%',
			warn: String(config.warningHealthPercent),
			crit: String(config.criticalHealthPercent),
			min: '0',
			max: '100',
		},
		{
			label: 'charge_percent',
			value: String(minOf(batteries, (b) => b.capacity) ?? ''),
			uom: '%',
			warn: String(config.warningChargePercent),
			crit: String(config.criticalChargePercent),
			min: '0',
			max: '100',
		},
	];

	for (const battery of batteries) {
		const prefix = battery.name.replace(/[^A-Za-z0-9_]/g, '_');
		if (battery.healthPercent !== undefined) {
			performanceData.push({
				label: `${prefix}_health_percent`,
				value: String(battery.healthPercent),
				uom: '%',
				warn: String(config.warningHealthPercent),
				crit: String(config.criticalHealthPercent),
				min: '0',
				max: '100',
			});
		}
		if (battery.capacity !== undefined) {
			performanceData.push({
				label: `${prefix}_charge_percent`,
				value: String(battery.capacity),
				uom: '%',
				min: '0',
				max: '100',
			});
		}
		if (battery.voltageVolts !== undefined) {
			performanceData.push({
				label: `${prefix}_voltage`,
				value: String(battery.voltageVolts),
				uom: 'V',
			});
		}
		if (battery.cycleCount !== undefined) {
			performanceData.push({
				label: `${prefix}_cycle_count`,
				value: String(battery.cycleCount),
				uom: '',
				min: '0',
			});
		}
	}

	return performanceData;
};

export const checkBatteryHealth = (
	params: Record<string, unknown> = {},
	fsImpl: FsLike = fs,
): PluginReturn => {
	const {config, error: configError} = getConfig(params);
	if (config === undefined) {
		return {
			message: `UNKNOWN: invalid configuration: ${configError}`,
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	const names = discoverBatteries(fsImpl);
	if (names.length === 0) {
		if (config.treatNoBatteryAs === 'critical') {
			return {
				message:
					'CRITICAL: no battery found but treatNoBatteryAs is critical - expected battery is missing',
				code: NagiosReturnCodes.CRITICAL,
				performanceData: [
					{label: 'battery_count', value: '0', uom: '', min: '0'},
				],
			};
		}

		return {
			message: `UNKNOWN: no battery found under ${POWER_SUPPLY_ROOT}`,
			code: NagiosReturnCodes.UNKNOWN,
			performanceData: [
				{label: 'battery_count', value: '0', uom: '', min: '0'},
			],
		};
	}

	const batteries = names.map((name) => readBattery(fsImpl, name));
	const evaluations = batteries.map((battery) =>
		evaluateBattery(fsImpl, battery, config),
	);

	const issues = evaluations.flatMap((evaluation) => evaluation.issues);
	const worstCode = evaluations.reduce<NagiosReturnCode>(
		(worst, evaluation) => (evaluation.code > worst ? evaluation.code : worst),
		NagiosReturnCodes.OK,
	);

	const performanceData = buildPerformanceData(batteries, config);

	if (worstCode !== NagiosReturnCodes.OK) {
		return {
			message: `${getStatusText(worstCode)}: battery check found ${issues.length} issue(s); ${issues.join('; ')}`,
			code: worstCode,
			performanceData,
		};
	}

	const worstHealth = minOf(batteries, (b) => b.healthPercent);
	const worstCharge = minOf(batteries, (b) => b.capacity);

	return {
		message: `OK: ${batteries.length} battery(s); worst health ${fmt(worstHealth, '%')}, worst charge ${fmt(worstCharge, '%')}`,
		code: NagiosReturnCodes.OK,
		performanceData,
	};
};
