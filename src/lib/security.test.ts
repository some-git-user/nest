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
});
