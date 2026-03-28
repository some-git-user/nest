import {Request} from 'express';
import {
	getHoneypotStats,
	recordHoneypotSignal,
	recordNetworkProbeSignal,
	resetHoneypotSignals,
} from './honey-pot';

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
	beforeEach(() => resetHoneypotSignals());
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
		test('uses first entry from array x-forwarded-for header', () => {
			recordHoneypotSignal(
				makeReq({
					headers: {
						'user-agent': 'jest',
						'x-forwarded-for': ['10.1.2.3', '10.9.9.9'],
					},
					ip: undefined,
				}),
				'unknown-route',
			);
			expect(getHoneypotStats().latest?.ip).toBe('10.1.2.3');
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

	describe('recordNetworkProbeSignal', () => {
		test('stores "unknown" as ip when the provided ip is an empty string', () => {
			recordNetworkProbeSignal('', 'http-client-error');
			expect(getHoneypotStats().latest?.ip).toBe('unknown');
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
				recordNetworkProbeSignal(`${i % 256}.0.0.1`, 'tls-client-error');
			}
			expect(getHoneypotStats().totalHits).toBeLessThanOrEqual(1000);
		});
	});

	describe('mostActiveIp', () => {
		test('returns "unknown" when no signals have been recorded', () => {
			expect(getHoneypotStats().mostActiveIp).toBe('unknown');
		});

		test('returns the IP that contributed the most signals', () => {
			recordNetworkProbeSignal('5.5.5.5', 'tls-client-error');
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
