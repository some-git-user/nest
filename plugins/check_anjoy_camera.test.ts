import {
	buildFeedUrl,
	checkAnjoyCamera,
	evaluateStaleness,
	parseFeed,
	readMetric,
} from './check_anjoy_camera';

type Params = Parameters<typeof checkAnjoyCamera>[0];

const NOW_EPOCH = 1_700_000_000;
const NOW_MS = NOW_EPOCH * 1000;

/** A feed where every check passes: fresh, card healthy, services up. */
const healthyFeed = () => ({
	generated_epoch: NOW_EPOCH - 10,
	uptime_seconds: 1234,
	heartbeat: 42,
	loadavg_1: 1,
	mem_avail_kb: 100_000,
	process_count: 50,
	temperature_c: 50,
	cpu_used_pct: 10,
	mem_used_pct: 40,
	nand_used_pct: 20,
	rec_storage_present: 1,
	rec_storage_slot: 'mmc0',
	rec_storage_total_kb: 32_000_000,
	rec_storage_used_kb: 1_000_000,
	rec_storage_avail_kb: 30_000_000,
	rec_storage_used_pct: 3,
	web_server_running: 1,
	watchdog_running: 1,
	// schema 3/4 security-rate counters: a healthy device reports zero events.
	login_attempts_5m: 0,
	pwreset_5m: 0,
	telnet_attempts_5m: 0,
});

const jsonFeed = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({...healthyFeed(), ...overrides});

/** Injected fetch seam: returns a canned body, never touches the network. */
const feedReturning = (body: string) =>
	jest.fn(async (): Promise<string> => body);

describe('readMetric', () => {
	test('accepts a finite number as-is', () => {
		expect(readMetric(42)).toBe(42);
		expect(readMetric(0)).toBe(0);
		expect(readMetric(-3.5)).toBe(-3.5);
	});

	test('rejects non-finite numbers', () => {
		expect(readMetric(Number.NaN)).toBeUndefined();
		expect(readMetric(Number.POSITIVE_INFINITY)).toBeUndefined();
	});

	test('accepts numeric strings and trims them', () => {
		expect(readMetric('75')).toBe(75);
		expect(readMetric('  88  ')).toBe(88);
		expect(readMetric('12.5')).toBe(12.5);
	});

	test('rejects the generator placeholders for "not reported"', () => {
		expect(readMetric(null)).toBeUndefined();
		expect(readMetric(undefined)).toBeUndefined();
		expect(readMetric('')).toBeUndefined();
		expect(readMetric('   ')).toBeUndefined();
		expect(readMetric('n/a')).toBeUndefined();
	});

	test('rejects non-numeric strings', () => {
		expect(readMetric('mmc0')).toBeUndefined();
		expect(readMetric('yes')).toBeUndefined();
	});

	test('never coerces booleans, objects or arrays into a reading', () => {
		// `Number(true)` is 1, which would invent a metric out of a flag.
		expect(readMetric(true)).toBeUndefined();
		expect(readMetric(false)).toBeUndefined();
		expect(readMetric({})).toBeUndefined();
		expect(readMetric([1])).toBeUndefined();
	});
});

describe('buildFeedUrl', () => {
	test('uses the authenticated CGI route when a username is present', () => {
		expect(
			buildFeedUrl({
				host: '192.0.2.10',
				username: 'nagios',
				password: 'secret',
			}),
		).toBe(
			'https://192.0.2.10/cgi-bin/nagios?nagios_user=nagios&nagios_pass=secret',
		);
	});

	test('falls back to the static feed when no username is given', () => {
		expect(buildFeedUrl({host: '192.0.2.10'})).toBe(
			'https://192.0.2.10/nagios.txt',
		);
	});

	test('percent-encodes credentials so reserved characters survive', () => {
		// The on-device shim url-decodes what it reads, so a password holding
		// %xx, + or & must arrive encoded or it never matches.
		const url = buildFeedUrl({
			host: 'cam',
			username: 'a&b',
			password: 'p+ss%20word',
		});
		expect(url).toContain('nagios_user=a%26b');
		expect(url).toContain('nagios_pass=p%2Bss%2520word');
	});

	test('sends an empty password when only a username is set', () => {
		expect(buildFeedUrl({host: 'cam', username: 'u'})).toBe(
			'https://cam/cgi-bin/nagios?nagios_user=u&nagios_pass=',
		);
	});

	test('honours an explicit port', () => {
		expect(buildFeedUrl({host: 'cam', port: 8080})).toBe(
			'https://cam:8080/nagios.txt',
		);
	});

	test('honours http as the scheme', () => {
		expect(buildFeedUrl({host: 'cam', scheme: 'http'})).toBe(
			'http://cam/nagios.txt',
		);
	});

	test('falls back to https when the scheme is blank', () => {
		expect(buildFeedUrl({host: 'cam', scheme: '   '})).toBe(
			'https://cam/nagios.txt',
		);
	});

	test('honours a path override starting with a slash', () => {
		expect(
			buildFeedUrl({host: 'cam', username: 'u', password: 'p', path: '/x.txt'}),
		).toBe('https://cam/x.txt?nagios_user=u&nagios_pass=p');
	});

	test('strips an accidental scheme and trailing path from host', () => {
		expect(buildFeedUrl({host: 'https://10.0.0.5/some/thing'})).toBe(
			'https://10.0.0.5/nagios.txt',
		);
	});

	test('treats a non-slash path as absent', () => {
		expect(buildFeedUrl({host: 'cam', path: 'nope'})).toBe(
			'https://cam/nagios.txt',
		);
	});
});

