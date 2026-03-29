import {Request} from 'express';
import {getClientIpFromRequest, normalizeIp} from './request-ip';

const makeReq = (
	overrides: Partial<{
		headers: Record<string, string | string[] | undefined>;
		ip: string | undefined;
		socket: {remoteAddress?: string};
	}> = {},
): Request =>
	({
		headers: {},
		ip: '127.0.0.1',
		socket: {remoteAddress: '127.0.0.1'},
		...overrides,
	}) as unknown as Request;

describe('request-ip helpers', () => {
	test('normalizeIp trims and removes IPv4-mapped IPv6 prefix', () => {
		expect(normalizeIp(' ::ffff:127.0.0.1 ')).toBe('127.0.0.1');
	});

	test('uses first x-forwarded-for value when it is a string list', () => {
		const ip = getClientIpFromRequest(
			makeReq({
				headers: {'x-forwarded-for': '203.0.113.10, 198.51.100.20'},
				ip: undefined,
			}),
		);
		expect(ip).toBe('203.0.113.10');
	});

	test('uses first x-forwarded-for entry when header is an array', () => {
		const ip = getClientIpFromRequest(
			makeReq({
				headers: {'x-forwarded-for': ['198.51.100.7', '198.51.100.8']},
				ip: undefined,
			}),
		);
		expect(ip).toBe('198.51.100.7');
	});

	test('falls back to req.ip when x-forwarded-for array first value is blank', () => {
		const ip = getClientIpFromRequest(
			makeReq({
				headers: {'x-forwarded-for': ['   ']},
				ip: '10.0.0.9',
			}),
		);
		expect(ip).toBe('10.0.0.9');
	});

	test('falls back to socket remoteAddress and then unknown', () => {
		expect(
			getClientIpFromRequest(
				makeReq({
					ip: undefined,
					socket: {remoteAddress: '192.0.2.4'},
				}),
			),
		).toBe('192.0.2.4');

		expect(
			getClientIpFromRequest(
				makeReq({
					ip: undefined,
					socket: {remoteAddress: undefined},
				}),
			),
		).toBe('unknown');
	});

	// ──────────────── normalizeIp edge cases ────────────────

	test('normalizeIp returns empty string when given only whitespace', () => {
		expect(normalizeIp('   ')).toBe('');
	});

	test('normalizeIp leaves a plain IPv6 address unchanged', () => {
		expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
	});

	test('normalizeIp does not double-strip: ::ffff: prefix removed only once', () => {
		// Only the outermost ::ffff: is relevant; inner value returned as-is
		expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
	});

	test('normalizeIp handles ::ffff: with no trailing IP (returns empty)', () => {
		expect(normalizeIp('::ffff:')).toBe('');
	});

	test('normalizeIp returns just the trimmed value when no prefix present', () => {
		expect(normalizeIp('  10.10.10.10  ')).toBe('10.10.10.10');
	});

	// ──────────────── getClientIpFromRequest adversarial inputs ────────────────

	test('ignores x-forwarded-for with only spaces and falls back to req.ip', () => {
		const ip = getClientIpFromRequest(
			makeReq({
				headers: {'x-forwarded-for': '   '},
				ip: '10.0.0.5',
			}),
		);
		expect(ip).toBe('10.0.0.5');
	});

	test('takes the first IP in a long forwarded-for chain', () => {
		const ip = getClientIpFromRequest(
			makeReq({
				headers: {
					'x-forwarded-for': '198.51.100.1, 10.0.0.1, 172.16.0.1, 192.168.0.1',
				},
			}),
		);
		expect(ip).toBe('198.51.100.1');
	});

	test('normalizes IPv4-mapped IPv6 first entry from forwarded-for chain', () => {
		const ip = getClientIpFromRequest(
			makeReq({
				headers: {'x-forwarded-for': '::ffff:203.0.113.42, 10.0.0.1'},
			}),
		);
		expect(ip).toBe('203.0.113.42');
	});
});
