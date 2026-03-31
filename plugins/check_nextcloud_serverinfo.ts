type NextcloudServerInfoParams = {
	baseUrl?: string;
	token?: string;
	username?: string;
	password?: string;
	warningCpuLoad1m?: string;
	criticalCpuLoad1m?: string;
	warningFreeSpaceGiB?: string;
	criticalFreeSpaceGiB?: string;
	skipApps?: string;
	skipUpdate?: string;
};

type NextcloudServerInfoResponse = {
	ocs: {
		meta: {
			status?: string;
			statuscode?: number | string;
			message?: string;
		};
		data: {
			nextcloud?: {
				system?: {
					version?: string;
					debug?: string;
					freespace?: number | string;
					cpuload?: Array<number | string>;
					apps?: {
						num_updates_available?: number | string;
					};
					update?: {
						available?: unknown;
					};
				};
			};
			activeUsers?: {
				last5minutes?: number | string;
				last1hour?: number | string;
				last24hours?: number | string;
			};
		};
	};
};

type PerformanceDataEntry = {
	label: string;
	value: string;
	uom: string;
	warn?: string;
	crit?: string;
	min?: string;
};

const STATUS_OK = 0;
const STATUS_WARNING = 1;
const STATUS_CRITICAL = 2;
const STATUS_UNKNOWN = 3;

