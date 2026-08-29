import express from 'express';
import request from 'supertest';
import {createCsrfGuardMiddleware} from './csrf-guard';
import {HttpStatusCodes} from './http-status-codes';

type NagiosBody = {message?: string};

/**
 * Minimal request/response doubles. Header values are typed loosely on purpose:
 * Node lowercases them and may deliver an array, and the guard has to survive
 * values that are neither.
 */
type GuardReq = {method: string; headers: Record<string, unknown>};
type GuardRes = {
	status: (code: number) => {send: (body: unknown) => unknown};
};

const invoke = (req: GuardReq) => {
	const middleware = createCsrfGuardMiddleware();
	const send = jest.fn();
	const status = jest.fn(() => ({send}));
	const next = jest.fn();

	middleware(req as never, {status} as never, next);

	return {send, status, next};
};

describe('csrf guard middleware', () => {
	// ─────────────────────── Safe methods are never guarded ───────────────────────

	test('lets a GET through without any browser headers', () => {
		const {next, status} = invoke({
			method: 'GET',
			headers: {host: 'nest.example'},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	test('lets a GET carrying a cross-site Sec-Fetch-Site through', () => {
		const {next, status} = invoke({
			method: 'GET',
			headers: {host: 'nest.example', 'sec-fetch-site': 'cross-site'},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	test('lets a HEAD through', () => {
		const {next, status} = invoke({
			method: 'HEAD',
			headers: {host: 'nest.example'},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	// ───────────────────── Non-browser clients stay invisible ─────────────────────

	test('lets a POST with neither Origin nor Sec-Fetch-Site through', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {host: 'nest.example'},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	test('treats an empty repeated header as absent', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {host: 'nest.example', origin: [], 'sec-fetch-site': []},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	test('ignores a header value that is neither a string nor an array', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {host: 'nest.example', origin: 42},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	// ─────────────────────────── Sec-Fetch-Site checks ───────────────────────────

	test('rejects a POST marked cross-site', () => {
		const {next, status, send} = invoke({
			method: 'POST',
			headers: {
				host: 'nest.example',
				origin: 'https://nest.example',
				'sec-fetch-site': 'cross-site',
			},
		});
		expect(next).not.toHaveBeenCalled();
		expect(status).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
		expect(String((send.mock.calls[0] as [NagiosBody])[0].message)).toContain(
			'cross-site',
		);
	});

	test('matches Sec-Fetch-Site case-insensitively', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {
				host: 'nest.example',
				origin: 'https://nest.example',
				'sec-fetch-site': 'Cross-Site',
			},
		});
		expect(next).not.toHaveBeenCalled();
		expect(status).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
	});

	test('lets a same-site POST that carries no Origin through', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {host: 'nest.example', 'sec-fetch-site': 'same-origin'},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	// ────────────────────────────── Origin checks ──────────────────────────────

	test('rejects a POST whose Origin is another site', () => {
		const {next, status, send} = invoke({
			method: 'POST',
			headers: {host: 'nest.example', origin: 'https://evil.example'},
		});
		expect(next).not.toHaveBeenCalled();
		expect(status).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
		expect(String((send.mock.calls[0] as [NagiosBody])[0].message)).toContain(
			'origin does not match',
		);
	});

	test('accepts a POST whose Origin matches the Host header', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {host: 'nest.example', origin: 'https://nest.example'},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	test('accepts a POST whose Origin matches once the default port is stripped', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {host: 'nest.example:443', origin: 'https://nest.example'},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	test('keeps a non-default port when comparing origins', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {host: '127.0.0.1:5000', origin: 'https://127.0.0.1:5000'},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	test('rejects a POST whose Origin omits a non-default port', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {host: '127.0.0.1:5000', origin: 'https://127.0.0.1'},
		});
		expect(next).not.toHaveBeenCalled();
		expect(status).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
	});

	test('uses the first value of a repeated Origin header', () => {
		const {next, status} = invoke({
			method: 'POST',
			headers: {
				host: 'nest.example',
				origin: ['https://nest.example', 'https://evil.example'],
			},
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(status).not.toHaveBeenCalled();
	});

	// ────────────────────────── End-to-end over HTTP ──────────────────────────

	const makeApp = () => {
		const app = express();
		app.use(createCsrfGuardMiddleware());
		app.get('/ok', (_req, res) =>
			res.status(HttpStatusCodes.OK).send({ok: true}),
		);
		app.post('/ok', (_req, res) =>
			res.status(HttpStatusCodes.OK).send({ok: true}),
		);
		return app;
	};

	test('allows a curl-style POST end to end', async () => {
		const res = await request(makeApp()).post('/ok');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	test('rejects a cross-site browser POST end to end', async () => {
		const res = await request(makeApp())
			.post('/ok')
			.set('Origin', 'https://evil.example')
			.set('Sec-Fetch-Site', 'cross-site');
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
		expect(String((res.body as NagiosBody).message)).toContain('cross-site');
	});

	test('rejects a same-tab-looking POST forged from another origin', async () => {
		const res = await request(makeApp())
			.post('/ok')
			.set('Host', 'nest.example')
			.set('Origin', 'https://evil.example');
		expect(res.status).toBe(HttpStatusCodes.FORBIDDEN);
	});

	test('allows a same-origin browser POST end to end', async () => {
		const res = await request(makeApp())
			.post('/ok')
			.set('Host', 'nest.example')
			.set('Origin', 'https://nest.example')
			.set('Sec-Fetch-Site', 'same-origin');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});

	test('allows a cross-site GET end to end', async () => {
		const res = await request(makeApp())
			.get('/ok')
			.set('Origin', 'https://evil.example')
			.set('Sec-Fetch-Site', 'cross-site');
		expect(res.status).toBe(HttpStatusCodes.OK);
	});
});
