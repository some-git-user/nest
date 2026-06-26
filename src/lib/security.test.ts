import express from 'express';
import request from 'supertest';
import {createAccessControlMiddleware} from './security';

type NagiosBody = {message?: string};

describe('security middleware', () => {
	const makeApp = (
		middleware: ReturnType<typeof createAccessControlMiddleware>,
	) => {
		const app = express();
		app.use(middleware);
		app.get('/ok', (_req, res) => res.status(200).send({ok: true}));
		return app;
	};

	test('allows loopback request when allowedIps is not configured', async () => {
		const app = makeApp(createAccessControlMiddleware({}));
		const res = await request(app).get('/ok');
		expect(res.status).toBe(200);
	});

	test('denies non-loopback request when allowedIps is not configured', async () => {
		const app = makeApp(createAccessControlMiddleware({}));
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.10');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(403);
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
		expect(res.status).toBe(401);
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
		expect(res.status).toBe(200);
	});

	test('denies request from IP not in allowlist', async () => {
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '127.0.0.2,198.51.100.1'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '127.0.0.1');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(403);
		expect(String(body.message)).toContain('not allowed');
	});

	test('allows request when x-forwarded-for first IP is in allowlist', async () => {
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '203.0.113.10'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '203.0.113.10, 198.51.100.20');
		expect(res.status).toBe(200);
	});

	test('normalizes IPv4-mapped IPv6 addresses for allowlist comparison', async () => {
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '127.0.0.1'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '::ffff:127.0.0.1');
		expect(res.status).toBe(200);
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
		expect(status).toHaveBeenCalledWith(401);
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
		expect(res.status).toBe(401);
	});

	test('rejects a key that is a suffix of the expected key', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'secret-full',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app).get('/ok').set('x-api-key', 'full');
		expect(res.status).toBe(401);
	});

	test('rejects key that differs only by character case', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'Secret',
				apiKeyHeader: 'x-api-key',
			}),
		);
		const res = await request(app).get('/ok').set('x-api-key', 'secret');
		expect(res.status).toBe(401);
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
		expect(res.status).toBe(401);
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
		expect(res.status).toBe(403);
	});

	test('allows request when both API key and IP check pass', async () => {
		const app = makeApp(
			createAccessControlMiddleware({
				apiKey: 'correct-key',
				apiKeyHeader: 'x-api-key',
				allowedIps: '10.0.0.1',
			}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '10.0.0.1')
			.set('x-api-key', 'correct-key');
		expect(res.status).toBe(200);
	});

	// ──────────────── IP allowlist with spoofed forwarded-for chain ────────────────

	test('uses only the first x-forwarded-for IP, not a later trusted one', async () => {
		// Client claims: attacker_ip, trusted_ip — only attacker_ip should count
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '10.0.0.1'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '198.51.100.99, 10.0.0.1');
		expect(res.status).toBe(403);
	});

	test('rejects IPv4-mapped IPv6 address not in allowlist', async () => {
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '10.0.0.2'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '::ffff:10.0.0.1');
		expect(res.status).toBe(403);
	});

	test('allows IPv4-mapped IPv6 address that normalizes to an allowlisted IP', async () => {
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: '10.0.0.1'}),
		);
		const res = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '::ffff:10.0.0.1');
		expect(res.status).toBe(200);
	});

	// ──────────────── Whitespace-only allowlist entries are dropped ────────────────

	test('ignores whitespace-only entries in allowedIps and enforces real restriction', async () => {
		// " , , 10.0.0.1" — only 10.0.0.1 should be the accepted IP
		const app = makeApp(
			createAccessControlMiddleware({allowedIps: ' , , 10.0.0.1'}),
		);
		const blocked = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '127.0.0.1');
		expect(blocked.status).toBe(403);

		const allowed = await request(app)
			.get('/ok')
			.set('x-forwarded-for', '10.0.0.1');
		expect(allowed.status).toBe(200);
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
		expect(res.status).toBe(200);
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
		expect(res.status).toBe(401);
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
		expect(res.status).toBe(401);
		expect(res.headers['www-authenticate']).toBeUndefined();
	});
});