export const meta = {
	usage: {
		http: '/plugins/check-nextcloud-serverinfo?baseUrl=<nextcloud-base-url>&token=<serverinfo-token>&warningCpuLoad1m=<number>&criticalCpuLoad1m=<number>&warningFreeSpaceGiB=<number>&criticalFreeSpaceGiB=<number>&skipApps=<true|false>&skipUpdate=<true|false>',
		shell:
			'./check_nest.sh check-nextcloud-serverinfo baseUrl=<nextcloud-base-url> token=<serverinfo-token> warningCpuLoad1m=<number> criticalCpuLoad1m=<number> warningFreeSpaceGiB=<number> criticalFreeSpaceGiB=<number> skipApps=<true|false> skipUpdate=<true|false>',
	},
	help: `<h1>check-nextcloud-serverinfo</h1>
<p>Monitors a Nextcloud instance through the official <a href="https://github.com/nextcloud/serverinfo">serverinfo</a> endpoint and returns a Nagios-compatible status.</p>

<h2>What This Plugin Checks</h2>
<ul>
  <li>Whether the Nextcloud serverinfo endpoint is reachable and authorized</li>
  <li>1-minute CPU load against warning and critical thresholds</li>
  <li>Free disk space against warning and critical thresholds</li>
  <li>Active user counters for the last 5 minutes, 1 hour, and 24 hours</li>
  <li>Optional app update and core update signals when <code>skipApps=false</code> and <code>skipUpdate=false</code></li>
</ul>

<h2>Step-by-Step Setup</h2>
<ol>
  <li>
    <strong>Enable the Nextcloud serverinfo app</strong><br>
    The official app ships with standard Nextcloud packages. If it is disabled, enable it on the Nextcloud server:
    <pre><code>sudo -u www-data php occ app:enable serverinfo</code></pre>
  </li>
  <li>
    <strong>Create a monitoring token in Nextcloud</strong><br>
    The upstream app supports token-based access through the <code>NC-Token</code> header:
    <pre><code>sudo -u www-data php occ config:app:set serverinfo token --value "replace-with-a-long-random-token"</code></pre>
    This is the cleanest option for external monitoring. The endpoint also works for authenticated Nextcloud admins, but a dedicated token is better for automation.
  </li>
  <li>
    <strong>Verify the endpoint directly from the Nest host</strong><br>
    Official endpoint path:
    <pre><code>https://&lt;nextcloud-fqdn&gt;/ocs/v2.php/apps/serverinfo/api/v1/info</code></pre>
    Recommended quick test:
    <pre><code>curl -sS \
  -H 'NC-Token: replace-with-a-long-random-token' \
  'https://cloud.example.com/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&amp;skipApps=true&amp;skipUpdate=true'</code></pre>
    A healthy reply contains an <code>ocs.meta.status</code> of <code>ok</code> and JSON data for system, storage, shares, server, and active users.
  </li>
  <li>
    <strong>Install this plugin into Nest's plugin directory</strong><br>
    Place <code>check_nextcloud_serverinfo.ts</code> in your configured <code>PLUGINS_DIR</code>.
  </li>
  <li>
    <strong>Approve the plugin hash for production</strong><br>
    Nest will not load new plugins in production until they are whitelisted. Generate the SHA-256 hash and add it to <code>plugin-whitelist.txt</code>:
    <pre><code>sha256sum /opt/nest-plugins/check_nextcloud_serverinfo.ts
echo 'check_nextcloud_serverinfo.ts &lt;sha256&gt;' &gt;&gt; /opt/nest-plugins/plugin-whitelist.txt</code></pre>
    Make sure the plugin file owner matches the Nest service user and that neither the plugin file nor the whitelist file is writable by group or others.
  </li>
  <li>
    <strong>Restart Nest and open this help page again if needed</strong><br>
    After the whitelist entry is in place, restart the Nest service so the route is registered.
  </li>
  <li>
    <strong>Call the plugin through Nest</strong><br>
    HTTP example:
    <pre><code>GET /plugins/check-nextcloud-serverinfo?baseUrl=https://cloud.example.com&amp;token=replace-with-a-long-random-token</code></pre>
    Shell example:
    <pre><code>./check_nest.sh check-nextcloud-serverinfo \
  baseUrl=https://cloud.example.com \
  token=replace-with-a-long-random-token</code></pre>
  </li>
</ol>

<h2>Parameters</h2>
<table>
  <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>baseUrl</code></td><td>string</td><td>required</td><td>Base URL of your Nextcloud instance, for example <code>https://cloud.example.com</code> or <code>https://cloud.example.com/nextcloud</code></td></tr>
    <tr><td><code>token</code></td><td>string</td><td>optional</td><td>Official <code>NC-Token</code> value configured in Nextcloud serverinfo</td></tr>
    <tr><td><code>username</code></td><td>string</td><td>optional</td><td>Fallback admin username when you prefer HTTP Basic authentication</td></tr>
    <tr><td><code>password</code></td><td>string</td><td>optional</td><td>Fallback admin password or app password for HTTP Basic authentication</td></tr>
    <tr><td><code>warningCpuLoad1m</code></td><td>number</td><td>4</td><td>WARNING when the 1-minute CPU load is greater than or equal to this threshold</td></tr>
    <tr><td><code>criticalCpuLoad1m</code></td><td>number</td><td>8</td><td>CRITICAL when the 1-minute CPU load is greater than or equal to this threshold</td></tr>
    <tr><td><code>warningFreeSpaceGiB</code></td><td>number</td><td>20</td><td>WARNING when free disk space is less than or equal to this threshold</td></tr>
    <tr><td><code>criticalFreeSpaceGiB</code></td><td>number</td><td>10</td><td>CRITICAL when free disk space is less than or equal to this threshold</td></tr>
    <tr><td><code>skipApps</code></td><td>boolean</td><td>true</td><td>Skip the app update section. The upstream project notes that enabling app updates triggers an external request to the Nextcloud app store.</td></tr>
    <tr><td><code>skipUpdate</code></td><td>boolean</td><td>true</td><td>Skip the core update section.</td></tr>
  </tbody>
</table>

<h2>Return Codes</h2>
<ul>
  <li><strong>OK</strong> – Endpoint reachable and all configured thresholds are healthy</li>
  <li><strong>WARNING</strong> – CPU load, free space, or optional update checks crossed warning thresholds</li>
  <li><strong>CRITICAL</strong> – CPU load or free space crossed critical thresholds</li>
  <li><strong>UNKNOWN</strong> – Request failed, authorization failed, or the response payload was not usable</li>
</ul>`,
};

