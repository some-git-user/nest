import type {ExecSyncOptions as ChildProcessExecSyncOptions} from 'child_process';
import {execFileSync as defaultExecFileSync} from 'child_process';
import type {NagiosReturnCode} from '../src/types/nagios';
import {NagiosReturnCodes} from '../src/types/nagios';
import type {HtmlTemplateString, PluginMeta} from '../src/types/plugin';
import {PluginReturn} from '../src/types/plugin';

/**
 * SMART Disk Status Checker Plugin
 *
 * Monitors disk health using S.M.A.R.T. (Self-Monitoring, Analysis and Reporting Technology)
 * built into most ATA/SATA and SCSI/SAS hard drives and SSDs.
 *
 * Based on smartmontools smartctl exit status bitmask:
 * - Bit 0: Command line parsing error
 * - Bit 1: Device open failure or low-power mode
 * - Bit 2: SMART/ATA command failure or checksum error
 * - Bit 3: DISK FAILING status
 * - Bit 4: Prefail Attributes <= threshold
 * - Bit 5: Past Attribute failures
 * - Bit 6: Error log contains records
 * - Bit 7: Self-test log contains records
 *
 * Reference: https://www.smartmontools.org/wiki/Documentation
 */
export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-smart-status?device=<device>&checkType=<all|health|attributes|errors|selftest>',
		shell: './check_nest.sh check-smart-status device=/dev/sda checkType=all',
	},
	help: `<h1>SMART Disk Status Checker</h1>
<p>This plugin monitors disk health using S.M.A.R.T. (Self-Monitoring, Analysis and Reporting Technology) and reports results in Nagios-compatible format.</p>

<h2>What is S.M.A.R.T.?</h2>
<p>S.M.A.R.T. is a monitoring system built into most modern hard drives and SSDs. It tracks various metrics (attributes) that indicate the health and reliability of the storage device, helping predict potential failures before they occur.</p>

<h2>Supported Devices</h2>
<ul>
<li><strong>ATA/SATA disks:</strong> /dev/sda, /dev/sdb, etc.</li>
<li><strong>SCSI/SAS disks:</strong> /dev/sda, /dev/sdb, etc.</li>
<li><strong>NVMe drives:</strong> /dev/nvme0n1, /dev/nvme1n1, etc.</li>
<li><strong>RAID controllers:</strong> 3ware (/dev/twe[0-9]), LSI MegaRAID, HP Smart Array</li>
<li><strong>USB bridges:</strong> JMicron, Prolific, Cypress (limited support)</li>
</ul>

<h2>Parameters</h2>
<table>
<tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
<tr><td><code>device</code></td><td>string</td><td><strong>Required</strong></td><td>Device path (e.g., /dev/sda, /dev/nvme0n1)</td></tr>
<tr><td><code>checkType</code></td><td>string</td><td><code>all</code></td><td>Type of check: <code>all</code>, <code>health</code>, <code>attributes</code>, <code>errors</code>, <code>selftest</code></td></tr>
<tr><td><code>warningTemp</code></td><td>number</td><td><code>50</code></td><td>Warning temperature threshold (°C)</td></tr>
<tr><td><code>criticalTemp</code></td><td>number</td><td><code>60</code></td><td>Critical temperature threshold (°C)</td></tr>
<tr><td><code>skipPowerModeCheck</code></td><td>boolean</td><td><code>false</code></td><td>Don't fail if disk is in standby/sleep mode</td></tr>
</table>

<h2>Return Codes (Based on smartctl Exit Status)</h2>
<table>
<tr><th>Code</th><th>Status</th><th>Bit Flags</th><th>Description</th></tr>
<tr><td>0</td><td>OK</td><td>None</td><td>Disk health is good, no issues found</td></tr>
<tr><td>1</td><td>WARNING</td><td>Bits 4, 5, 6, 7</td><td>Past attribute failures, error logs, or self-test errors</td></tr>
<tr><td>2</td><td>CRITICAL</td><td>Bit 3</td><td>SMART status indicates "DISK FAILING"</td></tr>
<tr><td>3</td><td>UNKNOWN</td><td>Bits 0, 1, 2</td><td>Command errors, device open failure, or communication issues</td></tr>
</table>

<h2>SMART Exit Status Bitmask</h2>
<p>smartctl uses a bitmask to report different types of issues:</p>
<ul>
<li><strong>Bit 0:</strong> Command line parsing error</li>
<li><strong>Bit 1:</strong> Device open failed or in low-power mode</li>
<li><strong>Bit 2:</strong> SMART/ATA command failure or checksum error</li>
<li><strong>Bit 3:</strong> SMART status check returned "DISK FAILING"</li>
<li><strong>Bit 4:</strong> Prefail Attributes ≤ threshold</li>
<li><strong>Bit 5:</strong> SMART status OK but past attribute failures detected</li>
<li><strong>Bit 6:</strong> Error log contains error records</li>
<li><strong>Bit 7:</strong> Self-test log contains error records</li>
</ul>

<h2>Key SMART Attributes Monitored</h2>
<table>
<tr><th>Attribute ID</th><th>Name</th><th>Description</th><th>Typical Threshold</th></tr>
<tr><td>5</td><td>Reallocated_Sector_Ct</td><td>Count of reallocated sectors</td><td>Any value > 0 is concerning</td></tr>
<tr><td>9</td><td>Power_On_Hours</td><td>Total hours the disk has been powered on</td><td>> 50,000 hours indicates age</td></tr>
<tr><td>12</td><td>Power_Cycle_Count</td><td>Number of power-on cycles</td><td>High values indicate wear</td></tr>
<tr><td>194</td><td>Temperature_Celsius</td><td>Current disk temperature</td><td>> 50°C warning, > 60°C critical</td></tr>
<tr><td>197</td><td>Current_Pending_Sector</td><td>Sectors waiting to be reallocated</td><td>Any value > 0 is concerning</td></tr>
<tr><td>198</td><td>Offline_Uncorrectable</td><td>Uncorrectable sector errors</td><td>Any value > 0 is critical</td></tr>
<tr><td>199</td><td>UDMA_CRC_Error_Count</td><td>Interface CRC errors (cable issues)</td><td>Any value > 0 indicates cable problem</td></tr>
</table>

<h2>Check Types</h2>
<ul>
<li><strong>all:</strong> Full health check including SMART status, attributes, error log, and self-test log</li>
<li><strong>health:</strong> Quick SMART health status check only</li>
<li><strong>attributes:</strong> Check SMART attributes against thresholds</li>
<li><strong>errors:</strong> Check error log for recent errors</li>
<li><strong>selftest:</strong> Check self-test log for failed tests</li>
</ul>

<h2>Examples</h2>

<h3>Full disk health check</h3>
<pre>./check_nest.sh check-smart-status device=/dev/sda checkType=all</pre>

<h3>Quick health status</h3>
<pre>./check_nest.sh check-smart-status device=/dev/sda checkType=health</pre>

<h3>Check with custom temperature thresholds</h3>
<pre>./check_nest.sh check-smart-status device=/dev/sda warningTemp=45 criticalTemp=55</pre>

<h3>NVMe drive check</h3>
<pre>./check_nest.sh check-smart-status device=/dev/nvme0n1 checkType=all</pre>

<h3>Check multiple disks</h3>
<pre>
./check_nest.sh check-smart-status device=/dev/sda
./check_nest.sh check-smart-status device=/dev/sdb
</pre>

<h3>Ignore standby mode</h3>
<pre>./check_nest.sh check-smart-status device=/dev/sda skipPowerModeCheck=true</pre>

<h2>Common Issues</h2>
<ul>
<li><strong>"Device open failed":</strong> Ensure you have root privileges and the device path is correct</li>
<li><strong>"SMART not supported":</strong> Older drives may not support SMART, or it may be disabled in BIOS</li>
<li><strong>"Permission denied":</strong> Run with sudo or add user to disk group</li>
<li><strong>High CRC errors:</strong> Indicates bad SATA cable or connection issues</li>
<li><strong>Reallocated sectors:</strong> Disk is failing - backup data immediately and replace drive</li>
</ul>

<h2>References</h2>
<ul>
<li><a href="https://www.smartmontools.org" target="_blank" rel="noopener">smartmontools official website</a></li>
<li><a href="https://www.smartmontools.org/wiki/Documentation" target="_blank" rel="noopener">smartctl documentation</a></li>
<li><a href="https://en.wikipedia.org/wiki/S.M.A.R.T." target="_blank" rel="noopener">S.M.A.R.T. on Wikipedia</a></li>
<li><a href="https://www.seagate.com/support/knowledge-base/102534/" target="_blank" rel="noopener">Understanding SMART attributes</a></li>
</ul>` as HtmlTemplateString,
	examples: [
		{
			label: 'Full disk health check',
			method: 'GET',
			path: '/plugins/check-smart-status',
			fields: [
				{
					name: 'device',
					label: 'Device Path',
					defaultValue: '/dev/sda',
				},
				{
					name: 'checkType',
					label: 'Check Type',
					defaultValue: 'all',
				},
			],
		},
		{
			label: 'Quick health status',
			method: 'GET',
			path: '/plugins/check-smart-status',
			fields: [
				{
					name: 'device',
					label: 'Device Path',
					defaultValue: '/dev/sda',
				},
				{
					name: 'checkType',
					label: 'Check Type',
					defaultValue: 'health',
				},
			],
		},
		{
			label: 'Check with temperature thresholds',
			method: 'GET',
			path: '/plugins/check-smart-status',
			fields: [
				{
					name: 'device',
					label: 'Device Path',
					defaultValue: '/dev/sda',
				},
				{
					name: 'warningTemp',
					label: 'Warning Temperature (°C)',
					defaultValue: '50',
				},
				{
					name: 'criticalTemp',
					label: 'Critical Temperature (°C)',
					defaultValue: '60',
				},
			],
		},
	],
};

