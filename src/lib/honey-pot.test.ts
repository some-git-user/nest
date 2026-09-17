import {Request} from 'express';
import {
	UNKNOWN_IP,
	getHoneypotStats,
	recordHoneypotSignal,
	recordNetworkProbeSignal,
	resetHoneypotSignals,
	resolveSocketIp,
	stashSocketIp,
} from './honey-pot';
import {logger} from './logger';

// pushSignal persists every probe via logger.warn; without this the suite would
// append to the real log file on every signal.
jest.mock('./logger');

const makeReq = (
	overrides: Partial<{
		headers: Record<string, string | string[] | undefined>;
		originalUrl: string;
		url: string;
		ip: string | undefined;
		socket: {remoteAddress?: string};
	}> = {},
): Request =>
	({
		headers: {'user-agent': 'jest'},
		originalUrl: '/test',
		url: '/test',
		ip: '127.0.0.1',
		socket: {remoteAddress: '127.0.0.1'},
		...overrides,
	}) as unknown as Request;

describe('honey-pot lib', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		resetHoneypotSignals();
	});
	afterEach(() => resetHoneypotSignals());

	describe('normalizePath', () => {
		test('returns "/" when URL has no path component (query-string only)', () => {
			// originalUrl falsy → falls back to url; url starts with '?' so pathOnly is empty → '/' fallback
			recordHoneypotSignal(
				makeReq({originalUrl: '', url: '?q=1'}),
				'unknown-route',
			);
			expect(getHoneypotStats().latest?.path).toBe('/');
		});

		test('returns "/" when both originalUrl and url are empty', () => {
			recordHoneypotSignal(
				makeReq({originalUrl: '', url: ''}),
				'unknown-route',
			);
			expect(getHoneypotStats().latest?.path).toBe('/');
		});
	});

	describe('getClientIp', () => {
		test('ignores a spoofed x-forwarded-for array and uses req.ip', () => {
			recordHoneypotSignal(
				makeReq({
					headers: {
						'user-agent': 'jest',
						'x-forwarded-for': ['10.1.2.3', '10.9.9.9'],
					},
					ip: '8.8.8.8',
				}),
				'unknown-route',
			);
			expect(getHoneypotStats().latest?.ip).toBe('8.8.8.8');
		});

		test('falls through whitespace-only x-forwarded-for to req.ip', () => {
			recordHoneypotSignal(
				makeReq({
					headers: {'user-agent': 'jest', 'x-forwarded-for': ' '},
					ip: '9.9.9.9',
				}),
				'unknown-route',
			);
			expect(getHoneypotStats().latest?.ip).toBe('9.9.9.9');
		});

		test('falls back to req.socket.remoteAddress when req.ip is absent', () => {
			recordHoneypotSignal(
				makeReq({ip: undefined, socket: {remoteAddress: '192.168.1.1'}}),
				'unknown-route',
			);
			expect(getHoneypotStats().latest?.ip).toBe('192.168.1.1');
		});

		test('returns "unknown" when both req.ip and socket.remoteAddress are absent', () => {
			recordHoneypotSignal(
				makeReq({ip: undefined, socket: {remoteAddress: undefined}}),
				'unknown-route',
			);
			expect(getHoneypotStats().latest?.ip).toBe('unknown');
		});
	});

	describe('path fallback', () => {
		test('defaults to "/" when both originalUrl and url are empty', () => {
			recordHoneypotSignal(
				makeReq({originalUrl: '', url: ''}),
				'unknown-route',
			);
			expect(getHoneypotStats().latest?.path).toBe('/');
		});

		test('records "unknown" user agent when the header is absent', () => {
			recordHoneypotSignal(makeReq({headers: {}}), 'unknown-route');
			// The user agent is not part of the stats snapshot, but the signal is
			// persisted through logger.warn, which is where the fallback surfaces.
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('user_agent=unknown'),
			);
		});
	});

	describe('persistence', () => {
		test('writes every signal to the log so evidence outlives the window', () => {
			recordHoneypotSignal(
				makeReq({originalUrl: '/.env', ip: '203.0.113.9'}),
				'unknown-route',
			);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('ip=203.0.113.9'),
			);
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining('path=/.env'),
			);
		});
	});

	describe('suspicious classification', () => {
		test('marks ip-denied as suspicious even on a benign path', () => {
			recordHoneypotSignal(makeReq({originalUrl: '/nagios'}), 'ip-denied');
			expect(getHoneypotStats().suspiciousHits).toBe(1);
		});

		test('marks rate-limited as suspicious even on a benign path', () => {
			recordHoneypotSignal(makeReq({originalUrl: '/nagios'}), 'rate-limited');
			expect(getHoneypotStats().suspiciousHits).toBe(1);
		});

		test('marks a scanner path on unknown-route as suspicious', () => {
			recordHoneypotSignal(
				makeReq({originalUrl: '/wp-login.php'}),
				'unknown-route',
			);
			expect(getHoneypotStats().suspiciousHits).toBe(1);
		});

		test('does not flag the legitimate /admin mount path', () => {
			recordHoneypotSignal(makeReq({originalUrl: '/admin'}), 'unknown-route');
			expect(getHoneypotStats().suspiciousHits).toBe(0);
		});

		test('flags an admin scanner variant', () => {
			recordHoneypotSignal(
				makeReq({originalUrl: '/admin/login'}),
				'unknown-route',
			);
			expect(getHoneypotStats().suspiciousHits).toBe(1);
		});

		test('leaves a plain unknown route non-suspicious', () => {
			recordHoneypotSignal(makeReq({originalUrl: '/nope'}), 'unknown-route');
			expect(getHoneypotStats().suspiciousHits).toBe(0);
		});
	});

	describe('stashSocketIp', () => {
		test('stashes a readable remoteAddress onto the socket', () => {
			const socket: {remoteAddress?: string; __nestRemoteIp?: string} = {
				remoteAddress: '203.0.113.7',
			};
			stashSocketIp(socket);
			expect(socket.__nestRemoteIp).toBe('203.0.113.7');
		});

		test('ignores a non-object socket', () => {
			expect(() => stashSocketIp(undefined)).not.toThrow();
			expect(() => stashSocketIp('nope')).not.toThrow();
		});

		test('leaves the stash unset when remoteAddress is missing', () => {
			const socket: {remoteAddress?: string; __nestRemoteIp?: string} = {};
			stashSocketIp(socket);
			expect(socket.__nestRemoteIp).toBeUndefined();
		});
	});

	describe('resolveSocketIp', () => {
		test('prefers the stashed address over a destroyed socket address', () => {
			expect(
				resolveSocketIp({__nestRemoteIp: '203.0.113.1', remoteAddress: ''}),
			).toBe('203.0.113.1');
		});

		test('falls back to remoteAddress when nothing was stashed', () => {
			expect(resolveSocketIp({remoteAddress: '203.0.113.2'})).toBe(
				'203.0.113.2',
			);
		});

		test('walks the _parent chain of a failed TLSSocket', () => {
			const parent = {remoteAddress: '203.0.113.3'};
			const child = {remoteAddress: undefined, _parent: parent};
			expect(resolveSocketIp(child)).toBe('203.0.113.3');
		});

		test('normalizes an IPv4-mapped IPv6 address', () => {
			expect(resolveSocketIp({remoteAddress: '::ffff:203.0.113.4'})).toBe(
				'203.0.113.4',
			);
		});

		test('returns the placeholder for a non-object socket', () => {
			expect(resolveSocketIp(null)).toBe(UNKNOWN_IP);
			expect(resolveSocketIp('nope')).toBe(UNKNOWN_IP);
		});

		test('returns the placeholder when no address is found in the chain', () => {
			expect(resolveSocketIp({remoteAddress: undefined})).toBe(UNKNOWN_IP);
		});

		test('terminates on a cyclic _parent chain', () => {
			const socket: {remoteAddress?: string; _parent?: unknown} = {
				remoteAddress: undefined,
			};
			socket._parent = socket;
			expect(resolveSocketIp(socket)).toBe(UNKNOWN_IP);
		});
	});

	describe('recordNetworkProbeSignal', () => {
		test('records the resolved address for a probe socket', () => {
			const recorded = recordNetworkProbeSignal(
				{remoteAddress: '203.0.113.10'},
				'http-client-error',
			);
			expect(recorded).toBe(true);
			expect(getHoneypotStats().latest?.ip).toBe('203.0.113.10');
		});

		test('stores the placeholder when the socket has no address', () => {
			recordNetworkProbeSignal({}, 'http-client-error');
			expect(getHoneypotStats().latest?.ip).toBe(UNKNOWN_IP);
		});

		test('counts one socket only once across clientError and tlsClientError', () => {
			const socket = {remoteAddress: '203.0.113.11'};
			expect(recordNetworkProbeSignal(socket, 'http-client-error')).toBe(true);
			expect(recordNetworkProbeSignal(socket, 'tls-client-error')).toBe(false);
			expect(getHoneypotStats().totalHits).toBe(1);
		});

		test('does not dedupe non-object sockets', () => {
			expect(recordNetworkProbeSignal('a', 'http-client-error')).toBe(true);
			expect(recordNetworkProbeSignal('b', 'http-client-error')).toBe(true);
			expect(getHoneypotStats().totalHits).toBe(2);
		});
	});

	describe('UNKNOWN_IP exclusion', () => {
		test('keeps unattributed probes out of per-IP aggregates', () => {
			// Five unattributed protocol errors would otherwise look like a port
			// scan from a single fabricated "unknown" attacker.
			for (let i = 0; i < 5; i++) {
				recordNetworkProbeSignal({}, 'tls-client-error');
			}
			const stats = getHoneypotStats();
			expect(stats.totalHits).toBe(5);
			expect(stats.protocolErrorHits).toBe(5);
			expect(stats.uniqueIps).toBe(0);
			expect(stats.probablePortScanIps).toBe(0);
			expect(stats.mostActiveIp).toBe('unknown');
		});

		test('still attributes a real probe alongside unattributed ones', () => {
			recordNetworkProbeSignal(
				{remoteAddress: '203.0.113.20'},
				'tls-client-error',
			);
			recordNetworkProbeSignal({}, 'tls-client-error');
			const stats = getHoneypotStats();
			expect(stats.uniqueIps).toBe(1);
			expect(stats.mostActiveIp).toBe('203.0.113.20');
		});
	});

	describe('pruneSignals', () => {
		test('removes signals older than the 5-minute window', () => {
			recordHoneypotSignal(makeReq(), 'unknown-route');
			expect(getHoneypotStats().totalHits).toBe(1);

			const futureNow = Date.now() + 6 * 60 * 1000;
			expect(getHoneypotStats(futureNow).totalHits).toBe(0);
		});

		test('caps the signal buffer at 1000 entries', () => {
			for (let i = 0; i < 1001; i++) {
				recordNetworkProbeSignal(
					{remoteAddress: `${i % 256}.0.0.1`},
					'tls-client-error',
				);
			}
			expect(getHoneypotStats().totalHits).toBeLessThanOrEqual(1000);
		});
	});

	describe('mostActiveIp', () => {
		test('returns "unknown" when no signals have been recorded', () => {
			expect(getHoneypotStats().mostActiveIp).toBe('unknown');
		});

		test('flags an IP that walks many distinct paths as a probable scan', () => {
			// PROBABLE_SCAN_UNIQUE_PATHS_PER_IP distinct paths from one address.
			for (let i = 0; i < 6; i++) {
				recordHoneypotSignal(
					makeReq({originalUrl: `/scan-${i}`, ip: '4.4.4.4'}),
					'unknown-route',
				);
			}
			const stats = getHoneypotStats();
			expect(stats.probableScanIps).toBe(1);
			expect(stats.maxUniquePathsFromSingleIp).toBe(6);
		});

		test('returns the IP that contributed the most signals', () => {
			recordNetworkProbeSignal({remoteAddress: '5.5.5.5'}, 'tls-client-error');
			expect(getHoneypotStats().mostActiveIp).toBe('5.5.5.5');
		});
	});

	describe('latest', () => {
		test('is undefined when no signals have been recorded', () => {
			expect(getHoneypotStats().latest).toBeUndefined();
		});

		test('reflects the most recent signal', () => {
			recordHoneypotSignal(makeReq({originalUrl: '/probe'}), 'honeypot-route');
			const stats = getHoneypotStats();
			expect(stats.latest?.path).toBe('/probe');
			expect(stats.latest?.reason).toBe('honeypot-route');
		});
	});
});