const usageMessage = (): string =>
	`Usage: ${meta.usage.http}. Provide baseUrl plus either token or username/password.`;

const parseBoolean = (
	value: string | undefined,
	defaultValue: boolean,
): boolean => {
	if (!value) {
		return defaultValue;
	}

	const normalized = value.trim().toLowerCase();
	if (['1', 'true', 'yes', 'on'].includes(normalized)) {
		return true;
	}

	if (['0', 'false', 'no', 'off'].includes(normalized)) {
		return false;
	}

	return defaultValue;
};

const parseNumber = (
	value: string | undefined,
	defaultValue: number,
): number => {
	if (!value) {
		return defaultValue;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : defaultValue;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isNextcloudServerInfoResponse = (
	value: unknown,
): value is NextcloudServerInfoResponse => {
	if (!isRecord(value) || !isRecord(value.ocs)) {
		return false;
	}

	const ocs = value.ocs;
	return isRecord(ocs.meta) && isRecord(ocs.data);
};

const readNumber = (value: unknown): number | undefined => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return undefined;
};

const readString = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const hasUpdateValue = (value: unknown): boolean => {
	if (value === null || value === undefined) {
		return false;
	}

	if (Array.isArray(value)) {
		return value.length > 0;
	}

	if (typeof value === 'string') {
		return value.trim().length > 0;
	}

	if (typeof value === 'object') {
		return Object.keys(value as Record<string, unknown>).length > 0;
	}

	return Boolean(value);
};

const formatGiB = (value: number): string => value.toFixed(1);

const formatLoad = (value: number): string => value.toFixed(2);

const buildEndpointUrl = (
	baseUrl: string,
	skipApps: boolean,
	skipUpdate: boolean,
): string => {
	const normalizedBaseUrl = baseUrl.trim();
	if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
		throw new Error('baseUrl must start with http:// or https://');
	}

	const baseUrlWithSlash = normalizedBaseUrl.endsWith('/')
		? normalizedBaseUrl
		: `${normalizedBaseUrl}/`;
	const url = new URL(
		'ocs/v2.php/apps/serverinfo/api/v1/info',
		baseUrlWithSlash,
	);
	url.searchParams.set('format', 'json');
	url.searchParams.set('skipApps', String(skipApps));
	url.searchParams.set('skipUpdate', String(skipUpdate));
	return url.toString();
};

const buildHeaders = (
	params: NextcloudServerInfoParams,
): Record<string, string> => {
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'OCS-APIRequest': 'true',
	};

	if (params.token) {
		headers['NC-Token'] = params.token;
		return headers;
	}

	if (params.username && params.password) {
		headers.Authorization = `Basic ${Buffer.from(
			`${params.username}:${params.password}`,
			'utf8',
		).toString('base64')}`;
	}

	return headers;
};

const getStatusText = (code: number): string => {
	if (code === STATUS_OK) {
		return 'OK';
	}

	if (code === STATUS_WARNING) {
		return 'WARNING';
	}

	if (code === STATUS_CRITICAL) {
		return 'CRITICAL';
	}

	return 'UNKNOWN';
};