describe('parseFeed', () => {
	test('parses a JSON object', () => {
		expect(parseFeed('{"a":1}')).toEqual({a: 1});
	});

	test('rejects an empty or whitespace-only body', () => {
		expect(parseFeed('')).toBeUndefined();
		expect(parseFeed('   \n ')).toBeUndefined();
	});

	test('rejects malformed JSON', () => {
		expect(parseFeed('{oops')).toBeUndefined();
	});

	test('rejects a JSON array or scalar', () => {
		expect(parseFeed('[1,2]')).toBeUndefined();
		expect(parseFeed('42')).toBeUndefined();
		expect(parseFeed('null')).toBeUndefined();
	});
});

describe('evaluateStaleness', () => {
	test('is CRITICAL when the payload has no timestamp', () => {
		const result = evaluateStaleness(undefined, NOW_EPOCH, 90);
		expect(result.code).toBe(2);
		expect(result.detail).toContain('no generated_epoch');
	});

	test('is OK while the feed is younger than the stale window', () => {
		const result = evaluateStaleness(NOW_EPOCH - 10, NOW_EPOCH, 90);
		expect(result.code).toBe(0);
		expect(result.detail).toContain('feed age 10s');
	});

	test('is CRITICAL once the feed is older than the stale window', () => {
		const result = evaluateStaleness(NOW_EPOCH - 300, NOW_EPOCH, 90);
		expect(result.code).toBe(2);
		expect(result.detail).toContain('STALE');
		expect(result.detail).toContain('300s');
		// Ordinary staleness carries no clock hint.
		expect(result.detail).not.toContain('NTP');
	});

	test('stays CRITICAL for a long-stale feed, with an NTP hint', () => {
		// A feed far behind could mean either a dead generator or a skewed
		// local clock. Both are outages, so it must stay CRITICAL rather than
		// degrade to UNKNOWN and hide the failure — the hint tells them apart.
		const result = evaluateStaleness(NOW_EPOCH - 7200, NOW_EPOCH, 90);
		expect(result.code).toBe(2);
		expect(result.detail).toContain('STALE');
		expect(result.detail).toContain('NTP');
	});

	test('is UNKNOWN when the feed timestamp is far in the future', () => {
		const result = evaluateStaleness(NOW_EPOCH + 600, NOW_EPOCH, 90);
		expect(result.code).toBe(3);
		expect(result.detail).toContain('ahead');
	});

	test('clamps a tiny negative age to 0 in the OK message', () => {
		// The camera clock can be a second ahead; that is not an error.
		const result = evaluateStaleness(NOW_EPOCH + 5, NOW_EPOCH, 90);
		expect(result.code).toBe(0);
		expect(result.detail).toBe('feed age 0s');
	});
});

