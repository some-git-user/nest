import dns from 'dns';
import https from 'https';
import net from 'net';
import {
	NagiosPerformanceData,
	NagiosReturnCode,
	NagiosReturnCodes,
} from '../src/types/nagios';
import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../src/types/plugin';

type NextcloudServerInfoParams = {
	baseUrl?: string;
	token?: string;
	username?: string;
	password?: string;
	warningCpuLoad1m?: number;
	criticalCpuLoad1m?: number;
	warningFreeSpaceGiB?: number;
	criticalFreeSpaceGiB?: number;
	skipApps?: boolean;
	skipUpdate?: boolean;
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
					theme?: string;
					enable_avatars?: string;
					enable_previews?: string;
					memcache_local?: string;
					memcache_distributed?: string;
					filelocking_enabled?: string;
					memcache_locking?: string;
					debug?: string;
					freespace?: number | string;
					cpuload?: Array<number | string>;
					cpunum?: number | string;
					mem_total?: number | string;
					mem_free?: number | string;
					swap_total?: number | string;
					swap_free?: number | string;
					apps?: {
						num_installed?: number | string;
						num_updates_available?: number | string;
						app_updates?: Array<unknown>;
					};
					update?: {
						available?: unknown;
						available_version?: string;
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
type NextcloudUpdateRecord = NonNullable<
	NonNullable<NextcloudServerInfoResponse['ocs']['data']['nextcloud']>['system']
>['update'];

export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-nextcloud-serverinfo?baseUrl=<nextcloud-base-url>&token=<serverinfo-token>&warningCpuLoad1m=<number>&criticalCpuLoad1m=<number>&warningFreeSpaceGiB=<number>&criticalFreeSpaceGiB=<number>&skipApps=<true|false>&skipUpdate=<true|false>',
		shell:
			'./check_nest.sh check-nextcloud-serverinfo baseUrl=<nextcloud-base-url> token=<serverinfo-token> warningCpuLoad1m=<number> criticalCpuLoad1m=<number> warningFreeSpaceGiB=<number> criticalFreeSpaceGiB=<number> skipApps=<true|false> skipUpdate=<true|false>',
	},
	params: [
		{
			name: 'baseUrl',
			label: 'Nextcloud base URL',
			type: 'url',
			required: true,
			description:
				'Base URL of your Nextcloud instance, e.g. https://cloud.example.com.',
		},
		{
			name: 'token',
			label: 'Serverinfo token',
			type: 'password',
			description:
				'Official NC-Token value configured in Nextcloud serverinfo.',
		},
		{
			name: 'username',
			label: 'Username',
			type: 'text',
			description: 'Fallback admin username for HTTP Basic authentication.',
		},
		{
			name: 'password',
			label: 'Password',
			type: 'password',
			description:
				'Fallback admin password or app password for HTTP Basic authentication.',
		},
		{
			name: 'warningCpuLoad1m',
			label: 'Warning CPU load (1m)',
			type: 'number',
			default: '4',
			description:
				'WARNING when the 1-minute CPU load is greater than or equal to this threshold.',
		},
		{
			name: 'criticalCpuLoad1m',
			label: 'Critical CPU load (1m)',
			type: 'number',
			default: '8',
			description:
				'CRITICAL when the 1-minute CPU load is greater than or equal to this threshold.',
		},
		{
			name: 'warningFreeSpaceGiB',
			label: 'Warning free space (GiB)',
			type: 'number',
			default: '20',
			description:
				'WARNING when free disk space is less than or equal to this threshold.',
		},
		{
			name: 'criticalFreeSpaceGiB',
			label: 'Critical free space (GiB)',
			type: 'number',
			default: '10',
			description:
				'CRITICAL when free disk space is less than or equal to this threshold.',
		},
		{
			name: 'skipApps',
			label: 'Skip app update check',
			type: 'boolean',
			default: 'false',
			description:
				'Skip the app update section. Enabling it triggers an external request to the Nextcloud app store.',
		},
		{
			name: 'skipUpdate',
			label: 'Skip core update check',
			type: 'boolean',
			default: 'false',
			description: 'Skip the core update section.',
		},
	],
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
</ul>` as HtmlTemplateString,
};

const usageMessage = (): string =>
	`Usage: ${meta.usage.http}. Provide baseUrl plus either token or username/password.`;

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

/**
 * Resolve a hostname to every address it maps to.
 *
 * Injectable so the SSRF guard is testable without a network: the specs pass a
 * stub resolver and get deterministic answers for names that would otherwise
 * depend on whatever DNS the test host happens to have.
 */
export type HostResolver = (hostname: string) => Promise<string[]>;

const systemHostResolver: HostResolver = async (hostname) => {
	const entries = await dns.promises.lookup(hostname, {all: true});
	return entries.map((entry) => entry.address);
};

/**
 * Whether an IPv4 address must never be used as a check target.
 *
 * Blocks the ranges that reach the host itself or the local network fabric
 * rather than a remote Nextcloud instance:
 *
 * - `0.0.0.0/8`   — "this host on this network", includes the unspecified addr
 * - `127.0.0.0/8` — loopback
 * - `169.254.0.0/16` — link-local, and with it the cloud instance-metadata
 *   endpoint at `169.254.169.254`, the classic SSRF prize
 * - `224.0.0.0/4` — multicast
 * - `240.0.0.0/4` — reserved, includes the broadcast address
 *
 * RFC1918 (`10/8`, `172.16/12`, `192.168/16`) is deliberately **allowed**: a
 * Nextcloud instance on the LAN is the common legitimate case, and blocking it
 * would break real monitoring for a class of target the operator chose.
 */
const isBlockedIpv4 = (address: string): boolean => {
	const [a, b] = address.split('.').map(Number);
	if (a === 0) {
		return true;
	}
	if (a === 127) {
		return true;
	}
	if (a === 169 && b === 254) {
		return true;
	}
	if ((a & 0xf0) === 0xe0) {
		return true;
	}
	if (a >= 240) {
		return true;
	}
	return false;
};

/**
 * IPv6 counterpart of `isBlockedIpv4`.
 *
 * IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible (`::a.b.c.d`) forms are
 * unwrapped and judged by the IPv4 rule, because a client can otherwise write
 * `http://[::ffff:127.0.0.1]/` and slip past a v6-only check.
 *
 * Blocked: `::` (unspecified), `::1` (loopback), `fe80::/10` (link-local) and
 * `ff00::/8` (multicast). `fc00::/7` (unique-local) is allowed for the same
 * reason RFC1918 is — it is the IPv6 equivalent of a LAN address.
 */
const isBlockedIpv6 = (raw: string): boolean => {
	const address = raw.toLowerCase().split('%')[0];

	const mapped = address.match(/^::(?:ffff:)?((?:\d{1,3}\.){3}\d{1,3})$/i);
	if (mapped) {
		return isBlockedIpv4(mapped[1]);
	}

	if (address === '::' || address === '::1') {
		return true;
	}

	// An address written with a leading "::" has no first group, so this is NaN
	// and falls through as not blocked — which is right: such an address is
	// neither link-local nor multicast, and the loopback forms are handled above.
	const first = parseInt(address.split(':')[0], 16);
	if (!Number.isFinite(first)) {
		return false;
	}

	// fe80::/10 — link-local.
	if ((first & 0xffc0) === 0xfe80) {
		return true;
	}
	// ff00::/8 — multicast.
	if ((first & 0xff00) === 0xff00) {
		return true;
	}

	return false;
};

/**
 * Whether an IP literal is off-limits as a check target.
 *
 * Returns false for anything that is not an IP address — a hostname is not
 * judged here, it is resolved first by `guardTargetHost`.
 */
export const isBlockedIpAddress = (address: string): boolean => {
	const stripped = address.replace(/^\[|\]$/g, '').split('%')[0];
	const family = net.isIP(stripped);
	if (family === 4) {
		return isBlockedIpv4(stripped);
	}
	if (family === 6) {
		return isBlockedIpv6(stripped);
	}
	return false;
};

/**
 * Refuse to dial a target that resolves into the local machine or network.
 *
 * The Nextcloud request carries the operator's `NC-Token` (or basic
 * credentials), so a `baseUrl` an attacker controls turns this plugin into an
 * authenticated request to an arbitrary host. `^https?://` alone does not stop
 * `127.0.0.1` or the cloud metadata endpoint; resolving and filtering does.
 *
 * A DNS failure is **not** treated as blocked: if the name cannot be resolved,
 * the subsequent fetch cannot connect either, so there is no request to guard.
 *
 * Residual: this checks the name, then `fetch` resolves it again, so a
 * rebinding DNS server could still race the two lookups. Closing that needs a
 * custom `lookup` on the agent; the operator controls the resolvers in play, so
 * it is left as documented residual risk.
 *
 * @returns A human-readable reason to refuse, or undefined when allowed.
 */
const guardTargetHost = async (
	url: string,
	resolveHost: HostResolver,
): Promise<string | undefined> => {
	const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');

	if (net.isIP(hostname)) {
		return isBlockedIpAddress(hostname)
			? `${hostname} is a blocked internal address`
			: undefined;
	}

	let addresses: string[];
	try {
		addresses = await resolveHost(hostname);
	} catch {
		return undefined;
	}

	const blocked = addresses.find((address) => isBlockedIpAddress(address));
	return blocked
		? `${hostname} resolves to the blocked internal address ${blocked}`
		: undefined;
};

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

export const buildHeaders = (
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

export const getStatusText = (code: number): string => {
	if (code === NagiosReturnCodes.OK) {
		return 'OK';
	}

	if (code === NagiosReturnCodes.WARNING) {
		return 'WARNING';
	}

	if (code === NagiosReturnCodes.CRITICAL) {
		return 'CRITICAL';
	}

	return 'UNKNOWN';
};

export const checkNextcloudServerinfo = async (
	params: NextcloudServerInfoParams,
	resolveHost: HostResolver = systemHostResolver,
): Promise<PluginReturn> => {
	if (!params.baseUrl) {
		return {
			message: usageMessage(),
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	if (!params.token && !(params.username && params.password)) {
		return {
			message: usageMessage(),
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	if (
		(params.username && !params.password) ||
		(!params.username && params.password)
	) {
		return {
			message: usageMessage(),
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	// Values already coerced by dynamic-routes.ts coerceParams()
	const warningCpuLoad1m =
		params.warningCpuLoad1m != null &&
		Number.isFinite(Number(params.warningCpuLoad1m))
			? Number(params.warningCpuLoad1m)
			: 4;
	const criticalCpuLoad1m =
		params.criticalCpuLoad1m != null &&
		Number.isFinite(Number(params.criticalCpuLoad1m))
			? Number(params.criticalCpuLoad1m)
			: 8;
	const warningFreeSpaceGiB =
		params.warningFreeSpaceGiB != null &&
		Number.isFinite(Number(params.warningFreeSpaceGiB))
			? Number(params.warningFreeSpaceGiB)
			: 20;
	const criticalFreeSpaceGiB =
		params.criticalFreeSpaceGiB != null &&
		Number.isFinite(Number(params.criticalFreeSpaceGiB))
			? Number(params.criticalFreeSpaceGiB)
			: 10;

	if (criticalCpuLoad1m < warningCpuLoad1m) {
		return {
			message:
				'criticalCpuLoad1m must be greater than or equal to warningCpuLoad1m.',
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	if (criticalFreeSpaceGiB > warningFreeSpaceGiB) {
		return {
			message:
				'criticalFreeSpaceGiB must be less than or equal to warningFreeSpaceGiB.',
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	const skipApps = params.skipApps ?? false;
	const skipUpdate = params.skipUpdate ?? false;

	let endpointUrl = '';
	try {
		endpointUrl = buildEndpointUrl(params.baseUrl, skipApps, skipUpdate);
	} catch (error) {
		return {
			message: `Nextcloud serverinfo configuration error: ${String(error)}`,
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	// The token travels with this request, so the destination is validated
	// before anything is sent rather than after.
	const blockedReason = await guardTargetHost(endpointUrl, resolveHost);
	if (blockedReason) {
		return {
			message: `Nextcloud serverinfo blocked: ${blockedReason}. Point baseUrl at the Nextcloud host itself, not an internal address.`,
			code: NagiosReturnCodes.CRITICAL,
		};
	}

	try {
		const httpsAgent = endpointUrl.startsWith('https://')
			? new https.Agent({rejectUnauthorized: false})
			: undefined;

		const response = await fetch(endpointUrl, {
			headers: buildHeaders(params),
			signal: AbortSignal.timeout(10000),
			...(httpsAgent && {agent: httpsAgent}),
		});

		if (!response.ok) {
			return {
				message: `Nextcloud serverinfo request failed: ${response.status} ${response.statusText}.`,
				code: NagiosReturnCodes.UNKNOWN,
			};
		}

		const payloadUnknown: unknown = await response.json();
		if (!isNextcloudServerInfoResponse(payloadUnknown)) {
			return {
				message: 'Nextcloud serverinfo returned an unexpected payload shape.',
				code: NagiosReturnCodes.UNKNOWN,
			};
		}

		const metaRecord = payloadUnknown.ocs.meta;
		const statusText = readString(metaRecord.status);
		const statusCode = readNumber(metaRecord.statuscode);
		if (statusText !== 'ok' || statusCode !== 200) {
			return {
				message: `Nextcloud serverinfo returned ${statusText ?? 'unknown'} (${statusCode ?? 'unknown'}): ${readString(metaRecord.message) ?? 'no message'}.`,
				code: NagiosReturnCodes.UNKNOWN,
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
		const updateRecord: NextcloudUpdateRecord | undefined = isRecord(
			systemRecord?.update,
		)
			? systemRecord.update
			: undefined;
		const updateAvailable = hasUpdateValue(updateRecord?.available);

		let code: NagiosReturnCode = NagiosReturnCodes.OK;
		const findings: string[] = [];
		const bumpCode = (candidate: number, detail: string) => {
			code = Math.max(code, candidate) as NagiosReturnCode;
			findings.push(detail);
		};

		if (typeof freeSpaceGiB === 'number') {
			if (freeSpaceGiB <= criticalFreeSpaceGiB) {
				bumpCode(
					NagiosReturnCodes.CRITICAL,
					`free space ${formatGiB(freeSpaceGiB)} GiB is at or below critical threshold ${criticalFreeSpaceGiB} GiB`,
				);
			} else if (freeSpaceGiB <= warningFreeSpaceGiB) {
				bumpCode(
					NagiosReturnCodes.WARNING,
					`free space ${formatGiB(freeSpaceGiB)} GiB is at or below warning threshold ${warningFreeSpaceGiB} GiB`,
				);
			}
		}

		if (typeof cpuLoad1m === 'number') {
			if (cpuLoad1m >= criticalCpuLoad1m) {
				bumpCode(
					NagiosReturnCodes.CRITICAL,
					`cpu load 1m ${formatLoad(cpuLoad1m)} is at or above critical threshold ${criticalCpuLoad1m}`,
				);
			} else if (cpuLoad1m >= warningCpuLoad1m) {
				bumpCode(
					NagiosReturnCodes.WARNING,
					`cpu load 1m ${formatLoad(cpuLoad1m)} is at or above warning threshold ${warningCpuLoad1m}`,
				);
			}
		}

		if (!skipApps && appUpdates > 0) {
			bumpCode(
				NagiosReturnCodes.WARNING,
				`app updates available: ${appUpdates}`,
			);
		}

		if (!skipUpdate && updateAvailable) {
			bumpCode(
				NagiosReturnCodes.CRITICAL,
				`core update available. Current version: ${version}, available version: ${readString(updateRecord?.available_version)}`,
			);
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

		const performanceData: NagiosPerformanceData[] = [];
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
		const errorString = errorMessage.toLowerCase();

		// Check the error cause for SSL/certificate related errors
		const cause = (error as Error & {cause?: unknown})?.cause;
		const causeMessage =
			cause instanceof Error
				? cause.message
				: cause != null && typeof cause === 'string'
					? cause
					: '';
		const causeString = causeMessage.toLowerCase();
		const causeCode = (cause as {code?: string} | undefined)?.code;

		// Check for SSL/certificate related errors in both error and cause
		if (
			errorString.includes('certificate') ||
			errorString.includes('cert') ||
			errorString.includes('self-signed') ||
			errorString.includes('expired') ||
			errorString.includes('unable to verify') ||
			errorString.includes('certificate authority') ||
			errorString.includes('tls') ||
			errorString.includes('ssl') ||
			causeString.includes('certificate') ||
			causeString.includes('cert') ||
			causeString.includes('self-signed') ||
			causeString.includes('expired') ||
			causeString.includes('unable to verify') ||
			causeString.includes('certificate authority') ||
			causeString.includes('tls') ||
			causeString.includes('ssl') ||
			causeCode === 'CERT_HAS_EXPIRED' ||
			causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
			causeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
			causeCode === 'SELF_SIGNED_CERT_IN_CHAIN' ||
			causeCode === 'ERR_TLS_CERT_ALTNAME_INVALID'
		) {
			const certDetails = causeMessage || errorMessage;
			return {
				message: `Nextcloud serverinfo WARNING: SSL certificate issue - ${certDetails}`,
				code: NagiosReturnCodes.WARNING,
			};
		}
		if (errorString.includes('timeout')) {
			return {
				message: `Nextcloud serverinfo request error: Network timeout - request timed out. The server may be unreachable.`,
				code: NagiosReturnCodes.UNKNOWN,
			};
		}
		return {
			message: `Nextcloud serverinfo request error: ${errorMessage}`,
			code: NagiosReturnCodes.UNKNOWN,
		};
	}
};
