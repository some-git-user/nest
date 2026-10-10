import https from 'https';
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
 * Query params arrive already coerced by the HTTP layer (`"true"` -> `true`,
 * `"90"` -> `90`), so nothing here may call string methods on a value without
 * wrapping it in `String()` first.
 */
type ParamValue = string | number | boolean | undefined;

type AnjoyCameraParams = {
	host?: ParamValue;
	port?: ParamValue;
	scheme?: ParamValue;
	path?: ParamValue;
	username?: ParamValue;
	password?: ParamValue;
	staleSeconds?: ParamValue;
	warnTemp?: ParamValue;
	critTemp?: ParamValue;
	warnCpu?: ParamValue;
	critCpu?: ParamValue;
	warnMem?: ParamValue;
	critMem?: ParamValue;
	warnNand?: ParamValue;
	critNand?: ParamValue;
	warnRec?: ParamValue;
	critRec?: ParamValue;
	warnLogin?: ParamValue;
	critLogin?: ParamValue;
	warnPwreset?: ParamValue;
	critPwreset?: ParamValue;
	warnTelnet?: ParamValue;
	critTelnet?: ParamValue;
	ignoreNoCard?: ParamValue;
	timeoutMs?: ParamValue;
};

/**
 * The redacted telemetry the camera's `/opt/ch/nagios.sh` generator writes.
 *
 * Absent metrics are emitted as JSON `null` (never omitted), so "no card" is
 * distinguishable from "card present but unreadable".
 */
type CameraFeed = Record<string, unknown>;

/**
 * Fetch seam: returns the raw response body.
 *
 * Injectable so the whole check is testable without a camera on the network.
 * Rejects with a human-readable reason on any transport or HTTP failure.
 */
export type CameraFetch = (url: string, timeoutMs: number) => Promise<string>;

const DEFAULT_STALE_SECONDS = 90;
const DEFAULT_TIMEOUT_MS = 10_000;
/**
 * How far the feed timestamp may run ahead of this host's clock before the
 * staleness verdict is considered untrustworthy. A feed cannot be generated
 * before it is read, so a future timestamp beyond this means the clocks
 * disagree and the delta means nothing.
 */
const CLOCK_SKEW_TOLERANCE_SECONDS = 120;
/**
 * Beyond this age a feed is old enough that a skewed monitoring clock becomes
 * a plausible alternative explanation to a dead generator, so the CRITICAL
 * detail points at NTP as well. Deliberately much larger than the default
 * stale window so ordinary staleness does not carry a noisy hint.
 */
const IMPLAUSIBLE_AGE_SECONDS = 3600;

const DEFAULT_THRESHOLDS = {
	warnTemp: 75,
	critTemp: 85,
	warnCpu: 85,
	critCpu: 95,
	warnMem: 85,
	critMem: 95,
	warnNand: 80,
	critNand: 92,
	warnRec: 90,
	critRec: 97,
	// Security rates per trailing 5 min (feed schema 3/4). Recovery telnet is
	// off unless the SD flag enables it and a password reset is rare in normal
	// use, so both warn on the first event; the getuid login oracle sees
	// legitimate use too and needs a looser window.
	warnLogin: 20,
	critLogin: 60,
	warnPwreset: 1,
	critPwreset: 2,
	warnTelnet: 1,
	critTelnet: 3,
} as const;

const STATUS_TEXT: Record<NagiosReturnCode, string> = {
	0: 'OK',
	1: 'WARNING',
	2: 'CRITICAL',
	3: 'UNKNOWN',
};

/**
 * Read a numeric metric out of the feed.
 *
 * The generator writes bare numbers, `null` for "not available", and the
 * literal string `"n/a"` for missing string fields. Booleans are rejected
 * because a 0/1 flag is never a thresholded metric here, and silently turning
 * `true` into 1 would invent a reading.
 */
export const readMetric = (value: unknown): number | undefined => {
	// Only a real number or a numeric string carries a reading. Anything else —
	// null, undefined, boolean, object, array, symbol, function — is "not
	// reported". Rejecting them by type rather than stringifying avoids turning
	// an object into "[object Object]" on the way to a NaN.
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined;
	}

	if (typeof value !== 'string') {
		return undefined;
	}

	const text = value.trim();
	if (text.length === 0 || text === 'n/a') {
		return undefined;
	}

	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Higher-is-worse threshold: CRITICAL at `crit`, WARNING at `warn`.
 *
 * Returns `undefined` when the metric is unavailable so the caller can tell
 * "fine" apart from "not reported" — the latter must never read as OK.
 */