/**
 * Shape of the `child_process.execFileSync` seam used for testing.
 * The command is always executed without a shell, so arguments containing
 * shell metacharacters are passed through to `smartctl` verbatim.
 */
export type ExecFileFn = (
	file: string,
	args: string[],
	options?: ChildProcessExecSyncOptions,
) => string;

export const checkSmartStatus = (params: {
	device: string;
	checkType?: 'all' | 'health' | 'attributes' | 'errors' | 'selftest';
	warningTemp?: number;
	criticalTemp?: number;
	skipPowerModeCheck?: boolean;
	execFile?: ExecFileFn;
}): PluginReturn => {
	const {
		device,
		checkType = 'all',
		warningTemp = 50,
		criticalTemp = 60,
		skipPowerModeCheck = false,
		execFile: injectedExecFile,
	} = params;

	// Validate device path
	if (!device || !device.startsWith('/dev/')) {
		return {
			message: `ERROR: Invalid device path. Must start with /dev/ (e.g., /dev/sda, /dev/nvme0n1)`,
			code: NagiosReturnCodes.UNKNOWN,
			performanceData: [],
		};
	}

	// Validate check type
	const validCheckTypes = ['all', 'health', 'attributes', 'errors', 'selftest'];
	if (!validCheckTypes.includes(checkType)) {
		return {
			message: `ERROR: Invalid check type. Must be one of: ${validCheckTypes.join(', ')}`,
			code: NagiosReturnCodes.UNKNOWN,
			performanceData: [],
		};
	}

	// Validate temperature thresholds
	if (warningTemp >= criticalTemp) {
		return {
			message: `ERROR: Warning temperature (${warningTemp}°C) must be less than critical temperature (${criticalTemp}°C)`,
			code: NagiosReturnCodes.UNKNOWN,
			performanceData: [],
		};
	}

	// Execute smartctl command with JSON output.
	// The device path is passed as a separate argv entry, never interpolated into
	// a shell command string, so it cannot be used to inject shell commands.
	const exec = injectedExecFile || defaultExecFileSync;
	let smartctlJson: unknown;
	let smartctlExitCode: number = 0;

	try {
		const output = exec('smartctl', ['-a', '--json=c', device], {
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			timeout: 30000, // 30 second timeout
		}).toString();
		smartctlJson = JSON.parse(output);
		smartctlExitCode = 0;
	} catch (error) {
		const execError = error as {
			stdout?: string;
			stderr?: string;
			status?: number;
			message?: string;
		};
		const output = (execError.stdout || '') + (execError.stderr || '');
		try {
			smartctlJson = JSON.parse(output);
		} catch {
			return {
				message: `UNKNOWN: Failed to parse smartctl output: ${output.substring(0, 200)}`,
				code: NagiosReturnCodes.UNKNOWN,
				performanceData: [],
			};
		}
		smartctlExitCode = execError.status || 1;
	}

	// Parse JSON response
	const json = smartctlJson as {
		device?: {name: string; type: string; protocol: string};
		model_name?: string;
		serial_number?: string;
		smart_status?: {passed: boolean; nvme?: {value: number}};
		nvme_smart_health_information_log?: {
			critical_warning: number;
			temperature: number;
			available_spare: number;
			percentage_used: number;
			media_errors: number;
			num_err_log_entries: number;
		};
		temperature?: {current: number};
		power_on_time?: {hours: number};
		power_cycle_count?: number;
		ata_smart_attributes?: {
			table: Array<{
				id: number;
				name: string;
				value: number;
				worst: number;
				thresh: number;
				parsed: number;
			}>;
		};
		exit_status?: number;
		messages?: Array<{string: string; severity: string}>;
	};

	const deviceType = json.device?.type || 'unknown';
	const deviceName = json.device?.name || device;
	const modelName = json.model_name || 'Unknown';

	// Determine return code based on JSON data
	let returnCode: NagiosReturnCode = NagiosReturnCodes.OK;
	let message: string;

	// Check SMART status (works for both NVMe and ATA)
	const smartPassed = json.smart_status?.passed ?? true;
	const nvmeStatus = json.smart_status?.nvme?.value ?? 0;

	if (!smartPassed || nvmeStatus !== 0) {
		returnCode = NagiosReturnCodes.CRITICAL;
		message = `${modelName}: CRITICAL: SMART status indicates DISK FAILING`;
	} else {
		returnCode = NagiosReturnCodes.OK;
		message = `${modelName}: OK: Disk health is good`;
	}

	// Extract temperature from JSON (works for both NVMe and ATA)
	let temperature: number | null = null;
	if (json.nvme_smart_health_information_log?.temperature) {
		// NVMe temperature
		temperature = json.nvme_smart_health_information_log.temperature;
	} else if (json.temperature?.current) {
		// ATA/SATA temperature
		temperature = json.temperature.current;
	}

	// Check temperature thresholds
	if (temperature !== null) {
		if (temperature >= criticalTemp) {
			returnCode =
				returnCode < NagiosReturnCodes.CRITICAL
					? NagiosReturnCodes.CRITICAL
					: returnCode;
			message += ` | Temperature ${temperature}°C >= ${criticalTemp}°C (CRITICAL)`;
		} else if (temperature >= warningTemp) {
			returnCode =
				returnCode < NagiosReturnCodes.WARNING
					? NagiosReturnCodes.WARNING
					: returnCode;
			message += ` | Temperature ${temperature}°C >= ${warningTemp}°C (WARNING)`;
		}
	}

	// Check NVMe-specific critical warnings
	if (json.nvme_smart_health_information_log) {
		const nvmeLog = json.nvme_smart_health_information_log;
		const warnings: string[] = [];

		if (nvmeLog.critical_warning & 0x01) {
			warnings.push('temperature too high');
		}
		if (nvmeLog.critical_warning & 0x02) {
			warnings.push('volatile memory backup failed');
		}
		if (nvmeLog.critical_warning & 0x04) {
			warnings.push('available spare below threshold');
		}
		if (nvmeLog.critical_warning & 0x08) {
			warnings.push('read-only mode');
		}
		if (nvmeLog.critical_warning & 0x10) {
			warnings.push('media degraded');
		}

		if (warnings.length > 0 && returnCode < NagiosReturnCodes.CRITICAL) {
			returnCode = NagiosReturnCodes.WARNING;
			message += ` | NVMe warnings: ${warnings.join(', ')}`;
		}

		// Check for media errors
		if (nvmeLog.media_errors > 0 && returnCode < NagiosReturnCodes.CRITICAL) {
			returnCode = NagiosReturnCodes.WARNING;
			message += ` | Media errors: ${nvmeLog.media_errors}`;
		}
	}

	// Check ATA SMART attributes
	if (json.ata_smart_attributes?.table) {
		const attributes = extractSmartAttributesFromJson(
			json.ata_smart_attributes.table,
		);
		const criticalAttributes = checkCriticalAttributes(attributes);
		if (
			criticalAttributes.length > 0 &&
			returnCode < NagiosReturnCodes.CRITICAL
		) {
			returnCode = NagiosReturnCodes.WARNING;
			message += ` | Critical attributes: ${criticalAttributes.join(', ')}`;
		}
	}

	// Build performance data
	const performanceData: Array<{
		label: string;
		value: number | string;
		uom: string;
		warn?: string | null;
		crit?: string | null;
	}> = [];

	// Add temperature to performance data
	if (temperature !== null) {
		performanceData.push({
			label: 'temperature',
			value: temperature,
			uom: 'C',
			warn: warningTemp.toString(),
			crit: criticalTemp.toString(),
		});
	}

	// Add NVMe-specific performance data
	if (json.nvme_smart_health_information_log) {
		const nvmeLog = json.nvme_smart_health_information_log;
		performanceData.push(
			{
				label: 'available_spare',
				value: nvmeLog.available_spare,
				uom: '%',
				warn: '10',
				crit: '5',
			},
			{
				label: 'percentage_used',
				value: nvmeLog.percentage_used,
				uom: '%',
			},
			{
				label: 'media_errors',
				value: nvmeLog.media_errors,
				uom: 'count',
				crit: '1',
			},
			{
				label: 'num_err_log_entries',
				value: nvmeLog.num_err_log_entries,
				uom: 'count',
			},
		);
	}

	// Add ATA SMART attributes to performance data
	if (json.ata_smart_attributes?.table) {
		const attributes = extractSmartAttributesFromJson(
			json.ata_smart_attributes.table,
		);

		if (attributes.reallocatedSectors !== null) {
			performanceData.push({
				label: 'reallocated_sectors',
				value: attributes.reallocatedSectors,
				uom: 'count',
				warn: '1',
				crit: '5',
			});
		}

		if (attributes.pendingSectors !== null) {
			performanceData.push({
				label: 'pending_sectors',
				value: attributes.pendingSectors,
				uom: 'count',
				warn: '1',
				crit: '5',
			});
		}

		if (attributes.uncorrectableErrors !== null) {
			performanceData.push({
				label: 'uncorrectable_errors',
				value: attributes.uncorrectableErrors,
				uom: 'count',
				crit: '1',
			});
		}
	}

	// Add power on hours
	if (json.power_on_time?.hours) {
		performanceData.push({
			label: 'power_on_hours',
			value: json.power_on_time.hours,
			uom: 'hours',
		});
	}

	if (json.power_cycle_count) {
		performanceData.push({
			label: 'power_cycle_count',
			value: json.power_cycle_count,
			uom: 'count',
		});
	}

	return {
		message,
		code: returnCode,
		performanceData,
	};
};