describe('checkAnjoyCamera - argument handling', () => {
	test('is UNKNOWN without a host', async () => {
		const result = await checkAnjoyCamera({}, feedReturning('{}'));
		expect(result.code).toBe(3);
		expect(result.message).toContain('Missing host');
	});

	test('is UNKNOWN when the host is only whitespace', async () => {
		const result = await checkAnjoyCamera({host: '   '}, feedReturning('{}'));
		expect(result.code).toBe(3);
	});

	test('falls back to defaults for blank or non-positive numeric params', async () => {
		// null / '' / 0 / negative all collapse to the documented defaults, so
		// a half-filled preset cannot disable a threshold by accident.
		const result = await checkAnjoyCamera(
			{
				host: 'cam',
				staleSeconds: null,
				timeoutMs: '',
				warnTemp: 0,
				critTemp: -5,
			} as unknown as Params,
			feedReturning(jsonFeed()),
			NOW_MS,
		);
		expect(result.code).toBe(0);
		const temperature = result.performanceData?.find(
			(entry) => entry.label === 'temperature',
		);
		expect(temperature?.warn).toBe('75');
		expect(temperature?.crit).toBe('85');
	});

	test('accepts coerced string thresholds from the query layer', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam', warnTemp: '40', critTemp: '45'},
			feedReturning(jsonFeed({temperature_c: 50})),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('temperature 50% >= 45%');
	});
});

describe('checkAnjoyCamera - happy path', () => {
	test('is OK when every metric is inside its thresholds', async () => {
		const fetchFeed = feedReturning(jsonFeed());
		const result = await checkAnjoyCamera({host: 'cam'}, fetchFeed, NOW_MS);

		expect(result.code).toBe(0);
		expect(result.message).toContain('OK -');
		expect(result.message).toContain('all metrics within thresholds');
		expect(fetchFeed).toHaveBeenCalledWith('https://cam/nagios.txt', 10_000);
	});

	test('emits the graphed info metrics', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed()),
			NOW_MS,
		);
		const labels = result.performanceData?.map((entry) => entry.label);
		expect(labels).toEqual(
			expect.arrayContaining([
				'uptime',
				'heartbeat',
				'loadavg_1',
				'mem_avail_kb',
				'processes',
				'temperature',
				'cpu',
				'memory',
				'nand',
				'rec_storage_used_pct',
			]),
		);
	});
});

describe('checkAnjoyCamera - transport', () => {
	test('is CRITICAL when the fetch rejects', async () => {
		const fetchFeed = jest.fn(async (): Promise<string> => {
			throw new Error('ECONNREFUSED');
		});
		const result = await checkAnjoyCamera({host: 'cam'}, fetchFeed, NOW_MS);
		expect(result.code).toBe(2);
		expect(result.message).toContain('cannot read camera feed from cam');
		expect(result.message).toContain('ECONNREFUSED');
	});

	test('surfaces a non-Error rejection reason', async () => {
		const fetchFeed = jest.fn(async (): Promise<string> => {
			// eslint-disable-next-line @typescript-eslint/no-throw-literal
			throw 'socket hang up';
		});
		const result = await checkAnjoyCamera({host: 'cam'}, fetchFeed, NOW_MS);
		expect(result.code).toBe(2);
		expect(result.message).toContain('socket hang up');
	});

	test('is CRITICAL on an empty body, explaining the 200 trap', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(''),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('vendor server answers 200');
	});

	test('is CRITICAL on a non-JSON body', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning('<html>welcome</html>'),
			NOW_MS,
		);
		expect(result.code).toBe(2);
	});
});

