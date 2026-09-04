import type {NagiosReturnCode} from '../src/types/nagios';
import type {HtmlTemplateString, PluginMeta} from '../src/types/plugin';
import {PluginReturn} from '../src/types/plugin';

/**
 * Dmesg Error Checker Plugin
 *
 * Searches the kernel ring buffer (dmesg) for error conditions.
 *
 * Based on Linux kernel syslog(2) log levels:
 * - KERN_EMERG (0): System is unusable
 * - KERN_ALERT (1): Action must be taken immediately
 * - KERN_CRIT (2): Critical conditions
 * - KERN_ERR (3): Error conditions
 * - KERN_WARNING (4): Warning conditions
 *
 * Reference: https://man7.org/linux/man-pages/man2/syslog.2.html
 */
export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-dmesg-errors?level=<err|warn|crit|alert|emerg>&pattern=<regex>&timeRange=<seconds>',
		shell:
			'./check_nest.sh check-dmesg-errors level=<err|warn|crit|alert|emerg> pattern=<regex> timeRange=<seconds>',
	},
	help: `<h1>Dmesg Error Checker</h1>
<p>This plugin searches the Linux kernel ring buffer (dmesg) for error conditions and reports them in Nagios-compatible format.</p>

<h2>Kernel Log Levels</h2>
<p>Based on the official Linux kernel <a href="https://man7.org/linux/man-pages/man2/syslog.2.html" target="_blank" rel="noopener">syslog(2)</a> documentation:</p>
<table>
<tr><th>Level</th><th>Constant</th><th>Meaning</th></tr>
<tr><td>0</td><td>KERN_EMERG</td><td>System is unusable</td></tr>
<tr><td>1</td><td>KERN_ALERT</td><td>Action must be taken immediately</td></tr>
<tr><td>2</td><td>KERN_CRIT</td><td>Critical conditions</td></tr>
<tr><td>3</td><td>KERN_ERR</td><td>Error conditions</td></tr>
<tr><td>4</td><td>KERN_WARNING</td><td>Warning conditions</td></tr>
</table>

<h2>Parameters</h2>
<table>
<tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
<tr><td><code>level</code></td><td>string</td><td><code>err</code></td><td>Minimum log level to check: <code>emerg</code>, <code>alert</code>, <code>crit</code>, <code>err</code>, <code>warn</code></td></tr>
<tr><td><code>pattern</code></td><td>string (regex)</td><td>-</td><td>Regular expression pattern to filter messages (case-insensitive)</td></tr>
<tr><td><code>timeRange</code></td><td>number</td><td><code>3600</code></td><td>Time range in seconds to check (default: 1 hour)</td></tr>
<tr><td><code>ignorePatterns</code></td><td>string (regex)</td><td>-</td><td>Regular expression pattern to exclude messages from results</td></tr>
</table>

<h2>Return Codes</h2>
<table>
<tr><th>Code</th><th>Status</th><th>Description</th></tr>
<tr><td>0</td><td>OK</td><td>No errors found</td></tr>
<tr><td>1</td><td>WARNING</td><td>Error-level messages found</td></tr>
<tr><td>2</td><td>CRITICAL</td><td>Emergency, alert, or critical messages found</td></tr>
<tr><td>3</td><td>UNKNOWN</td><td>Plugin execution error</td></tr>
</table>

<h2>Common Error Patterns Detected</h2>
<ul>
<li>I/O errors (<code>I/O error</code>)</li>
<li>Out of Memory killer (<code>OOM killer</code>, <code>Out of memory</code>)</li>
<li>Kernel panics (<code>kernel panic</code>, <code>panic</code>)</li>
<li>Segmentation faults (<code>segfault</code>, <code>Oops</code>)</li>
<li>Fatal errors (<code>fatal</code>, <code>corruption</code>)</li>
</ul>

<h2>Examples</h2>
<h3>Check for recent errors (last hour)</h3>
<pre>./check_nest.sh check-dmesg-errors level=err timeRange=3600</pre>

<h3>Check for I/O errors specifically</h3>
<pre>./check_nest.sh check-dmesg-errors level=err pattern="I/O error|disk|storage" timeRange=86400</pre>

<h3>Check all severity levels</h3>
<pre>./check_nest.sh check-dmesg-errors level=warn timeRange=3600</pre>

<h3>Exclude known false positives</h3>
<pre>./check_nest.sh check-dmesg-errors level=err pattern="error" ignorePatterns="test|known_issue" timeRange=3600</pre>

<h2>Permissions</h2>
<p>The plugin requires read access to the kernel ring buffer. If you encounter "permission denied" errors:</p>
<ol>
<li>Run as root: <code>sudo ./check_nest.sh check-dmesg-errors</code></li>
<li>Or adjust kernel settings: <code>sudo sysctl -w kernel.dmesg_restrict=0</code></li>
</ol>

<h2>References</h2>
<ul>
<li><a href="https://man7.org/linux/man-pages/man1/dmesg.1.html" target="_blank" rel="noopener">dmesg(1) - Linux manual page</a></li>
<li><a href="https://man7.org/linux/man-pages/man2/syslog.2.html" target="_blank" rel="noopener">syslog(2) - Linux manual page</a></li>
<li><a href="https://www.kernel.org/doc/html/latest/core-api/printk-formats.html" target="_blank" rel="noopener">Kernel printk formats</a></li>
</ul>` as HtmlTemplateString,
	examples: [
		{
			label: 'Check for error-level messages',
			method: 'GET',
			path: '/plugins/check-dmesg-errors',
			fields: [
				{
					name: 'level',
					label: 'Log Level',
					defaultValue: 'err',
				},
				{
					name: 'timeRange',
					label: 'Time Range (seconds)',
					defaultValue: '3600',
				},
			],
		},
		{
			label: 'Check for specific pattern',
			method: 'GET',
			path: '/plugins/check-dmesg-errors',
			fields: [
				{
					name: 'pattern',
					label: 'Pattern',
					// No literal space: a preset value must survive the config-file
					// grammar (no whitespace) and encodeURIComponent when the preset is
					// executed, so '.' is used to match the space in "I/O error".
					defaultValue: 'I/O.error|OOM|panic',
				},
				{
					name: 'level',
					label: 'Log Level',
					defaultValue: 'err',
				},
			],
		},
	],
};

