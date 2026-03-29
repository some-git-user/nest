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

type MockResponse = {
	res: Response;
	statusMock: jest.Mock;
	sendMock: jest.Mock;
	setHeaderMock: jest.Mock;
};

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

const createMockRes = (): MockResponse => {
	const statusMock = jest.fn().mockReturnThis();
	const sendMock = jest.fn().mockReturnThis();
	const setHeaderMock = jest.fn().mockReturnThis();
	const res = {
		headersSent: false,
		status: statusMock,
		send: sendMock,
		setHeader: setHeaderMock,
	};
	return {res: res as unknown as Response, statusMock, sendMock, setHeaderMock};
};

describe('createPluginRouteHandler', () => {
	const loggerMock = logger as unknown as {
		error: jest.Mock;
		warn: jest.Mock;
	};

	afterEach(() => {
		jest.clearAllMocks();
	});

	test('returns 500 when plugin export function is missing', async () => {
		const requireFn = jest.fn().mockReturnValue({});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(undefined);

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test'};
		const {res, statusMock, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(clearPluginRequireCache).toHaveBeenCalled();
		expect(loggerMock.error).toHaveBeenCalledWith(
			'Plugin must export a function',
		);
		expect(statusMock).toHaveBeenCalledWith(500);
		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Plugin /tmp/check.js must export a function',
				code: 3,
			}),
		);
	});

	test('returns early when headers were already sent', async () => {
		const requireFn = jest.fn().mockReturnValue({check: jest.fn()});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(() =>
			Promise.resolve({ok: true}),
		);
		(parseUrlParams as jest.Mock).mockReturnValue({});
		(normalizePluginResult as jest.Mock).mockReturnValue({
			message: 'ok',
			code: 0,
			performanceData: undefined,
		});

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test'};
		const {res, statusMock, sendMock} = createMockRes();
		(res as unknown as {headersSent: boolean}).headersSent = true;

		await handler(req as Request, res);

		expect(sendMock).not.toHaveBeenCalled();
		expect(statusMock).not.toHaveBeenCalled();
	});

	test('uses unknown-command fallback when normalized message is missing', async () => {
		const requireFn = jest.fn().mockReturnValue({check: jest.fn()});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(() =>
			Promise.resolve({ok: true}),
		);
		(parseUrlParams as jest.Mock).mockReturnValue({});
		(normalizePluginResult as jest.Mock).mockReturnValue({
			message: undefined,
			code: 0,
			performanceData: undefined,
		});
		(isKnownNagiosCode as jest.Mock).mockReturnValue(true);

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test?a=1'};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Unknown command /check-test?a=1',
				code: 3,
			}),
		);
	});

	test('returns invalid-code response when normalized code is unknown', async () => {
		const requireFn = jest.fn().mockReturnValue({check: jest.fn()});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(() =>
			Promise.resolve({ok: true}),
		);
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
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(buildInvalidCodeResponse).toHaveBeenCalledWith(
			9,
			'/tmp/check.js',
			'/check-test',
			'localhost',
			5000,
		);
		expect(loggerMock.warn).toHaveBeenCalledWith('Invalid return code "9"');
		expect(sendMock).toHaveBeenCalledWith({
			message: 'Invalid return code "9"',
			code: 3,
		});
	});

	test('formats non-object plugin errors using String(err)', async () => {
		const requireFn = jest.fn().mockReturnValue({check: jest.fn()});
		(createRequire as unknown as jest.Mock).mockReturnValue(requireFn);
		(getPluginFunction as jest.Mock).mockReturnValue(() =>
			Promise.reject('plain-string-error' as unknown as Error),
		);
		(parseUrlParams as jest.Mock).mockReturnValue({});

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test'};
		const {res, statusMock, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(statusMock).toHaveBeenCalledWith(500);
		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Plugin /tmp/check.js failed: plain-string-error',
				code: 3,
			}),
		);
	});

	test('formats non-object load errors using String(err)', async () => {
		(createRequire as unknown as jest.Mock).mockImplementation(() => {
			throw 123 as unknown as Error;
		});

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test'};
		const {res, statusMock, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(statusMock).toHaveBeenCalledWith(500);
		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Error loading plugin: /tmp/check.js. Error: 123',
				code: 3,
			}),
		);
	});

	test('serves wrapped HTML help page when meta.help is a partial fragment', async () => {
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			helpHtml: '<h1>Setup Guide</h1><p>Install the plugin first.</p>',
			pluginName: 'check_test',
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock, setHeaderMock} = createMockRes();

		await handler(req as Request, res);

		expect(setHeaderMock).toHaveBeenCalledWith(
			'Content-Security-Policy',
			expect.stringContaining("default-src 'none'"),
		);
		expect(setHeaderMock).toHaveBeenCalledWith(
			'Content-Type',
			'text/html; charset=utf-8',
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('<h1>Setup Guide</h1>'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('Install the plugin first.'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('<title>check_test</title>'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('/help/external-link-guard.js'),
		);
	});

	test('serves full HTML document in a sandbox when meta.help starts with <!DOCTYPE', async () => {
		const fullHtml =
			'<!DOCTYPE html><html lang="en"><head><title>Custom</title></head><body><p>Hello</p></body></html>';
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			helpHtml: fullHtml,
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('rendered in a sandbox for safety'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('sandbox="allow-popups"'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('&lt;p&gt;Hello&lt;/p&gt;'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('/help/external-link-guard.js'),
		);
	});

	test('serves full HTML document in a sandbox when meta.help starts with <html', async () => {
		const fullHtml =
			'<html lang="en"><head><title>Custom</title></head><body><p>Hello</p></body></html>';
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			helpHtml: fullHtml,
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('rendered in a sandbox for safety'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('sandbox="allow-popups"'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('&lt;p&gt;Hello&lt;/p&gt;'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('/help/external-link-guard.js'),
		);
	});

	test('serves auto-generated help page with usage when no meta.help is defined', async () => {
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			pluginName: 'check_test',
			usageHttp: '/plugins/check-test?foo=<value>',
			usageShell: './check_nest.sh check-test foo=<value>',
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock, setHeaderMock} = createMockRes();

		await handler(req as Request, res);

		expect(setHeaderMock).toHaveBeenCalledWith(
			'Content-Type',
			'text/html; charset=utf-8',
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('check_test'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('/plugins/check-test?foo=&lt;value&gt;'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('./check_nest.sh check-test foo=&lt;value&gt;'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('No extended help is available for this plugin.'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('/help/external-link-guard.js'),
		);
	});

	test('serves auto-generated help page with no usage data when context is empty', async () => {
		const handler = createPluginRouteHandler(
			'/tmp/check.js',
			'/check-test',
			{},
		);
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('Plugin Help'),
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('No extended help is available for this plugin.'),
		);
		expect(sendMock).not.toHaveBeenCalledWith(
			expect.stringContaining('<dt>HTTP</dt>'),
		);
	});

	// ──────────────── HTML injection via plugin metadata ────────────────

	test('HTML-escapes pluginName containing angle brackets in the page title', async () => {
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			pluginName: '<script>alert(1)</script>',
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		const [output] = sendMock.mock.calls[0] as [string];
		expect(output).not.toContain('<script>');
		expect(output).toContain('&lt;script&gt;');
	});

	test('HTML-escapes usageHttp containing a quote-breaking XSS payload', async () => {
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			pluginName: 'check-test',
			usageHttp: '"><script>alert(document.cookie)</script>',
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		const [output] = sendMock.mock.calls[0] as [string];
		expect(output).not.toContain('<script>');
		expect(output).toContain('&lt;script&gt;');
		expect(output).toContain('&quot;');
	});

	test('HTML-escapes usageShell containing HTML special characters', async () => {
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			pluginName: 'check-test',
			usageShell: './check.sh && echo "<script>alert(1)</script>"',
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		const [output] = sendMock.mock.calls[0] as [string];
		// Angle brackets must be entity-encoded, not rendered as tags
		expect(output).toContain('&lt;script&gt;');
		expect(output).not.toContain('<script>alert');
	});

	test('sanitizes script tags in partial-HTML meta.help payload', async () => {
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			helpHtml:
				'<p>Setup guide</p><script>alert(document.cookie)</script><p>End</p>',
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		const [output] = sendMock.mock.calls[0] as [string];
		expect(output).not.toContain('<script>');
		expect(output).toContain('Setup guide');
		expect(output).toContain('End');
	});

	test('sanitizes event-handler attributes in partial-HTML meta.help payload', async () => {
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			helpHtml:
				'<p onclick="stealCookies()">click me</p><img src="x" onerror="pwned()">',
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		const [output] = sendMock.mock.calls[0] as [string];
		expect(output).not.toContain('onclick');
		expect(output).not.toContain('onerror');
		expect(output).not.toContain('<img');
		expect(output).toContain('click me');
	});

	test('sends full-doc meta.help through sandbox and strips inline scripts from srcdoc', async () => {
		const fullDoc =
			'<!DOCTYPE html><html><body><script>alert(1)</script><p>Docs</p></body></html>';
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			helpHtml: fullDoc,
		});
		const req: Partial<Request> = {
			url: '/check-test?help',
			query: {help: ''},
		};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		const [output] = sendMock.mock.calls[0] as [string];
		// Outer wrapper must not contain a live <script> tag
		expect(output).not.toMatch(/<script[^>]*>alert/i);
		// The srcdoc attribute should contain the escaped (therefore inert) version
		expect(output).toContain('sandbox="allow-popups"');
	});
});