describe('checkAnjoyCamera - recording volume', () => {
	test('reports a missing card without alerting by default', async () => {
		// ignoreNoCard defaults to true: running without a card is a normal
		// configuration, so it is surfaced in the message but does not change
		// the status.
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(
				jsonFeed({
					rec_storage_present: 0,
					rec_storage_slot: 'none',
					rec_storage_total_kb: null,
					rec_storage_used_kb: null,
					rec_storage_avail_kb: null,
					rec_storage_used_pct: null,
				}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(0);
		expect(result.message).toContain('no recording card (ignored)');
	});

	test('is CRITICAL when no card is mounted and ignoreNoCard is false', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam', ignoreNoCard: false},
			feedReturning(
				jsonFeed({
					rec_storage_present: 0,
					rec_storage_slot: 'none',
					rec_storage_total_kb: null,
					rec_storage_used_kb: null,
					rec_storage_avail_kb: null,
					rec_storage_used_pct: null,
				}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('NO RECORDING CARD MOUNTED');
	});

	test('treats the string "false" as a deliberate opt-in to the alert', async () => {
		// The default is true, so an explicit false must still be honoured —
		// a truthiness check on the string 'false' would wrongly ignore it.
		const result = await checkAnjoyCamera(
			{host: 'cam', ignoreNoCard: 'false'},
			feedReturning(jsonFeed({rec_storage_present: 0})),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('NO RECORDING CARD MOUNTED');
	});

	test('is OK with no card when ignoreNoCard is set', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam', ignoreNoCard: true},
			feedReturning(
				jsonFeed({
					rec_storage_present: 0,
					rec_storage_slot: 'none',
					rec_storage_total_kb: null,
					rec_storage_used_kb: null,
					rec_storage_avail_kb: null,
					rec_storage_used_pct: null,
				}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(0);
		expect(result.message).toContain('no recording card (ignored)');
	});

	test('accepts ignoreNoCard as the string "true" from the query layer', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam', ignoreNoCard: 'true'},
			feedReturning(jsonFeed({rec_storage_present: 0})),
			NOW_MS,
		);
		expect(result.code).toBe(0);
	});

	test('is UNKNOWN when the schema predates the recording block', async () => {
		const feed = healthyFeed() as Record<string, unknown>;
		delete feed.rec_storage_present;
		delete feed.rec_storage_slot;
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(JSON.stringify(feed)),
			NOW_MS,
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('schema <2');
	});

	test('is UNKNOWN when a mounted card reports no size', async () => {
		// This busybox reports 0 blocks for tmpfs; treating that as "0 KB free"
		// would be a false alarm, so it is unreadable instead.
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(
				jsonFeed({
					rec_storage_present: 1,
					rec_storage_total_kb: 0,
					rec_storage_used_pct: 0,
				}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('usage unreadable');
	});

	test('is CRITICAL at the critical recording threshold', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(
				jsonFeed({rec_storage_used_pct: 98, rec_storage_avail_kb: 100_000}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('rec_storage(mmc0) 98% >= 97%');
	});

	test('is WARNING at the warning recording threshold', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(
				jsonFeed({rec_storage_used_pct: 92, rec_storage_avail_kb: 1_000_000}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(1);
		expect(result.message).toContain('rec_storage(mmc0) 92% >= 90%');
	});

	test('warns on low absolute headroom even at a low percentage', async () => {
		// A huge card can look healthy by percentage while only a few MB remain.
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(
				jsonFeed({rec_storage_used_pct: 10, rec_storage_avail_kb: 1024}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(1);
		expect(result.message).toContain('only 1024 KB free');
	});

	test('does not warn on headroom when the card reports no free figure', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(
				jsonFeed({
					rec_storage_used_pct: 10,
					rec_storage_total_kb: 32_000_000,
					rec_storage_avail_kb: null,
				}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(0);
	});
});

describe('checkAnjoyCamera - percentage thresholds', () => {
	const cases: Array<[string, string, number, number, number]> = [
		['temperature_c', 'temperature', 86, 2, 85],
		['cpu_used_pct', 'cpu', 90, 1, 85],
		['mem_used_pct', 'memory', 96, 2, 95],
		['nand_used_pct', 'nand', 85, 1, 80],
	];

	test.each(cases)(
		'%s at %p is CRITICAL or WARNING against its limit',
		async (feedKey, label, value, expected, limit) => {
			const result = await checkAnjoyCamera(
				{host: 'cam'},
				feedReturning(jsonFeed({[feedKey]: value})),
				NOW_MS,
			);
			expect(result.code).toBe(expected);
			expect(result.message).toContain(`${label} ${value}% >= ${limit}%`);
		},
	);

	test('reports an unavailable metric without inventing a value', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed({temperature_c: null})),
			NOW_MS,
		);
		// The metric is missing, so it must be named rather than read as OK.
		expect(result.message).toContain('temperature unavailable');
		// A missing metric alone does not change the status.
		expect(result.code).toBe(0);
		expect(
			result.performanceData?.find((entry) => entry.label === 'temperature'),
		).toBeUndefined();
	});

	test('aggregates several findings into the worst status', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(
				jsonFeed({temperature_c: 90, cpu_used_pct: 90, mem_used_pct: 90}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('temperature 90%');
		expect(result.message).toContain('cpu 90%');
		expect(result.message).toContain('memory 90%');
	});
});

describe('checkAnjoyCamera - security rates (schema 3/4)', () => {
	test('is WARNING at the login-attempt threshold', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed({login_attempts_5m: 25})),
			NOW_MS,
		);
		expect(result.code).toBe(1);
		expect(result.message).toContain(
			'login attempts 25/5min >= 20 (possible brute force)',
		);
	});

	test('is CRITICAL at the password-reset threshold', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed({pwreset_5m: 2})),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain(
			'password reset(s) 2/5min >= 2 (possible account takeover)',
		);
	});

	test('warns on the first telnet recovery login', async () => {
		// Recovery telnet is off unless the SD flag enables it, so any attempt
		// in the window is worth a look.
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed({telnet_attempts_5m: 1})),
			NOW_MS,
		);
		expect(result.code).toBe(1);
		expect(result.message).toContain(
			'telnet recovery logins 1/5min >= 1 (recovery access)',
		);
	});

	test('is CRITICAL at the telnet burst threshold', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed({telnet_attempts_5m: 3})),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain(
			'telnet recovery logins 3/5min >= 3 (recovery access)',
		);
	});

	test('emits the rate counters as perfdata', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed()),
			NOW_MS,
		);
		const telnet = result.performanceData?.find(
			(entry) => entry.label === 'telnet_attempts_5m',
		);
		expect(telnet).toEqual(
			expect.objectContaining({value: '0', warn: '1', crit: '3', min: '0'}),
		);
	});

	test('honours a coerced string threshold from the query layer', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam', warnTelnet: '5', critTelnet: '10'},
			feedReturning(jsonFeed({telnet_attempts_5m: 6})),
			NOW_MS,
		);
		expect(result.code).toBe(1);
		expect(result.message).toContain('telnet recovery logins 6/5min >= 5');
	});

	test('notes an absent rate without changing the status', async () => {
		// A pre-schema-3 feed must stay usable: the missing detector is named,
		// but it never degrades the verdict on its own.
		const feed = healthyFeed() as Record<string, unknown>;
		delete feed.login_attempts_5m;
		delete feed.pwreset_5m;
		delete feed.telnet_attempts_5m;
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(JSON.stringify(feed)),
			NOW_MS,
		);
		expect(result.code).toBe(0);
		expect(result.message).toContain('login rate unknown');
		expect(result.message).toContain('pwreset rate unknown');
		expect(result.message).toContain('telnet rate unknown');
	});
});

