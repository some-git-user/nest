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

	test('allows request when no restrictions are configured', async () => {
		const app = makeApp(createAccessControlMiddleware({}));
		const res = await request(app).get('/ok');
		expect(res.status).toBe(200);
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
});