const threshold = (
	value: number | undefined,
	warn: number,
	crit: number,
): NagiosReturnCode | undefined => {
	if (value === undefined) {
		return undefined;
	}
	if (value >= crit) {
		return NagiosReturnCodes.CRITICAL;
	}
	if (value >= warn) {
		return NagiosReturnCodes.WARNING;
	}
	return NagiosReturnCodes.OK;
};

const toPositiveNumber = (value: ParamValue, fallback: number): number => {
	if (value === undefined || value === null || value === '') {
		return fallback;
	}
	const parsed = Number(String(value).trim());
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Boolean param with an explicit default.
 *
 * Absent (`undefined`, `null`, empty string) falls back to the declared default;
 * anything else is judged strictly, so only `true` / `'true'` turn the flag on.
 * That keeps an explicit `ignoreNoCard=false` working as a deliberate opt-in to
 * the alert even though the default is now `true`.
 */
const toBooleanWithDefault = (
	value: ParamValue,
	fallback: boolean,
): boolean => {
	if (value === undefined || value === null || value === '') {
		return fallback;
	}
	if (typeof value === 'boolean') {
		return value;
	}
	return String(value).trim() === 'true';
};

/**
 * Build the feed URL.
 *
 * With credentials the target is the authenticated CGI route (`/cgi-bin/nagios`),
 * where the on-device shim verifies `nagios_user`/`nagios_pass` against the
 * camera's own user database. Without credentials it falls back to the static
 * `/nagios.txt` feed, which is unauthenticated but redacted.
 *
 * The password is percent-encoded because the shim url-decodes what it reads,
 * so a credential containing `%xx`, `+` or `&` must arrive encoded.
 */
export const buildFeedUrl = (params: AnjoyCameraParams): string => {
	const host = String(params.host ?? '')
		.trim()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '');
	const port = String(params.port ?? '').trim();
	const scheme = String(params.scheme ?? 'https').trim() || 'https';
	const username = String(params.username ?? '').trim();
	const password = params.password === undefined ? '' : String(params.password);

	let path = String(params.path ?? '').trim();
	if (!path.startsWith('/')) {
		path = username ? '/cgi-bin/nagios' : '/nagios.txt';
	}

	const hostPort = port ? `${host}:${port}` : host;
	const query = username
		? `?nagios_user=${encodeURIComponent(username)}&nagios_pass=${encodeURIComponent(password)}`
		: '';

	return `${scheme}://${hostPort}${path}${query}`;
};

/**
 * Default {@link CameraFetch}: a plain HTTPS GET through Node's core `https`
 * module.
 *
 * `https.request` is used rather than global `fetch` with an agent because the
 * camera serves a self-signed certificate, and undici only honours a
 * `Dispatcher` for that — a `https.Agent` is silently ignored. `https.request`
 * honours `rejectUnauthorized` directly, and `https` resolves through the
 * plugin sandbox's `createRequire` in both filesystem and SEA builds.
 */
export const cameraFetch: CameraFetch = (url, timeoutMs) =>
	new Promise((resolve, reject) => {
		const target = new URL(url);
		const request = https.request(
			{
				protocol: target.protocol,
				hostname: target.hostname,
				port: target.port,
				path: `${target.pathname}${target.search}`,
				method: 'GET',
				rejectUnauthorized: false,
				timeout: timeoutMs,
			},
			(response) => {
				const statusCode = response.statusCode ?? 0;
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () => {
					if (statusCode < 200 || statusCode >= 300) {
						reject(
							new Error(
								`HTTP ${statusCode} ${response.statusMessage ?? ''}`.trim(),
							),
						);
						return;
					}
					resolve(Buffer.concat(chunks).toString('utf8'));
				});
				response.on('error', reject);
			},
		);
		request.on('timeout', () => {
			request.destroy(new Error(`request timed out after ${timeoutMs}ms`));
		});
		request.on('error', reject);
		request.end();
	});

/**
 * Liveness verdict derived from the payload, not the HTTP status.
 *
 * The vendor web server answers 200 with an empty body for a *missing* file and
 * its f404 handler also answers 200, so a dead generator is invisible at the
 * transport layer. The only reliable signal is `generated_epoch`, which the
 * on-device generator stamps on every write.
 *
 * Stateless by design: the age is the delta between the feed timestamp and this
 * host's clock, so no state file is needed between checks.
 *
 * Ordering matters. Staleness is judged FIRST, because a feed that has stopped
 * advancing is the outage we are looking for and must stay CRITICAL for any
 * `staleSeconds` value. A timestamp in the future beyond the skew tolerance is
 * the one case where the delta cannot be trusted at all — a feed cannot be
 * generated before it is read — so that alone degrades to UNKNOWN.
 *
 * Consequence: if this host's own clock runs far behind, a fresh feed looks old
 * and reports CRITICAL. That is still the correct alarm — something *is* broken
 * — and the detail points at NTP so the operator can tell the two apart.
 */