interface ExecSyncOptions {
	encoding?: BufferEncoding;
	timeout?: number;
	maxBuffer?: number;
	killing?: boolean;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	uid?: number;
	gid?: number;
}

/**
 * Shape of the `child_process.execFileSync` seam used for testing.
 * The command is always executed without a shell, so no argument can be
 * interpreted as shell syntax.
 */
export type ExecFileFn = (
	file: string,
	args: string[],
	options?: ExecSyncOptions,
) => string;

export const checkDmesgErrors = async (params: {
	level?: 'emerg' | 'alert' | 'crit' | 'err' | 'warn';
	pattern?: string;
	timeRange?: number;
	ignorePatterns?: string;
	execSync?: ExecFileFn;
}): Promise<PluginReturn> => {
	const {
		level = 'err',
		pattern,
		timeRange = 3600,
		ignorePatterns,
		execSync: injectedExecSync,
	} = params;

	// Validate regex patterns before any dmesg execution
	if (pattern) {
		try {
			new RegExp(pattern, 'i');
		} catch {
			return {
				message: `ERROR: Invalid regex pattern: ${pattern}`,
				code: 3,
				performanceData: [
					{
						label: 'total_messages',
						value: 0,
						uom: 'count',
					},
					{
						label: 'emerg_count',
						value: 0,
						uom: 'count',
					},
					{
						label: 'alert_count',
						value: 0,
						uom: 'count',
					},
					{
						label: 'crit_count',
						value: 0,
						uom: 'count',
					},
					{
						label: 'err_count',
						value: 0,
						uom: 'count',
					},
					{
						label: 'warn_count',
						value: 0,
						uom: 'count',
					},
				],
			};
		}
	}

	if (ignorePatterns) {
		try {
			new RegExp(ignorePatterns, 'i');
		} catch {
			return {
				message: `ERROR: Invalid ignore pattern: ${ignorePatterns}`,
				code: 3,
				performanceData: [
					{
						label: 'total_messages',
						value: 0,
						uom: 'count',
					},
					{
						label: 'emerg_count',
						value: 0,
						uom: 'count',
					},
					{
						label: 'alert_count',
						value: 0,
						uom: 'count',
					},
					{
						label: 'crit_count',
						value: 0,
						uom: 'count',
					},
					{
						label: 'err_count',
						value: 0,
						uom: 'count',
					},
					{
						label: 'warn_count',
						value: 0,
						uom: 'count',
					},
				],
			};
		}
	}

	// Map log levels to their numeric values (from syslog(2))
	const levelMap: Record<string, number> = {
		emerg: 0,
		alert: 1,
		crit: 2,
		err: 3,
		warn: 4,
	};

	const selectedLevel = levelMap[level] ?? 3; // Default to ERR (3)

	// Build dmesg command based on level filtering
	// Using --level with + to include all higher severity levels
	// Reference: https://man7.org/linux/man-pages/man1/dmesg.1.html
	const levelFlag = getLevelFlag(selectedLevel);

	// Every option is a separate argv entry: nothing is ever interpolated into a
	// shell command string, so user input cannot inject shell commands.
	const dmesgArgs = [`--level=${levelFlag}+`, '--time-format=iso', '--nopager'];

	// Add time filtering if specified
	if (timeRange > 0) {
		dmesgArgs.push('--since', `${timeRange} seconds ago`);
	}

	// Execute dmesg command
	let dmesgOutput: string = '';
	let dmesgExitCode: number = 1;

	try {
		// Use injected execFileSync for testing, otherwise use dynamic import
		const exec =
			injectedExecSync || (await import('child_process')).execFileSync;
		dmesgOutput = exec('dmesg', dmesgArgs, {
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
		}) as string;
		dmesgExitCode = 0;
	} catch (error) {
		const execError = error as {stdout?: string; status?: number};
		dmesgOutput = execError.stdout || '';
		dmesgExitCode = execError.status || 1;
	}

	// Check for permission issues
	if (dmesgExitCode !== 0 || dmesgOutput.includes('dmesg: permission denied')) {
		return {
			message: `WARNING: Cannot read kernel ring buffer. Run as root or check dmesg_restrict: ${dmesgOutput.trim()}`,
			code: 1,
			performanceData: [
				{
					label: 'total_messages',
					value: 0,
					uom: 'count',
				},
				{
					label: 'emerg_count',
					value: 0,
					uom: 'count',
				},
				{
					label: 'alert_count',
					value: 0,
					uom: 'count',
				},
				{
					label: 'crit_count',
					value: 0,
					uom: 'count',
				},
				{
					label: 'err_count',
					value: 0,
					uom: 'count',
				},
				{
					label: 'warn_count',
					value: 0,
					uom: 'count',
				},
			],
		};
	}

	// Filter by custom pattern if provided
	let filteredMessages = dmesgOutput.split('\n').filter((line) => line.trim());

	if (pattern) {
		const patternRegex = new RegExp(pattern, 'i');
		filteredMessages = filteredMessages.filter((line) =>
			patternRegex.test(line),
		);
	}

	// Filter out ignored patterns if provided
	if (ignorePatterns) {
		const ignoreRegex = new RegExp(ignorePatterns, 'i');
		filteredMessages = filteredMessages.filter(
			(line) => !ignoreRegex.test(line),
		);
	}

	// Analyze messages for severity
	const severityCounts = analyzeSeverity(filteredMessages);
	const criticalMessages = extractCriticalIssues(filteredMessages);

	// Determine return code based on findings
	let returnCode: NagiosReturnCode = 0;
	let message: string;

	if (severityCounts.emerg > 0) {
		returnCode = 2; // CRITICAL
		message = `CRITICAL: ${severityCounts.emerg} emergency message(s) found in kernel ring buffer`;
	} else if (severityCounts.alert > 0) {
		returnCode = 2; // CRITICAL
		message = `CRITICAL: ${severityCounts.alert} alert message(s) found in kernel ring buffer`;
	} else if (severityCounts.crit > 0) {
		returnCode = 2; // CRITICAL
		message = `CRITICAL: ${severityCounts.crit} critical message(s) found in kernel ring buffer`;
	} else if (severityCounts.err > 0) {
		returnCode = 1; // WARNING
		message = `WARNING: ${severityCounts.err} error message(s) found in kernel ring buffer`;
	} else if (severityCounts.warn > 0) {
		returnCode = 0; // OK (warnings are informational)
		message = `OK: ${severityCounts.warn} warning message(s) found (no errors)`;
	} else {
		returnCode = 0; // OK
		message = `OK: No kernel errors found in the last ${timeRange} seconds`;
	}

	// Add summary to message if there are issues
	if (returnCode > 0 && criticalMessages.length > 0) {
		message += ` | Top issues: ${criticalMessages.slice(0, 3).join('; ')}`;
	}

	// Build performance data
	const performanceData = [
		{
			label: 'total_messages',
			value: filteredMessages.length,
			uom: 'count',
		},
		{
			label: 'emerg_count',
			value: severityCounts.emerg,
			uom: 'count',
		},
		{
			label: 'alert_count',
			value: severityCounts.alert,
			uom: 'count',
		},
		{
			label: 'crit_count',
			value: severityCounts.crit,
			uom: 'count',
		},
		{
			label: 'err_count',
			value: severityCounts.err,
			uom: 'count',
			warn: '1',
			crit: '5',
		},
		{
			label: 'warn_count',
			value: severityCounts.warn,
			uom: 'count',
		},
	];

	return {
		message,
		code: returnCode,
		performanceData,
	};
};