export const checkNextcloudServerinfo = async (
	params: NextcloudServerInfoParams,
) => {
	if (!params.baseUrl) {
		return {
			message: usageMessage(),
			code: STATUS_UNKNOWN,
		};
	}

	if (!params.token && !(params.username && params.password)) {
		return {
			message: usageMessage(),
			code: STATUS_UNKNOWN,
		};
	}

	if (
		(params.username && !params.password) ||
		(!params.username && params.password)
	) {
		return {
			message: usageMessage(),
			code: STATUS_UNKNOWN,
		};
	}

	const warningCpuLoad1m = parseNumber(params.warningCpuLoad1m, 4);
	const criticalCpuLoad1m = parseNumber(params.criticalCpuLoad1m, 8);
	const warningFreeSpaceGiB = parseNumber(params.warningFreeSpaceGiB, 20);
	const criticalFreeSpaceGiB = parseNumber(params.criticalFreeSpaceGiB, 10);

	if (criticalCpuLoad1m < warningCpuLoad1m) {
		return {
			message:
				'criticalCpuLoad1m must be greater than or equal to warningCpuLoad1m.',
			code: STATUS_UNKNOWN,
		};
	}

	if (criticalFreeSpaceGiB > warningFreeSpaceGiB) {
		return {
			message:
				'criticalFreeSpaceGiB must be less than or equal to warningFreeSpaceGiB.',
			code: STATUS_UNKNOWN,
		};
	}

	const skipApps = parseBoolean(params.skipApps, true);
	const skipUpdate = parseBoolean(params.skipUpdate, true);

	let endpointUrl = '';
	try {
		endpointUrl = buildEndpointUrl(params.baseUrl, skipApps, skipUpdate);
	} catch (error) {
		return {
			message: `Nextcloud serverinfo configuration error: ${String(error)}`,
			code: STATUS_UNKNOWN,
		};
	}

	try {
		const response = await fetch(endpointUrl, {
			headers: buildHeaders(params),
		});

		if (!response.ok) {
			return {
				message: `Nextcloud serverinfo request failed: ${response.status} ${response.statusText}.`,
				code: STATUS_UNKNOWN,
			};
		}

		const payloadUnknown: unknown = await response.json();
		if (!isNextcloudServerInfoResponse(payloadUnknown)) {
			return {
				message: 'Nextcloud serverinfo returned an unexpected payload shape.',
				code: STATUS_UNKNOWN,
			};
		}

		const metaRecord = payloadUnknown.ocs.meta;
		const statusText = readString(metaRecord.status);
		const statusCode = readNumber(metaRecord.statuscode);
		if (statusText !== 'ok' || statusCode !== 200) {
			return {
				message: `Nextcloud serverinfo returned ${statusText ?? 'unknown'} (${statusCode ?? 'unknown'}): ${readString(metaRecord.message) ?? 'no message'}.`,
				code: STATUS_UNKNOWN,
			};
		}

		const dataRecord = payloadUnknown.ocs.data;
		const nextcloudRecord = isRecord(dataRecord.nextcloud)
			? dataRecord.nextcloud
			: undefined;
		const systemRecord =
			nextcloudRecord && isRecord(nextcloudRecord.system)
				? nextcloudRecord.system
				: undefined;
		const activeUsersRecord = isRecord(dataRecord.activeUsers)
			? dataRecord.activeUsers
			: undefined;

		const version = readString(systemRecord?.version) ?? 'unknown';
		const freeSpaceBytes = readNumber(systemRecord?.freespace);
		const freeSpaceGiB =
			typeof freeSpaceBytes === 'number'
				? freeSpaceBytes / (1024 * 1024 * 1024)
				: undefined;
		const cpuLoadEntries = Array.isArray(systemRecord?.cpuload)
			? systemRecord.cpuload
			: [];
		const cpuLoad1m = readNumber(cpuLoadEntries[0]);
		const activeUsers5m = readNumber(activeUsersRecord?.last5minutes);
		const activeUsers1h = readNumber(activeUsersRecord?.last1hour);
		const activeUsers24h = readNumber(activeUsersRecord?.last24hours);
		const appsRecord = isRecord(systemRecord?.apps)
			? systemRecord.apps
			: undefined;
		const appUpdates = readNumber(appsRecord?.num_updates_available) ?? 0;
		const updateRecord = isRecord(systemRecord?.update)
			? systemRecord.update
			: undefined;
		const updateAvailable = hasUpdateValue(updateRecord?.available);

		let code = STATUS_OK;
		const findings: string[] = [];
		const bumpCode = (candidate: number, detail: string) => {
			code = Math.max(code, candidate);
			findings.push(detail);
		};

		if (typeof freeSpaceGiB === 'number') {
			if (freeSpaceGiB <= criticalFreeSpaceGiB) {
				bumpCode(
					STATUS_CRITICAL,
					`free space ${formatGiB(freeSpaceGiB)} GiB is at or below critical threshold ${criticalFreeSpaceGiB} GiB`,
				);
			} else if (freeSpaceGiB <= warningFreeSpaceGiB) {
				bumpCode(
					STATUS_WARNING,
					`free space ${formatGiB(freeSpaceGiB)} GiB is at or below warning threshold ${warningFreeSpaceGiB} GiB`,
				);
			}
		}

		if (typeof cpuLoad1m === 'number') {
			if (cpuLoad1m >= criticalCpuLoad1m) {
				bumpCode(
					STATUS_CRITICAL,
					`cpu load 1m ${formatLoad(cpuLoad1m)} is at or above critical threshold ${criticalCpuLoad1m}`,
				);
			} else if (cpuLoad1m >= warningCpuLoad1m) {
				bumpCode(
					STATUS_WARNING,
					`cpu load 1m ${formatLoad(cpuLoad1m)} is at or above warning threshold ${warningCpuLoad1m}`,
				);
			}
		}

		if (!skipApps && appUpdates > 0) {
			bumpCode(STATUS_WARNING, `app updates available: ${appUpdates}`);
		}

		if (!skipUpdate && updateAvailable) {
			bumpCode(STATUS_WARNING, 'core update available');
		}

		const summary: string[] = [];
		if (typeof freeSpaceGiB === 'number') {
			summary.push(`free ${formatGiB(freeSpaceGiB)} GiB`);
		}
		if (typeof cpuLoad1m === 'number') {
			summary.push(`cpu1 ${formatLoad(cpuLoad1m)}`);
		}
		if (typeof activeUsers24h === 'number') {
			summary.push(`active24h ${activeUsers24h}`);
		}
		if (readString(systemRecord?.debug) === 'yes') {
			summary.push('debug on');
		}

		const performanceData: PerformanceDataEntry[] = [];
		if (typeof freeSpaceGiB === 'number') {
			performanceData.push({
				label: 'free_space_gib',
				value: freeSpaceGiB.toFixed(2),
				uom: 'GB',
				min: '0',
			});
		}
		if (typeof cpuLoad1m === 'number') {
			performanceData.push({
				label: 'cpu_load_1m',
				value: cpuLoad1m.toFixed(2),
				uom: '',
				warn: String(warningCpuLoad1m),
				crit: String(criticalCpuLoad1m),
				min: '0',
			});
		}
		if (typeof activeUsers5m === 'number') {
			performanceData.push({
				label: 'active_users_5m',
				value: String(activeUsers5m),
				uom: 'c',
				min: '0',
			});
		}
		if (typeof activeUsers1h === 'number') {
			performanceData.push({
				label: 'active_users_1h',
				value: String(activeUsers1h),
				uom: 'c',
				min: '0',
			});
		}
		if (typeof activeUsers24h === 'number') {
			performanceData.push({
				label: 'active_users_24h',
				value: String(activeUsers24h),
				uom: 'c',
				min: '0',
			});
		}
		if (!skipApps) {
			performanceData.push({
				label: 'app_updates',
				value: String(appUpdates),
				uom: 'c',
				min: '0',
			});
		}
		if (!skipUpdate) {
			performanceData.push({
				label: 'core_update_available',
				value: updateAvailable ? '1' : '0',
				uom: 'c',
				min: '0',
			});
		}

		const message =
			findings.length > 0
				? `Nextcloud ${version} ${getStatusText(code)} - ${findings.join('; ')}`
				: `Nextcloud ${version} ${getStatusText(code)} - ${summary.join(', ') || 'serverinfo endpoint reachable'}`;

		return {
			message,
			code,
			performanceData,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			message: `Nextcloud serverinfo request error: ${errorMessage}`,
			code: STATUS_UNKNOWN,
		};
	}
};