export const evaluateStaleness = (
	generatedEpoch: number | undefined,
	nowEpoch: number,
	staleSeconds: number,
): {code: NagiosReturnCode; detail: string} => {
	if (generatedEpoch === undefined) {
		return {
			code: NagiosReturnCodes.CRITICAL,
			detail:
				'no generated_epoch in payload (generator dead or schema too old)',
		};
	}

	const ageSeconds = nowEpoch - generatedEpoch;

	if (ageSeconds < -CLOCK_SKEW_TOLERANCE_SECONDS) {
		return {
			code: NagiosReturnCodes.UNKNOWN,
			detail: `feed timestamp is ${Math.round(-ageSeconds)}s ahead of this host's clock; cannot judge staleness (check NTP on both hosts)`,
		};
	}

	if (ageSeconds > staleSeconds) {
		const clockHint =
			ageSeconds > IMPLAUSIBLE_AGE_SECONDS
				? ' (implausibly old — check NTP on both hosts before assuming the generator died)'
				: '';
		return {
			code: NagiosReturnCodes.CRITICAL,
			detail: `STALE: feed is ${Math.round(ageSeconds)}s old (>${Math.round(staleSeconds)}s) — on-device generator is dead${clockHint}`,
		};
	}

	return {
		code: NagiosReturnCodes.OK,
		detail: `feed age ${Math.max(0, Math.round(ageSeconds))}s`,
	};
};

/**
 * Recording-volume (SD card / USB) verdict.
 *
 * On a dashcam this dominates the result: no card means nothing is being
 * recorded, which is the single most likely storage failure on the device.
 *
 * The generator emits explicit `null`s for an absent card so "no card" is
 * never confused with "card mounted but `df` unreadable" — the second is only
 * ever an UNKNOWN. Whether the first is an alert depends on `ignoreNoCard`,
 * which defaults to true because running without a card is a normal
 * configuration; set it to false to treat a missing card as CRITICAL.
 */
const evaluateRecordingStorage = (
	feed: CameraFeed,
	warnRec: number,
	critRec: number,
	ignoreNoCard: boolean,
): {
	code: NagiosReturnCode;
	detail?: string;
	perf: NagiosPerformanceData[];
} => {
	const present = readMetric(feed.rec_storage_present);
	const slot =
		typeof feed.rec_storage_slot === 'string' && feed.rec_storage_slot
			? feed.rec_storage_slot
			: 'none';
	const perf: NagiosPerformanceData[] = [];

	if (present === undefined) {
		return {
			code: NagiosReturnCodes.UNKNOWN,
			detail: 'rec_storage state unknown (generator schema <2?)',
			perf,
		};
	}

	if (present < 1) {
		return ignoreNoCard
			? {
					code: NagiosReturnCodes.OK,
					detail: 'no recording card (ignored)',
					perf,
				}
			: {
					code: NagiosReturnCodes.CRITICAL,
					detail: 'NO RECORDING CARD MOUNTED',
					perf,
				};
	}

	perf.push({label: 'rec_storage_present', value: '1', uom: 'c'});

	const usedPct = readMetric(feed.rec_storage_used_pct);
	const totalKb = readMetric(feed.rec_storage_total_kb);
	const availKb = readMetric(feed.rec_storage_avail_kb);

	// A zero or unreadable total means the filesystem reported nothing usable —
	// this busybox reports 0 blocks for tmpfs. Treat it as unreadable rather
	// than "0 KB free", which would be a false alarm.
	if (usedPct === undefined || !totalKb) {
		return {
			code: NagiosReturnCodes.UNKNOWN,
			detail: `rec_storage (${slot}) mounted but usage unreadable`,
			perf,
		};
	}

	if (availKb !== undefined) {
		perf.push({
			label: 'rec_storage_avail_kb',
			value: String(Math.round(availKb)),
			uom: 'KB',
			min: '0',
		});
	}
	perf.push({
		label: 'rec_storage_used_pct',
		value: String(Math.round(usedPct)),
		uom: '%',
		warn: String(Math.round(warnRec)),
		crit: String(Math.round(critRec)),
		min: '0',
		max: '100',
	});

	const status = threshold(usedPct, warnRec, critRec);
	if (status === NagiosReturnCodes.CRITICAL) {
		return {
			code: status,
			detail: `rec_storage(${slot}) ${Math.round(usedPct)}% >= ${Math.round(critRec)}%`,
			perf,
		};
	}
	if (status === NagiosReturnCodes.WARNING) {
		return {
			code: status,
			detail: `rec_storage(${slot}) ${Math.round(usedPct)}% >= ${Math.round(warnRec)}%`,
			perf,
		};
	}

	// A huge card can sit at a comfortable percentage while the absolute
	// headroom is still too small to matter.
	if (availKb !== undefined && availKb < 5120) {
		return {
			code: NagiosReturnCodes.WARNING,
			detail: `rec_storage(${slot}) only ${Math.round(availKb)} KB free`,
			perf,
		};
	}

	return {code: NagiosReturnCodes.OK, perf};
};