/**
 * Get the dmesg level flag based on numeric severity
 * Reference: https://man7.org/linux/man-pages/man1/dmesg.1.html
 */
export function getLevelFlag(level: number): string {
	const flags = [
		'emerg',
		'alert',
		'crit',
		'err',
		'warn',
		'notice',
		'info',
		'debug',
	];
	return flags[level] || 'err';
}

/**
 * Analyze messages for severity levels
 * Based on kernel log level prefixes from syslog(2)
 */
function analyzeSeverity(messages: string[]): {
	emerg: number;
	alert: number;
	crit: number;
	err: number;
	warn: number;
} {
	const counts = {
		emerg: 0,
		alert: 0,
		crit: 0,
		err: 0,
		warn: 0,
	};

	// Common patterns for kernel error messages
	// These are based on actual kernel log formats
	const severityPatterns = {
		emerg: [
			/\bemerg\b/i,
			/\bpanic\b/i,
			/\bkernel panic\b/i,
			/\bunrecoverable\b/i,
		],
		alert: [/\balert\b/i, /\baction required\b/i, /\bimmediate action\b/i],
		crit: [/\bcrit\b/i, /\bcritical\b/i, /\bfatal\b/i, /\bcorruption\b/i],
		err: [
			/\berr\b/i,
			/\berror\b/i,
			/\bfailed\b/i,
			/\bfailure\b/i,
			/\bI\/O error\b/i,
			/\bOOM killer\b/i,
			/\bOut of memory\b/i,
			/\bOops\b/i,
			/\bsegfault\b/i,
		],
		warn: [/\bwarn\b/i, /\bwarning\b/i, /\bdeprecated\b/i, /\bobsolete\b/i],
	};

	for (const message of messages) {
		if (severityPatterns.emerg.some((p) => p.test(message))) {
			counts.emerg++;
		} else if (severityPatterns.alert.some((p) => p.test(message))) {
			counts.alert++;
		} else if (severityPatterns.crit.some((p) => p.test(message))) {
			counts.crit++;
		} else if (severityPatterns.err.some((p) => p.test(message))) {
			counts.err++;
		} else if (severityPatterns.warn.some((p) => p.test(message))) {
			counts.warn++;
		}
	}

	return counts;
}

/**
 * Extract critical issues from messages
 */
function extractCriticalIssues(messages: string[]): string[] {
	const criticalPatterns = [
		/I\/O error/,
		/OOM killer/,
		/Out of memory/,
		/kernel panic/,
		/Oops/,
		/segfault/,
		/fatal/,
		/corruption/,
		/failed to/,
		/cannot/,
		/unable to/,
	];

	return messages
		.filter((message) => criticalPatterns.some((p) => p.test(message)))
		.map((message) => message.substring(0, 80)) // Truncate for readability
		.slice(0, 10);
}
