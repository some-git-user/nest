import express from 'express';
import request from 'supertest';
import * as honeyPotLib from './honey-pot';
import {HttpStatusCodes} from './http-status-codes';
import {createAccessControlMiddleware} from './security';

type NagiosBody = {message?: string};

jest.mock('./honey-pot');

describe('security middleware', () => {
	const mockRecordHoneypotSignal = jest.mocked(
		honeyPotLib.recordHoneypotSignal,
	);

	beforeEach(() => {
		jest.clearAllMocks();
	});
	const makeApp = (
		middleware: ReturnType<typeof createAccessControlMiddleware>,
	) => {
		const app = express();
		app.use(middleware);
		app.get('/ok', (_req, res) =>
			res.status(HttpStatusCodes.OK).send({ok: true}),
		);
		return app;
	};

	test('allows loopback request when allowedIps is not configured', async () => {
		const app = makeApp(createAccessControlMiddleware({}));
		const res = await request(app).get('/ok');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	test('denies a request whose real socket IP is outside the allowlist even when x-forwarded-for claims an allowed address', async () => {
		// The allowlist only contains a non-loopback address, so the real
		// loopback socket must be rejected despite the spoofed header.
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '198.51.100.10'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
		expect(String(body.message)).toContain('not allowed');
	});

	test('denies request when API key is missing', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app).get('/ok');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
		expect(String(body.message)).toContain('Unauthorized');
	});

	test('allows request when API key matches custom header', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-nest-auth',
			}),
		);
		const res = await request(app).get('/ok').set('x-nest-auth', 'secret');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	test('denies request from IP not in allowlist', async () => {
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '127.0.0.2,198.51.100.1'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '127.0.0.1');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
		expect(String(body.message)).toContain('not allowed');
	});

	test('ignores x-forwarded-for when deciding allowlist access', async () => {
		// The allowlist only contains the forwarded address, but the real socket
		// is loopback, so the request must be denied: the header cannot grant access.
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '203.0.113.10'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '203.0.113.10, 198.51.100.20');
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
	});

	test('normalizes IPv4-mapped IPv6 addresses for allowlist comparison', async () => {
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '127.0.0.1'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '::ffff:127.0.0.1');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	test('accepts API key when header value is provided as an array', () => {
		const middleware = createAccessControlMiddleware({
			apiKey: 'secret',
			apiKeyHeader: 'x-api-key',
		});
		type MiddlewareReq = {
			headers: Record<string, string[]>;
			ip: string;
			socket: {remoteAddress: string};
		};
		type MiddlewareRes = {
			status: (code: number) => {send: (body: unknown) => unknown};
		};

		const req: MiddlewareReq = {
			headers: {'x-api-key': ['secret']},
			ip: '127.0.0.1',
			socket: {remoteAddress: '127.0.0.1'},
		};
		const status = jest.fn(() => ({send: jest.fn()}));
		const res: MiddlewareRes = {status};
		const next = jest.fn();

		middleware(req as never, res as never, next);

		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	test('rejects API key when array header first value is missing', () => {
		const middleware = createAccessControlMiddleware({
			apiKey: 'secret',
			apiKeyHeader: 'x-api-key',
		});
		type MiddlewareReq = {
			headers: Record<string, string[]>;
			ip: string;
			socket: {remoteAddress: string};
		};
		type MiddlewareRes = {
			status: (code: number) => {send: (body: unknown) => unknown};
		};
		const send = jest.fn();
		const status = jest.fn(() => ({send}));
		const req: MiddlewareReq = {
			headers: {'x-api-key': []},
			ip: '127.0.0.1',
			socket: {remoteAddress: '127.0.0.1'},
		};
		const res: MiddlewareRes = {status};
		const next = jest.fn();

		middleware(req as never, res as never, next);

		expect(next).not.toHaveBeenCalled();
		expect(status).toHaveBeenCalledWith(HttpStatusCodes.UNAUTHORIZED);
		expect(send).toHaveBeenCalled();
	});

	// ──────────────── Key prefix / substring should not bypass ────────────────

	test('rejects a key that is a prefix of the expected key', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret-full',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app).get('/ok').set('x-api-key', 'secret');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
	});

	test('rejects a key that is a suffix of the expected key', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret-full',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app).get('/ok').set('x-api-key', 'full');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
	});

	test('rejects key that differs only by character case', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'Secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app).get('/ok').set('x-api-key', 'secret');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
	});

	// ──────────────── Both IP allowlist + API key configured ────────────────

	test('blocks request when IP is allowed but API key is wrong', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'correct-key',
				apiKeyHeader: 'x-api-key',
				allowedIps: '127.0.0.1',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '127.0.0.1')
			.set('x-api-key', 'wrong-key');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
	});

	test('blocks request when API key is correct but IP is not in allowlist', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'correct-key',
				apiKeyHeader: 'x-api-key',
				allowedIps: '10.0.0.1',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.1')
			.set('x-api-key', 'correct-key');
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
	});

	test('allows request when both API key and IP check pass', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'correct-key',
				apiKeyHeader: 'x-api-key',
				allowedIps: '127.0.0.1',
			}),
		);
		const res = await request(app).get('/ok').set('x-api-key', 'correct-key');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	// ──────────────── IP allowlist with spoofed forwarded-for chain ────────────────

	test('ignores a spoofed x-forwarded-for chain and uses the real socket IP', async () => {
		// Client claims a trusted address in the chain, but the real socket is
		// loopback and the allowlist only trusts 10.0.0.1, so access is denied.
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '10.0.0.1'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.99, 10.0.0.1');
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
	});

	test('rejects IPv4-mapped IPv6 address not in allowlist', async () => {
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '10.0.0.2'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '::ffff:10.0.0.1');
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
	});

	test('normalizes an IPv4-mapped IPv6 socket address for allowlist comparison', async () => {
		// The real socket normalizes to loopback, which is allowlisted; the
		// spoofed forwarded-for value is irrelevant.
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '127.0.0.1'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '::ffff:10.0.0.1');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	// ──────────────── Whitespace-only allowlist entries are dropped ────────────────

	test('ignores whitespace-only entries in allowedIps and enforces real restriction', async () => {
		// " , , 127.0.0.1" — only the loopback entry survives, matching the socket.
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: ' , , 127.0.0.1'}),
		);
		const allowed = await request(app).get('/ok');
		expect(allowed.status).toBe(HttpStatusCodes.OK);

		const blockedApp = makeApp(
			createAccessControlMiddleware({allowedIps: ' , , 10.0.0.1'}),
		);
		const blocked = await request(blockedApp).get('/ok');
		expect(blocked.status).toBe(HttpStatusCodes.FORBIDDEN);
	});

	// ──────────────── HTTP Basic Auth ────────────────

	test('accepts API key supplied as the password in an HTTP Basic Auth header', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const credentials = Buffer.from(':secret').toString('base64');
		const res = await request(app)
			.get('/ok')
			.set('Authorization', `Basic ${credentials}`);
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	// ──────────────── WWW-Authenticate header for browser requests ────────────────

	test('sets WWW-Authenticate header when a browser sends an invalid API key', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('Accept', 'text/html,application/xhtml+xml');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
		expect(res.headers['www-authenticate']).toContain('Basic');
	});

	test('does not set WWW-Authenticate header for non-browser requests', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app).get('/ok').set('Accept', 'application/json');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
		expect(res.headers['www-authenticate']).toBeUndefined();
	});

	// ──────────────── Honey-pot Recording ────────────────

	test('records honeypot signal when API key is missing', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
		expect(mockRecordHoneypotSignal).toHaveBeenCalledTimes(1);
		expect(mockRecordHoneypotSignal).toHaveBeenCalledWith(
			expect.any(Object),
			'honeypot-route',
		);
	});

	test('records honeypot signal when API key is wrong', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10')
			.set('x-api-key', 'wrong-key');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
		expect(mockRecordHoneypotSignal).toHaveBeenCalledTimes(1);
		expect(mockRecordHoneypotSignal).toHaveBeenCalledWith(
			expect.any(Object),
			'honeypot-route',
		);
	});

	test('records honeypot signal when API key has wrong case', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'Secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10')
			.set('x-api-key', 'secret');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
		expect(mockRecordHoneypotSignal).toHaveBeenCalledTimes(1);
		expect(mockRecordHoneypotSignal).toHaveBeenCalledWith(
			expect.any(Object),
			'honeypot-route',
		);
	});

	test('records honeypot signal when Basic Auth password is wrong', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const credentials = Buffer.from(':wrong-password').toString('base64');
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10')
			.set('Authorization', `Basic ${credentials}`);
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
		expect(mockRecordHoneypotSignal).toHaveBeenCalledTimes(1);
		expect(mockRecordHoneypotSignal).toHaveBeenCalledWith(
			expect.any(Object),
			'honeypot-route',
		);
	});

	test('does not record honeypot signal when API key is correct', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
				allowedIps: '127.0.0.1',
			}),
		);
		const res = await request(app).get('/ok').set('x-api-key', 'secret');
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(mockRecordHoneypotSignal).not.toHaveBeenCalled();
	});

	test('does not record honeypot signal when no API key is configured', async () => {
		const app = makeApp(createAccessControlMiddleware({}));
		const res = await request(app).get('/ok');
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(mockRecordHoneypotSignal).not.toHaveBeenCalled();
	});

	test('does not record honeypot signal when API key is empty string', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: '',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app).get('/ok');
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(mockRecordHoneypotSignal).not.toHaveBeenCalled();
	});

	test('records honeypot signal only once for single failed auth attempt', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10')
			.set('x-api-key', 'wrong-key');
		expect(res.status).toBe(HttpStatusCodes.UNAUTHORIZED);
		expect(mockRecordHoneypotSignal).toHaveBeenCalledTimes(1);
	});

	test('records honeypot signal for each failed auth attempt', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
			}),
		);

		// First failed attempt
		await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10')
			.set('x-api-key', 'wrong-key-1');
		expect(mockRecordHoneypotSignal).toHaveBeenCalledTimes(1);

		// Second failed attempt
		await request(app)
			.get('/ok')
			.set('x-forwarded-for', '203.0.113.50')
			.set('x-api-key', 'wrong-key-2');
		expect(mockRecordHoneypotSignal).toHaveBeenCalledTimes(2);

		// Third failed attempt (missing key)
		await request(app).get('/ok').set('x-forwarded-for', '198.51.100.20');
		expect(mockRecordHoneypotSignal).toHaveBeenCalledTimes(3);
	});

	// ──────────────── Wildcard IP Allowlist ────────────────

	test('allows all IPs when wildcard (*) is configured', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				allowedIps: '*',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	test('allows all IPs when wildcard (*) is configured with API key', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret',
				apiKeyHeader: 'x-api-key',
				allowedIps: '*',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '203.0.113.50')
			.set('x-api-key', 'secret');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	test('allows any IPv4 address when wildcard (*) is configured', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				allowedIps: '*',
			}),
		);
		const res1 = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '192.168.1.100');
		expect(res1.status).toBe(HttpStatusCodes.OK);

		const res2 = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '10.0.0.1');
		expect(res2.status).toBe(HttpStatusCodes.OK);

		const res3 = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '8.8.8.8');
		expect(res3.status).toBe(HttpStatusCodes.OK);
	});

	test('allows any IPv6 address when wildcard (*) is configured', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				allowedIps: '*',
			}),
		);
		const res1 = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '2001:db8::1');
		expect(res1.status).toBe(HttpStatusCodes.OK);

		const res2 = await request(app).get('/ok').set('x-forwarded-for', '::1');
		expect(res2.status).toBe(HttpStatusCodes.OK);
	});

	test('rejects request when wildcard (*) is combined with specific IPs', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				allowedIps: '127.0.0.1,*',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
		expect(String(body.message)).toContain('invalid ALLOWED_IPS configuration');
	});

	test('rejects request when specific IPs are combined with wildcard (*)', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				allowedIps: '*,10.0.0.1',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
		expect(String(body.message)).toContain('invalid ALLOWED_IPS configuration');
	});

	test('handles wildcard with whitespace correctly', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				allowedIps: ' * ',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});
});