/**
 * Thresholded percentage metrics: `[feedKey, label, warnParam, critParam]`.
 *
 * Temperature thresholds are deliberately NOT tuned per model. The two
 * supported cameras have incomparable sensors — YMF46D idles near 74 °C while
 * YM500L rests at 88-89 °C — so the operator sets them per host in Nagios.
 * The defaults suit YMF46D; a YM500L needs roughly 92/97.
 */
const PERCENT_METRICS: ReadonlyArray<
	readonly [
		string,
		string,
		keyof typeof DEFAULT_THRESHOLDS,
		keyof typeof DEFAULT_THRESHOLDS,
	]
> = [
	['temperature_c', 'temperature', 'warnTemp', 'critTemp'],
	['cpu_used_pct', 'cpu', 'warnCpu', 'critCpu'],
	['mem_used_pct', 'memory', 'warnMem', 'critMem'],
	['nand_used_pct', 'nand', 'warnNand', 'critNand'],
];

/**
 * Security-rate metrics (feed schema 3/4), counted on the device in a
 * trailing 5-minute window.
 *
 * `login_attempts_5m` / `pwreset_5m` come from the `login_watch.so` shim
 * (schema 3); `telnet_attempts_5m` from `reclogin.sh` (schema 4), a path the
 * shim cannot see. An absent field means the detector is too old or not
 * loaded — that is noted, not alerted, so an older feed stays usable.
 */
const RATE_METRICS: ReadonlyArray<{
	feedKey: string;
	warnKey: keyof typeof DEFAULT_THRESHOLDS;
	critKey: keyof typeof DEFAULT_THRESHOLDS;
	unknownNote: string;
	findingLabel: string;
	findingReason: string;
}> = [
	{
		feedKey: 'login_attempts_5m',
		warnKey: 'warnLogin',
		critKey: 'critLogin',
		unknownNote: 'login rate unknown (schema <3 or login_watch not loaded)',
		findingLabel: 'login attempts',
		findingReason: 'possible brute force',
	},
	{
		feedKey: 'pwreset_5m',
		warnKey: 'warnPwreset',
		critKey: 'critPwreset',
		unknownNote: 'pwreset rate unknown (schema <3 or login_watch not loaded)',
		findingLabel: 'password reset(s)',
		findingReason: 'possible account takeover',
	},
	{
		feedKey: 'telnet_attempts_5m',
		warnKey: 'warnTelnet',
		critKey: 'critTelnet',
		unknownNote: 'telnet rate unknown (schema <4 or reclogin not used)',
		findingLabel: 'telnet recovery logins',
		findingReason: 'recovery access',
	},
];

/** Graphed but not thresholded. */
const INFO_METRICS: ReadonlyArray<readonly [string, string, string]> = [
	['uptime_seconds', 'uptime', 's'],
	['heartbeat', 'heartbeat', 'c'],
	['loadavg_1', 'loadavg_1', ''],
	['mem_avail_kb', 'mem_avail_kb', 'KB'],
	['process_count', 'processes', 'c'],
];

/**
 * Parse the feed body into an object.
 *
 * The CGI route serves JSON with `Content-Type: text/xml`, so the declared type
 * is ignored and the body is parsed directly.
 */
export const parseFeed = (body: string): CameraFeed | undefined => {
	if (!body || !body.trim()) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(body);
		if (
			parsed === null ||
			typeof parsed !== 'object' ||
			Array.isArray(parsed)
		) {
			return undefined;
		}
		return parsed as CameraFeed;
	} catch {
		return undefined;
	}
};

