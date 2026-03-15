import {Request, Response} from 'express';
import {createRequire} from 'module';
import {logger} from '../lib/logger';
import {createPluginRouteHandler} from './dynamic-routes';
import {
	buildInvalidCodeResponse,
	clearPluginRequireCache,
	getPluginFunction,
	isKnownNagiosCode,
	normalizePluginResult,
	parseUrlParams,
} from './dynamic-routes/helpers';

jest.mock('module', () => ({
	createRequire: jest.fn(),
}));

jest.mock('../config/env', () => ({
	env: {
		HOST: 'localhost',
		PORT: 5000,
	},
}));

jest.mock('../lib/logger', () => ({
	logger: {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
	},
}));

jest.mock('./dynamic-routes/helpers', () => ({
	clearPluginRequireCache: jest.fn(),
	getPluginFunction: jest.fn(),
	isKnownNagiosCode: jest.fn(),
	normalizePluginResult: jest.fn(),
	parseUrlParams: jest.fn(),
	buildInvalidCodeResponse: jest.fn(),
}));

const createMockRes = () => {
	const res = {
		headersSent: false,
		status: jest.fn().mockReturnThis(),
		send: jest.fn().mockReturnThis(),
	};
	return res as unknown as Response;
};

describe('createPluginRouteHandler', () => {
	afterEach(() => {
		jest.clearAllMocks();
	});

	test('returns 500 when plugin export function is missing', async () => {
		const requireFn = jest.fn().mockReturnValue({});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(undefined);

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test'};
		const res = createMockRes();

		await handler(req as Request, res);

		expect(clearPluginRequireCache).toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledWith('Plugin must export a function');
		expect(res.status as unknown as jest.Mock).toHaveBeenCalledWith(500);
		expect(res.send as unknown as jest.Mock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Plugin /tmp/check.js must export a function',
				code: 3,
			}),
		);
	});

	test('returns early when headers were already sent', async () => {
		const requireFn = jest.fn().mockReturnValue({check: jest.fn()});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(async () => ({ok: true}));
		(parseUrlParams as jest.Mock).mockReturnValue({});
		(normalizePluginResult as jest.Mock).mockReturnValue({
			message: 'ok',
			code: 0,
			performanceData: undefined,
		});

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test'};
		const res = createMockRes();
		(res as unknown as {headersSent: boolean}).headersSent = true;

		await handler(req as Request, res);

		expect(res.send as unknown as jest.Mock).not.toHaveBeenCalled();
		expect(res.status as unknown as jest.Mock).not.toHaveBeenCalled();
	});

	test('uses unknown-command fallback when normalized message is missing', async () => {
		const requireFn = jest.fn().mockReturnValue({check: jest.fn()});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(async () => ({ok: true}));
		(parseUrlParams as jest.Mock).mockReturnValue({});
		(normalizePluginResult as jest.Mock).mockReturnValue({
			message: undefined,
			code: 0,
			performanceData: undefined,
		});
		(isKnownNagiosCode as jest.Mock).mockReturnValue(true);

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test?a=1'};
		const res = createMockRes();

		await handler(req as Request, res);

		expect(res.send as unknown as jest.Mock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Unknown command /check-test?a=1',
				code: 3,
			}),
		);
	});

	test('returns invalid-code response when normalized code is unknown', async () => {
		const requireFn = jest.fn().mockReturnValue({check: jest.fn()});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(async () => ({ok: true}));
		(parseUrlParams as jest.Mock).mockReturnValue({});
		(normalizePluginResult as jest.Mock).mockReturnValue({
			message: 'invalid',
			code: 9,
			performanceData: undefined,
		});
		(isKnownNagiosCode as jest.Mock).mockReturnValue(false);
		(buildInvalidCodeResponse as jest.Mock).mockReturnValue({
			errorMessage: 'Invalid return code "9"',
			nagiosReturn: {message: 'Invalid return code "9"', code: 3},
		});

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test?a=1'};
		const res = createMockRes();

		await handler(req as Request, res);

		expect(buildInvalidCodeResponse).toHaveBeenCalledWith(
			9,
			'/tmp/check.js',
			'/check-test',
			'localhost',
			5000,
		);
		expect(logger.warn).toHaveBeenCalledWith('Invalid return code "9"');
		expect(res.send as unknown as jest.Mock).toHaveBeenCalledWith({
			message: 'Invalid return code "9"',
			code: 3,
		});
	});

	test('formats non-object plugin errors using String(err)', async () => {
		const requireFn = jest.fn().mockReturnValue({check: jest.fn()});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(async () => {
			throw 'plain-string-error';
		});
		(parseUrlParams as jest.Mock).mockReturnValue({});

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test'};
		const res = createMockRes();

		await handler(req as Request, res);

		expect(res.status as unknown as jest.Mock).toHaveBeenCalledWith(500);
		expect(res.send as unknown as jest.Mock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Plugin /tmp/check.js failed: plain-string-error',
				code: 3,
			}),
		);
	});
});