/**
 * Extract SMART attributes from JSON output
 */
function extractSmartAttributesFromJson(
	attributesTable: Array<{
		id: number;
		name: string;
		value: number;
		worst: number;
		thresh: number;
		parsed: number;
	}>,
): {
	reallocatedSectors: number | null;
	pendingSectors: number | null;
	uncorrectableErrors: number | null;
	crcErrors: number | null;
} {
	const attributes: {
		reallocatedSectors: number | null;
		pendingSectors: number | null;
		uncorrectableErrors: number | null;
		crcErrors: number | null;
	} = {
		reallocatedSectors: null,
		pendingSectors: null,
		uncorrectableErrors: null,
		crcErrors: null,
	};

	for (const attr of attributesTable) {
		switch (attr.id) {
			case 5: // Reallocated_Sector_Ct
				attributes.reallocatedSectors = attr.parsed;
				break;
			case 197: // Current_Pending_Sector
				attributes.pendingSectors = attr.parsed;
				break;
			case 198: // Offline_Uncorrectable
				attributes.uncorrectableErrors = attr.parsed;
				break;
			case 199: // UDMA_CRC_Error_Count
				attributes.crcErrors = attr.parsed;
				break;
		}
	}

	return attributes;
}

/**
 * Check for critical attribute values
 */
function checkCriticalAttributes(attributes: {
	reallocatedSectors: number | null;
	pendingSectors: number | null;
	uncorrectableErrors: number | null;
	crcErrors: number | null;
}): string[] {
	const issues: string[] = [];

	if (
		attributes.reallocatedSectors !== null &&
		attributes.reallocatedSectors > 0
	) {
		issues.push(`Reallocated Sectors: ${attributes.reallocatedSectors}`);
	}

	if (attributes.pendingSectors !== null && attributes.pendingSectors > 0) {
		issues.push(`Pending Sectors: ${attributes.pendingSectors}`);
	}

	if (
		attributes.uncorrectableErrors !== null &&
		attributes.uncorrectableErrors > 0
	) {
		issues.push(`Uncorrectable Errors: ${attributes.uncorrectableErrors}`);
	}

	if (attributes.crcErrors !== null && attributes.crcErrors > 0) {
		issues.push(`CRC Errors: ${attributes.crcErrors} (check cable)`);
	}

	return issues;
}