export const checkAnjoyCamera = async (
	params: AnjoyCameraParams,
	fetchFeed: CameraFetch = cameraFetch,
	nowMs: number = Date.now(),
): Promise<PluginReturn> => {
	const host = String(params.host ?? '').trim();
	if (!host) {
		return {
			message:
				'Missing host. Usage: /plugins/check-anjoy-camera?host=<camera-ip>&username=<user>&password=<pass>',
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	const staleSeconds = toPositiveNumber(
		params.staleSeconds,
		DEFAULT_STALE_SECONDS,
	);
	const timeoutMs = toPositiveNumber(params.timeoutMs, DEFAULT_TIMEOUT_MS);
	// Defaults to true: a camera running without a recording card is a normal
	// configuration for a lot of installs, and alerting on it by default buries
	// the real signals. Pass ignoreNoCard=false to get the strict behaviour.
	const ignoreNoCard = toBooleanWithDefault(params.ignoreNoCard, true);

	const thresholds = {
		warnTemp: toPositiveNumber(params.warnTemp, DEFAULT_THRESHOLDS.warnTemp),
		critTemp: toPositiveNumber(params.critTemp, DEFAULT_THRESHOLDS.critTemp),
		warnCpu: toPositiveNumber(params.warnCpu, DEFAULT_THRESHOLDS.warnCpu),
		critCpu: toPositiveNumber(params.critCpu, DEFAULT_THRESHOLDS.critCpu),
		warnMem: toPositiveNumber(params.warnMem, DEFAULT_THRESHOLDS.warnMem),
		critMem: toPositiveNumber(params.critMem, DEFAULT_THRESHOLDS.critMem),
		warnNand: toPositiveNumber(params.warnNand, DEFAULT_THRESHOLDS.warnNand),
		critNand: toPositiveNumber(params.critNand, DEFAULT_THRESHOLDS.critNand),
		warnRec: toPositiveNumber(params.warnRec, DEFAULT_THRESHOLDS.warnRec),
		critRec: toPositiveNumber(params.critRec, DEFAULT_THRESHOLDS.critRec),
		warnLogin: toPositiveNumber(params.warnLogin, DEFAULT_THRESHOLDS.warnLogin),
		critLogin: toPositiveNumber(params.critLogin, DEFAULT_THRESHOLDS.critLogin),
		warnPwreset: toPositiveNumber(
			params.warnPwreset,
			DEFAULT_THRESHOLDS.warnPwreset,
		),
		critPwreset: toPositiveNumber(
			params.critPwreset,
			DEFAULT_THRESHOLDS.critPwreset,
		),
		warnTelnet: toPositiveNumber(
			params.warnTelnet,
			DEFAULT_THRESHOLDS.warnTelnet,
		),
		critTelnet: toPositiveNumber(
			params.critTelnet,
			DEFAULT_THRESHOLDS.critTelnet,
		),
	};

	let body: string;
	try {
		body = await fetchFeed(buildFeedUrl(params), timeoutMs);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			message: `CRITICAL - cannot read camera feed from ${host}: ${reason}`,
			code: NagiosReturnCodes.CRITICAL,
		};
	}

	const feed = parseFeed(body);
	if (!feed) {
		return {
			message:
				`CRITICAL - feed from ${host} is empty or not JSON. ` +
				'The vendor server answers 200 for a missing file, so this means the on-device generator is dead.',
			code: NagiosReturnCodes.CRITICAL,
		};
	}

	const findings: string[] = [];
	const performanceData: NagiosPerformanceData[] = [];
	let code: NagiosReturnCode = NagiosReturnCodes.OK;

	const bump = (candidate: NagiosReturnCode, detail?: string) => {
		if (candidate > code) {
			code = candidate;
		}
		if (detail) {
			findings.push(detail);
		}
	};

	const staleness = evaluateStaleness(
		readMetric(feed.generated_epoch),
		Math.floor(nowMs / 1000),
		staleSeconds,
	);
	// Only a non-OK staleness is a finding; when the feed is fresh its age
	// belongs in the summary line, not in the problem list. This runs before any
	// other check, so `code` is still OK and the assignment always applies.
	if (staleness.code !== NagiosReturnCodes.OK) {
		code = staleness.code;
		findings.push(staleness.detail);
	}

	const recording = evaluateRecordingStorage(
		feed,
		thresholds.warnRec,
		thresholds.critRec,
		ignoreNoCard,
	);
	bump(recording.code, recording.detail);
	performanceData.push(...recording.perf);

	for (const [feedKey, label, warnKey, critKey] of PERCENT_METRICS) {
		const value = readMetric(feed[feedKey]);
		const warn = thresholds[warnKey];
		const crit = thresholds[critKey];
		const status = threshold(value, warn, crit);

		if (value === undefined) {
			findings.push(`${label} unavailable`);
			continue;
		}

		performanceData.push({
			label,
			value: String(Math.round(value)),
			uom: '%',
			warn: String(Math.round(warn)),
			crit: String(Math.round(crit)),
			min: '0',
			max: '100',
		});

		if (
			status === NagiosReturnCodes.WARNING ||
			status === NagiosReturnCodes.CRITICAL
		) {
			const limit = status === NagiosReturnCodes.CRITICAL ? crit : warn;
			bump(status, `${label} ${Math.round(value)}% >= ${Math.round(limit)}%`);
		}
	}

	// Security rates (feed schema 3/4). An absent field only notes that the
	// on-device detector is old or not loaded — it must not change the status,
	// or every camera running an older build would go UNKNOWN at once.
	for (const rate of RATE_METRICS) {
		const value = readMetric(feed[rate.feedKey]);
		const warn = thresholds[rate.warnKey];
		const crit = thresholds[rate.critKey];

		if (value === undefined) {
			findings.push(rate.unknownNote);
			continue;
		}

		performanceData.push({
			label: rate.feedKey,
			value: String(Math.round(value)),
			// Counters, not a measured unit: the UOM stays the empty string the
			// plugin sandbox's type requires rather than omitting it.
			uom: '',
			warn: String(Math.round(warn)),
			crit: String(Math.round(crit)),
			min: '0',
		});

		const status = threshold(value, warn, crit);
		if (
			status === NagiosReturnCodes.WARNING ||
			status === NagiosReturnCodes.CRITICAL
		) {
			const limit = status === NagiosReturnCodes.CRITICAL ? crit : warn;
			bump(
				status,
				`${rate.findingLabel} ${Math.round(value)}/5min >= ${Math.round(limit)} (${rate.findingReason})`,
			);
		}
	}

	// Required services: a missing field is UNKNOWN, a zero is CRITICAL.
	for (const [feedKey, label] of [
		['web_server_running', 'web_server'],
		['watchdog_running', 'watchdog'],
	] as const) {
		const value = readMetric(feed[feedKey]);
		if (value === undefined) {
			bump(NagiosReturnCodes.UNKNOWN, `${label} state unknown`);
		} else if (value < 1) {
			bump(NagiosReturnCodes.CRITICAL, `${label} NOT running`);
		}
	}

	for (const [feedKey, label, uom] of INFO_METRICS) {
		const value = readMetric(feed[feedKey]);
		if (value !== undefined) {
			performanceData.push({
				label,
				value: String(Math.round(value)),
				uom,
				min: '0',
			});
		}
	}

	const summary =
		findings.length > 0
			? findings.join('; ')
			: `all metrics within thresholds (${staleness.detail})`;

	return {
		message: `${STATUS_TEXT[code]} - ${summary}`,
		code,
		performanceData,
	};
};

export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-anjoy-camera?host=<camera-ip>&port=<port>&username=<nagios-user>&password=<nagios-pass>&path=</nagios_token.txt>&staleSeconds=90&warnTemp=75&critTemp=85&warnCpu=85&critCpu=95&warnMem=85&critMem=95&warnNand=80&critNand=92&warnRec=90&critRec=97&warnLogin=20&critLogin=60&warnPwreset=1&critPwreset=2&warnTelnet=1&critTelnet=3&ignoreNoCard=true&timeoutMs=10000',
		shell:
			'./check_nest.sh check-anjoy-camera host=<camera-ip> username=<nagios-user> password=<nagios-pass> warnTemp=75 critTemp=85',
	},
	params: [
		{
			name: 'host',
			label: 'Camera host',
			type: 'text',
			required: true,
			description: 'IP or hostname of the camera.',
		},
		{
			name: 'port',
			label: 'Port',
			type: 'number',
			description:
				'Server port. Omit to use the scheme default (443 for https, 80 for http).',
		},
		{
			name: 'scheme',
			label: 'Scheme',
			type: 'text',
			default: 'https',
			description: "'https' (default) or 'http'.",
		},
		{
			name: 'path',
			label: 'Feed path override',
			type: 'text',
			description:
				'Override the feed path. Defaults to /cgi-bin/nagios when credentials are set, otherwise /nagios.txt. On YM500L the open path is gone: pass the capability URL /nagios_<token>.txt (token from the firmware build store).',
		},
		{
			name: 'username',
			label: 'Nagios user',
			type: 'text',
			description:
				'Camera web UI account used for the authenticated /cgi-bin/nagios route. Omit to poll the unauthenticated static feed.',
		},
		{
			name: 'password',
			label: 'Nagios password',
			type: 'password',
			description:
				'Password for the nagios user. Sent as a query parameter, so use https.',
		},
		{
			name: 'staleSeconds',
			label: 'Stale after (s)',
			type: 'number',
			default: '90',
			description:
				'CRITICAL when the feed timestamp is older than this. The vendor server returns HTTP 200 for a dead generator, so this is the only liveness signal.',
		},
		{
			name: 'warnTemp',
			label: 'Warning temperature (%)',
			type: 'number',
			default: '75',
			description:
				'WARNING at or above this die temperature. Sensors differ per model: YMF46D idles ~74 C, YM500L rests ~88 C, so set this per host.',
		},
		{
			name: 'critTemp',
			label: 'Critical temperature (%)',
			type: 'number',
			default: '85',
			description: 'CRITICAL at or above this die temperature.',
		},
		{
			name: 'warnCpu',
			label: 'Warning CPU (%)',
			type: 'number',
			default: '85',
			description: 'WARNING at or above this CPU utilisation.',
		},
		{
			name: 'critCpu',
			label: 'Critical CPU (%)',
			type: 'number',
			default: '95',
			description: 'CRITICAL at or above this CPU utilisation.',
		},
		{
			name: 'warnMem',
			label: 'Warning memory (%)',
			type: 'number',
			default: '85',
			description: 'WARNING at or above this memory usage.',
		},
		{
			name: 'critMem',
			label: 'Critical memory (%)',
			type: 'number',
			default: '95',
			description: 'CRITICAL at or above this memory usage.',
		},
		{
			name: 'warnNand',
			label: 'Warning config partition (%)',
			type: 'number',
			default: '80',
			description:
				'WARNING at or above this usage of the jffs2 config partition. A full config partition breaks configuration persistence.',
		},
		{
			name: 'critNand',
			label: 'Critical config partition (%)',
			type: 'number',
			default: '92',
			description:
				'CRITICAL at or above this usage of the jffs2 config partition.',
		},
		{
			name: 'warnRec',
			label: 'Warning recording volume (%)',
			type: 'number',
			default: '90',
			description:
				'WARNING when the recording volume (SD card / USB) is at or above this percentage.',
		},
		{
			name: 'critRec',
			label: 'Critical recording volume (%)',
			type: 'number',
			default: '97',
			description:
				'CRITICAL when the recording volume is at or above this percentage.',
		},
		{
			name: 'warnLogin',
			label: 'Warning login attempts / 5 min',
			type: 'number',
			default: '20',
			description:
				'WARNING at or above this many getuid login attempts in 5 min (feed schema 3, login_watch shim). A brute-force signal for the credential oracle.',
		},
		{
			name: 'critLogin',
			label: 'Critical login attempts / 5 min',
			type: 'number',
			default: '60',
			description: 'CRITICAL at or above this many login attempts in 5 min.',
		},
		{
			name: 'warnPwreset',
			label: 'Warning password resets / 5 min',
			type: 'number',
			default: '1',
			description:
				'WARNING at or above this many /setUserConfig password resets in 5 min (feed schema 3). A reset is rare in normal use, so the first one warns.',
		},
		{
			name: 'critPwreset',
			label: 'Critical password resets / 5 min',
			type: 'number',
			default: '2',
			description: 'CRITICAL at or above this many password resets in 5 min.',
		},
		{
			name: 'warnTelnet',
			label: 'Warning telnet recovery logins / 5 min',
			type: 'number',
			default: '1',
			description:
				'WARNING at or above this many recovery (telnet) login attempts in 5 min (feed schema 4, reclogin.sh). Telnet is off unless the SD flag enables it, so the first attempt is worth a look.',
		},
		{
			name: 'critTelnet',
			label: 'Critical telnet recovery logins / 5 min',
			type: 'number',
			default: '3',
			description:
				'CRITICAL at or above this many telnet recovery logins in 5 min — a burst means someone is guessing at the recovery password.',
		},
		{
			name: 'ignoreNoCard',
			label: 'Ignore missing card',
			type: 'boolean',
			default: 'true',
			description:
				'Default true: a missing recording card is reported but does not change the status. Set to false to make "no recording card" CRITICAL — for a camera that must always have one.',
		},
		{
			name: 'timeoutMs',
			label: 'Timeout (ms)',
			type: 'number',
			default: '10000',
			description: 'HTTP request timeout in milliseconds.',
		},
	],
	help: `<h1>check-anjoy-camera</h1>
<p>Monitors an ANJOY888 dashcam (YMF46D / YM500L) by polling the redacted JSON telemetry feed produced on the device by <code>/opt/ch/nagios.sh</code>.</p>

<h2>Why this is not just check_http</h2>
<p>The vendor web server returns <strong>HTTP 200 with an empty body for a missing file</strong>, and its f404 handler also returns 200. The status code therefore says nothing about whether the on-device generator is alive. Liveness is derived from the <code>generated_epoch</code> field inside the payload: if it is older than <code>staleSeconds</code>, the generator is dead and the check is CRITICAL.</p>

<h2>Routes</h2>
<p>The guessable unauthenticated <code>/nagios.txt</code> path <strong>no longer exists</strong> on custom builds — it was removed because anyone on the LAN could read the telemetry. The feed is reached one of two ways depending on the camera:</p>
<ul>
  <li><strong>Authenticated (YMF46D, recommended):</strong> <code>/cgi-bin/nagios?nagios_user=&amp;nagios_pass=</code>, served by an <code>LD_PRELOAD</code> shim that verifies credentials against the camera's own web "manage user" database. Selected automatically when <code>username</code> is set.</li>
  <li><strong>Capability URL (YM500L):</strong> that model has no CGI dispatcher, so the feed is served only at an unguessable <code>/nagios_&lt;token&gt;.txt</code>. Pass it as <code>path</code>. The token is a per-camera shared secret generated by the firmware build (<code>tools/.nagios_token.&lt;ip&gt;</code>).</li>
</ul>
<p>The password is percent-encoded on the wire, so it must travel over https.</p>

<h2>What is checked</h2>
<ul>
  <li><strong>Liveness</strong> — feed age against <code>staleSeconds</code></li>
  <li><strong>Recording volume</strong> — the headline check on a dashcam: high usage warns or alerts, and a card with very little absolute headroom warns. A <em>missing</em> card is reported but does not change the status unless <code>ignoreNoCard=false</code>.</li>
  <li><strong>Temperature, CPU, memory, config partition</strong> — percentage thresholds</li>
  <li><strong>Service liveness</strong> — <code>web_server</code> and the watchdog must be running</li>
  <li><strong>Security rates (feed schema 3/4)</strong> — <code>login_attempts_5m</code> (getuid brute force), <code>pwreset_5m</code> (account-takeover resets) and <code>telnet_attempts_5m</code> (recovery-console access) are thresholded per trailing 5 min. On an older feed these fields are absent: the check notes it but does <em>not</em> change the status, so pre-schema-3 cameras stay usable.</li>
</ul>

<h2>Temperature thresholds are per-host</h2>
<p>The two supported cameras have incomparable sensors. YMF46D (INFINITY6C) idles near 74&nbsp;°C; YM500L (INFINITY3) rests at 88-89&nbsp;°C and reaches 93-96&nbsp;°C when warm. The shipped default (75/85) suits YMF46D but leaves a YM500L alerting continuously at its normal resting state. Set <code>warnTemp</code>/<code>critTemp</code> per host in Nagios — roughly 92/97 for YM500L — rather than changing the default, which would blind YMF46D to real overheating.</p>

<h2>Clock agreement</h2>
<p>Staleness is the delta between the feed timestamp and this host's clock, so no state file is needed between checks. If the two clocks disagree by more than 120&nbsp;s the verdict is UNKNOWN rather than a guess; run NTP on both hosts.</p>

<h2>Examples</h2>
<h3>Authenticated check</h3>
<pre><code>GET /plugins/check-anjoy-camera?host=192.0.2.10&amp;username=nagios&amp;password=secret&amp;staleSeconds=90</code></pre>

<h3>Alert when a card must be present</h3>
<pre><code>GET /plugins/check-anjoy-camera?host=192.0.2.10&amp;ignoreNoCard=false</code></pre>

<h3>Using check_nest.sh</h3>
<pre><code>./check_nest.sh check-anjoy-camera host=192.0.2.10 username=nagios password=secret warnTemp=92 critTemp=97</code></pre>

<h2>Return codes</h2>
<ul>
  <li><strong>OK</strong> — feed fresh and all metrics within thresholds</li>
  <li><strong>WARNING</strong> — a threshold exceeded, or a recording volume with very little absolute headroom</li>
  <li><strong>CRITICAL</strong> — stale feed, unreachable camera, a critical threshold, or a missing recording card when <code>ignoreNoCard=false</code></li>
  <li><strong>UNKNOWN</strong> — clock skew too large, or a metric the feed did not report</li>
</ul>` as HtmlTemplateString,
};