describe('checkAnjoyCamera - required services', () => {
	test('is CRITICAL when the web server is down', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed({web_server_running: 0})),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('web_server NOT running');
	});

	test('is CRITICAL when the watchdog is not armed', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed({watchdog_running: 0})),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('watchdog NOT running');
	});

	test('is UNKNOWN when a service state is not reported', async () => {
		const feed = healthyFeed() as Record<string, unknown>;
		delete feed.web_server_running;
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(JSON.stringify(feed)),
			NOW_MS,
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('web_server state unknown');
	});
});

describe('checkAnjoyCamera - liveness dominates', () => {
	test('is CRITICAL when the generator has stopped', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed({generated_epoch: NOW_EPOCH - 600})),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('STALE');
	});

	test('is UNKNOWN when the feed timestamp is in the future', async () => {
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(jsonFeed({generated_epoch: NOW_EPOCH + 600})),
			NOW_MS,
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('ahead');
	});

	test('a CRITICAL finding outranks an UNKNOWN one regardless of order', async () => {
		// Nagios codes are numeric but UNKNOWN (3) is numerically above CRITICAL
		// (2): a plain `>` comparison would let the unreported metric mask the
		// definite failure, and the outcome would depend on check order. Here the
		// stale feed (CRITICAL) is found first and the missing web_server state
		// (UNKNOWN) second - the aggregate must stay CRITICAL.
		const feed = healthyFeed() as Record<string, unknown>;
		delete feed.web_server_running;
		feed.generated_epoch = NOW_EPOCH - 600;
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(JSON.stringify(feed)),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('STALE');
		expect(result.message).toContain('web_server state unknown');
	});

	test('a CRITICAL finding outranks an UNKNOWN staleness verdict too', async () => {
		// Reverse order: the UNKNOWN comes first (future timestamp), the
		// CRITICAL (watchdog down) after it via bump().
		const result = await checkAnjoyCamera(
			{host: 'cam'},
			feedReturning(
				jsonFeed({generated_epoch: NOW_EPOCH + 600, watchdog_running: 0}),
			),
			NOW_MS,
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('watchdog NOT running');
	});
});

describe('buildFeedUrl - missing host', () => {
	test('produces a scheme-only URL when no host is given', () => {
		// checkAnjoyCamera rejects an absent host before building the URL, so
		// this covers the defensive default when the helper is used directly.
		expect(buildFeedUrl({})).toBe('https:///nagios.txt');
	});
});
