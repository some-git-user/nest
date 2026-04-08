import fs from 'fs';
import type {PluginMeta} from '../src/types/plugin-meta';

type endoflifeResponseType = {
	result: {
		label: 'Debian';
		name: 'debian';
		releases: {
			codename: string;
			eoesFrom: string;
			eolFrom: string;
			isEoes: boolean;
			isEol: boolean;
			isLts: boolean;
			isMaintained: boolean;
			label: string;
			latest: {
				date: string;
				name: string;
			};
			ltsFrom: string;
			name: string;
			releaseDate: string;
		}[];
	};
};

export const meta = {
	usage: {
		http: '/plugins/check-debian-eol?warningEolRemainingDays=<number>&criticalEolRemainingDays=<number>',
		shell:
			'./check_nest.sh check-debian-eol warningEolRemainingDays=<number> criticalEolRemainingDays=<number>',
	},
	examples: [
		{
			label: 'Check with default thresholds',
			method: 'GET',
			path: '/plugins/check-debian-eol',
			fields: [],
		},
		{
			label: 'Check with custom thresholds',
			method: 'GET',
			path: '/plugins/check-debian-eol?warningEolRemainingDays=90&criticalEolRemainingDays=60',
			fields: [
				{
					name: 'warningEolRemainingDays',
					label: 'Warning threshold (days)',
					defaultValue: '90',
				},
				{
					name: 'criticalEolRemainingDays',
					label: 'Critical threshold (days)',
					defaultValue: '60',
				},
			],
		},
	],
	help: `<h1>check-debian-eol</h1>
<p>Checks the Debian release end-of-life (EOL) date using the
<a href="https://endoflife.date/">endoflife.date</a> API and returns a
Nagios-compatible status based on how many days remain until EOL.</p>

<h2>Parameters</h2>
<table>
  <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
    <tr>
      <td><code>warningEolRemainingDays</code></td>
      <td>number</td><td>60</td>
      <td>Days before EOL to trigger a WARNING state</td>
    </tr>
    <tr>
      <td><code>criticalEolRemainingDays</code></td>
      <td>number</td><td>30</td>
      <td>Days before EOL to trigger a CRITICAL state</td>
    </tr>
  </tbody>
</table>

<h2>Return codes</h2>
<ul>
  <li><strong>OK</strong> – More than <code>warningEolRemainingDays</code> days remain until EOL</li>
  <li><strong>WARNING</strong> – Between <code>criticalEolRemainingDays</code> and <code>warningEolRemainingDays</code> days remain</li>
  <li><strong>CRITICAL</strong> – Fewer than <code>criticalEolRemainingDays</code> days remain, or the release is already EOL</li>
  <li><strong>UNKNOWN</strong> – Could not determine the EOL date (e.g. unable to read <code>/etc/os-release</code> or reach the API)</li>
</ul>

<h2>Requirements</h2>
<p>The server must be running on a Debian host. The check reads
<code>/etc/os-release</code> to determine the current Debian version and queries
<code>https://endoflife.date/api/v1/products/debian/</code> for release data.
Outbound HTTPS to <code>endoflife.date</code> must be allowed.</p>

<h2>Example</h2>
<pre><code>GET /plugins/check-debian-eol?warningEolRemainingDays=90&amp;criticalEolRemainingDays=30</code></pre>
<pre><code>./check_nest.sh check-debian-eol warningEolRemainingDays=90 criticalEolRemainingDays=30</code></pre>`,
} satisfies PluginMeta;

const isEndoflifeResponse = (
	value: unknown,
): value is endoflifeResponseType => {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.result !== 'object' || record.result === null) {
		return false;
	}

	const result = record.result as Record<string, unknown>;
	return Array.isArray(result.releases);
};

// Usage: check_nest.sh check-debian-eol [warningEolRemainingDays=30] [criticalEolRemainingDays=60]
// Check the end of life (EOL) of the Debian OS and return a Nagios compatible string
// The parameters are optional and default to 30 and 60 days respectively
export const checkDebianEol = async (params: {
	warningEolRemainingDays: number;
	criticalEolRemainingDays: number;
}) => {
	const {warningEolRemainingDays = 60, criticalEolRemainingDays = 30} = params;
	const returnObject = {
		message: 'Should not be here',
		code: 3,
	};
	const debianVersionFile = '/etc/os-release';
	const debianVersion = await fs.promises
		.readFile(debianVersionFile, 'utf-8')
		.then((data) => {
			const versionIdMatch = data.match(/VERSION_ID="?([^"]+)"/);
			if (versionIdMatch) {
				return versionIdMatch[1];
			} else {
				throw new Error('VERSION_ID not found in /etc/os-release');
			}
		})
		.catch((error) => {
			console.error(`Error reading debian version file: ${error}`);
			return null;
		});

	const eolUrl = 'https://endoflife.date/api/v1/products/debian/';
	const response = await fetch(eolUrl);
	if (!response.ok) {
		returnObject.message = `Error: ${response.status} ${response.statusText}`;
		return returnObject;
	}
	const jsonResponseUnknown: unknown = await response.json();
	if (!isEndoflifeResponse(jsonResponseUnknown)) {
		returnObject.message = `Error: invalid response format from ${eolUrl}`;
		return returnObject;
	}

	const jsonResponse = jsonResponseUnknown;

	if (
		jsonResponse?.result?.releases &&
		Array.isArray(jsonResponse.result.releases) &&
		jsonResponse.result.releases.length > 0
	) {
		const latestMatchingRelease = jsonResponse.result.releases.find(
			(release) => release.name === debianVersion,
		);

		if (!latestMatchingRelease) {
			returnObject.message = `Debian version "${debianVersion}" does not match any releases from ${eolUrl}`;
			return returnObject;
		}
		if (latestMatchingRelease.isEol) {
			returnObject.message = `Debian version "${debianVersion}" is EOL since ${latestMatchingRelease.eolFrom}`;
			returnObject.code = 2;
		}
		const eolDate = new Date(latestMatchingRelease.eolFrom);
		const today = new Date();
		const daysRemaining = Math.ceil(
			(eolDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
		);

		if (daysRemaining <= criticalEolRemainingDays) {
			returnObject.message = `Debian version "${debianVersion}" is EOL in ${daysRemaining} days`;
			returnObject.code = 2; // CRITICAL
		} else if (daysRemaining <= warningEolRemainingDays) {
			returnObject.message = `Debian version "${debianVersion}" is EOL in ${daysRemaining} days`;
			returnObject.code = 1; // WARNING
		} else if (daysRemaining > warningEolRemainingDays) {
			returnObject.message = `Debian version "${debianVersion}" is not EOL. Remaining days: ${daysRemaining}`;
			returnObject.code = 0; // OK
		}
	}

	return returnObject;
};
