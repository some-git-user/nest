import fs from 'fs';
import {NagiosReturnCodes} from '../src/types/nagios';
import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../src/types/plugin';

export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-reboot-required[?checkReasons=<true|false>]',
		shell: './check_nest.sh check-reboot-required [checkReasons=<true|false>]',
	},
	examples: [
		{
			label: 'Check if reboot is required (basic)',
			method: 'GET',
			path: '/plugins/check-reboot-required',
			fields: [
				{
					name: 'checkReasons',
					label: 'Check reboot reasons',
					defaultValue: 'false',
				},
			],
		},
		{
			label: 'Check reboot with detailed reasons',
			method: 'GET',
			path: '/plugins/check-reboot-required?checkReasons=true',
			fields: [
				{
					name: 'checkReasons',
					label: 'Check reboot reasons',
					defaultValue: 'true',
				},
			],
		},
	],
	help: `<h1>check-reboot-required</h1>
<p>Checks whether a Debian/Ubuntu system requires a reboot after package updates.</p>

<h2>Parameters</h2>
<table>
  <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
    <tr>
      <td><code>checkReasons</code></td>
      <td>boolean</td>
      <td>false</td>
      <td>When true, also check <code>/var/run/reboot-required.reasons.d/</code> and include the reasons in the output</td>
    </tr>
  </tbody>
</table>

<h2>Return codes</h2>
<ul>
  <li><strong>OK</strong> – No reboot required</li>
  <li><strong>WARNING</strong> – Reboot required (basic check only)</li>
  <li><strong>CRITICAL</strong> – Reboot required with detailed reasons (when checkReasons=true)</li>
</ul>

<h2>How it works</h2>
<p>The check looks for the presence of <code>/var/run/reboot-required</code> marker file, which is created by the <code>update-notifier</code> package after system updates (especially kernel updates).</p>

<h2>Reboot reasons</h2>
<p>When <code>checkReasons=true</code>, the plugin also checks the <code>/var/run/reboot-required.reasons.d/</code> directory, which contains files named after the package that requires the reboot (e.g., <code>apt</code>, <code>snapd</code>, <code>libc6</code>).</p>

<h2>Example</h2>
<pre><code>GET /plugins/check-reboot-required?checkReasons=true</code></pre>
<pre><code>./check_nest.sh check-reboot-required checkReasons=true</code></pre>` as HtmlTemplateString,
};

const REBOOT_MARKER_FILE = '/var/run/reboot-required';
const REBOOT_REASONS_DIR = '/var/run/reboot-required.reasons.d';

export const checkRebootRequired = (params: {
	checkReasons?: string;
}): PluginReturn => {
	const checkReasons = params.checkReasons === 'true';

	const returnObject: PluginReturn = {
		message: 'Should not be here',
		code: NagiosReturnCodes.UNKNOWN,
		performanceData: [],
	};

	// Check if the reboot marker file exists
	let rebootRequired = false;
	try {
		rebootRequired = fs.existsSync(REBOOT_MARKER_FILE);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			message: `UNKNOWN: error checking reboot status - ${errorMessage}`,
			code: NagiosReturnCodes.UNKNOWN,
			performanceData: [],
		};
	}

	const reasons: string[] = [];

	// If rebootRequired is false, we already have the result
	if (!rebootRequired) {
		returnObject.message = 'OK: No reboot required';
		returnObject.code = NagiosReturnCodes.OK;
		return returnObject;
	}

	// Reboot is required
	if (checkReasons) {
		// Try to read the reasons directory
		try {
			if (fs.existsSync(REBOOT_REASONS_DIR)) {
				const entries = fs.readdirSync(REBOOT_REASONS_DIR);
				reasons.push(
					...entries.map((entry) => entry.trim()).filter((e) => e.length > 0),
				);
			}
		} catch {
			// If we can't read reasons, continue with just the basic warning
		}
	}

	if (checkReasons && reasons.length > 0) {
		returnObject.message = `CRITICAL: Reboot required. Updates from: ${reasons.join(', ')}`;
		returnObject.code = NagiosReturnCodes.CRITICAL;
		returnObject.performanceData?.push({
			label: 'reboot_required',
			value: 1,
			uom: '',
		});
		for (const reason of reasons) {
			returnObject.performanceData?.push({
				label: `reason_${reason.replace(/[^a-zA-Z0-9_]/g, '_')}`,
				value: 1,
				uom: '',
			});
		}
	} else {
		returnObject.message = 'WARNING: Reboot required';
		returnObject.code = NagiosReturnCodes.WARNING;
		returnObject.performanceData?.push({
			label: 'reboot_required',
			value: 1,
			uom: '',
		});
	}

	return returnObject;
};
