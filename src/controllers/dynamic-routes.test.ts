import {Request, Response} from 'express';
import {createRequire} from 'module';
import {HttpStatusCodes} from '../lib/http-status-codes';
import {logger} from '../lib/logger';
import type {HtmlTemplateString} from '../types/plugin';
import {createPluginRouteHandler, insertBeforeBodyEnd} from './dynamic-routes';
import {
	buildInvalidCodeResponse,
	coerceParams,
	getPluginFunction,
	isKnownNagiosCode,
	normalizePluginResult,
} from './dynamic-routes/helpers';

type MockResponse = {
	res: Response;
	statusMock: jest.Mock;
	sendMock: jest.Mock;
	setHeaderMock: jest.Mock;
};

jest.mock('module', () => ({
	createRequire: jest.fn(() => {
		// Return a mock require function
		return jest.fn();
	}),
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

jest.mock('./dynamic-routes/helpers', () => {
	const mockCoerceParams = jest.fn((params: {[key: string]: string}) => {
		const coerced: {[key: string]: string | number | boolean} = {};
		for (const [key, value] of Object.entries(params)) {
			if (value === 'true') {
				coerced[key] = true;
			} else if (value === 'false') {
				coerced[key] = false;
			} else if (/^-?\d+\.?\d*$/.test(value) && value.trim() !== '') {
				coerced[key] = Number(value);
			} else {
				coerced[key] = value;
			}
		}
		return coerced;
	});

	const mockParseUrlParams = jest.fn((url: string) => {
		const queryString = url.includes('?') ? url.split('?')[1] : '';
		const paramsObj: {[key: string]: string} = {};
		const searchParams = new URLSearchParams(queryString);
		for (const [key, value] of searchParams) {
			paramsObj[key] = value;
		}
		return paramsObj;
	});

	return {
		__esModule: true,
		clearPluginRequireCache: jest.fn(),
		getPluginFunction: jest.fn(),
		isKnownNagiosCode: jest.fn().mockReturnValue(true),
		normalizePluginResult: jest.fn(),
		parseUrlParams: mockParseUrlParams,
		coerceParams: mockCoerceParams,
		buildInvalidCodeResponse: jest.fn(),
		mockCoerceParams,
		mockParseUrlParams,
	};
});

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
		(getPluginFunction as jest.Mock).mockReturnValue(undefined);

		const handler = createPluginRouteHandler(
			'/tmp/check-test.js',
			'/check-test',
		);
		const req: Partial<Request> = {url: '/check-test'};
		const {res, statusMock, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(statusMock).toHaveBeenCalledWith(
			HttpStatusCodes.INTERNAL_SERVER_ERROR,
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('must export a function'),
				code: 3,
			}),
		);
	});

	test('returns early when headers were already sent', async () => {
		(getPluginFunction as jest.Mock).mockReturnValue(async () => ({
			message: 'ok',
			code: 0,
		}));
		(normalizePluginResult as jest.Mock).mockReturnValue({
			message: 'ok',
			code: 0,
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
		(getPluginFunction as jest.Mock).mockReturnValue(async () => ({
			message: undefined,
			code: 0,
		}));
		(normalizePluginResult as jest.Mock).mockReturnValue({
			message: undefined,
			code: 0,
		});

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
		(getPluginFunction as jest.Mock).mockReturnValue(async () => ({
			message: 'invalid',
			code: 9,
		}));
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

		const handler = createPluginRouteHandler(
			'/tmp/check-test.js',
			'/check-test',
		);
		const req: Partial<Request> = {url: '/check-test?a=1'};
		const {res, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(buildInvalidCodeResponse).toHaveBeenCalledWith(
			9,
			'/tmp/check-test.js',
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
		(getPluginFunction as jest.Mock).mockReturnValue(async () => {
			throw new Error('plain-string-error');
		});

		const handler = createPluginRouteHandler(
			'/tmp/check-test.js',
			'/check-test',
		);
		const req: Partial<Request> = {url: '/check-test'};
		const {res, statusMock, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(statusMock).toHaveBeenCalledWith(
			HttpStatusCodes.INTERNAL_SERVER_ERROR,
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('Plugin /tmp/check-test.js failed'),
				code: 3,
			}),
		);
	});

	test('merges POST body params with URL params before executing plugin', async () => {
		(getPluginFunction as jest.Mock).mockReturnValue(async () => ({
			message: 'ok',
			code: 0,
		}));
		(normalizePluginResult as jest.Mock).mockReturnValue({
			message: 'ok',
			code: 0,
		});

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {
			url: '/check-test?fromQuery=1',
			body: {
				baseUrl: 'https://cloud.example.com',
				token: 'secret',
				retries: 2,
				enabled: true,
				nested: {nope: true},
			},
		};
		const {res} = createMockRes();

		await handler(req as Request, res);

		// Verify coerceParams was called with merged params
		expect(coerceParams).toHaveBeenCalledWith(
			expect.objectContaining({
				fromQuery: '1',
				baseUrl: 'https://cloud.example.com',
				token: 'secret',
				retries: '2',
				enabled: 'true',
			}),
		);
	});

	test('formats non-object load errors using String(err)', async () => {
		// Simulate a plugin module that throws during require (not during execution)
		// This tests the outer try-catch that handles require/load errors
		const mockRequire = jest.fn(() => {
			throw new Error('123');
		});
		(createRequire as jest.Mock).mockReturnValue(mockRequire);

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test'};
		const {res, statusMock, sendMock} = createMockRes();

		await handler(req as Request, res);

		expect(statusMock).toHaveBeenCalledWith(
			HttpStatusCodes.INTERNAL_SERVER_ERROR,
		);
		expect(sendMock).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('Error loading plugin'),
				code: 3,
			}),
		);
		// Reset the mock for other tests
		(createRequire as jest.Mock).mockReturnValue(() => jest.fn());
	});

	test('serves wrapped HTML help page when meta.help is a partial fragment', async () => {
		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test', {
			helpHtml:
				'<h1>Setup Guide</h1><p>Install the plugin first.</p>' as HtmlTemplateString,
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
		expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('NEST_HOST'));
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('NEST_API_KEY'),
		);
	});

	test('handles normalized code that is not a number', async () => {
		(getPluginFunction as jest.Mock).mockReturnValue(async () => ({
			message: 'ok',
			code: 'invalid-code',
		}));
		(normalizePluginResult as jest.Mock).mockReturnValue({
			message: 'ok',
			code: 'invalid-code',
			performanceData: undefined,
		});
		(isKnownNagiosCode as jest.Mock).mockReturnValue(false);
		(buildInvalidCodeResponse as jest.Mock).mockReturnValue({
			errorMessage: 'Invalid return code "invalid-code"',
			nagiosReturn: {message: 'Invalid return code "invalid-code"', code: 3},
		});

		const handler = createPluginRouteHandler('/tmp/check.js', '/check-test');
		const req: Partial<Request> = {url: '/check-test'};
		const {res} = createMockRes();

		await handler(req as Request, res);

		expect(buildInvalidCodeResponse).toHaveBeenCalledWith(
			undefined,
			'/tmp/check.js',
			'/check-test',
			'localhost',
			5000,
		);
	});

	test('serves full HTML document in a sandbox when meta.help starts with <!DOCTYPE', async () => {
		const fullHtml =
			'<!DOCTYPE html><html lang="en"><head><title>Custom</title></head><body><p>Hello</p></body></html>' as HtmlTemplateString;
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
		expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('NEST_HOST'));
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('NEST_API_KEY'),
		);
	});

	test('serves full HTML document in a sandbox when meta.help starts with <html', async () => {
		const fullHtml =
			'<html lang="en"><head><title>Custom</title></head><body><p>Hello</p></body></html>' as HtmlTemplateString;
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
		expect(sendMock).toHaveBeenCalledWith(expect.stringContaining('NEST_HOST'));
		expect(sendMock).toHaveBeenCalledWith(
			expect.stringContaining('NEST_API_KEY'),
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
			expect.stringContaining(
				'NEST_HOST=SERVER_IP_OR_DNS NEST_API_KEY=API_KEY ./check_nest.sh check-test foo=&lt;value&gt;',
			),
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
				'<p>Setup guide</p><script>alert(document.cookie)</script><p>End</p>' as HtmlTemplateString,
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
				'<p onclick="stealCookies()">click me</p><img src="x" onerror="pwned()"' as HtmlTemplateString,
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
			'<!DOCTYPE html><html><body><script>alert(1)</script><p>Docs</p></body></html>' as HtmlTemplateString;
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

	describe('insertBeforeBodyEnd utility', () => {
		test('inserts content before closing body tag when present', () => {
			const html = '<!DOCTYPE html><html><body><h1>Test</h1></body></html>';
			const section = '<footer>Footer content</footer>';
			const result = insertBeforeBodyEnd(html, section);

			expect(result).toBe(
				'<!DOCTYPE html><html><body><h1>Test</h1><footer>Footer content</footer></body></html>',
			);
		});

		test('appends content when closing body tag is not present', () => {
			const html = '<!DOCTYPE html><html><body><h1>Test</h1>';
			const section = '<footer>Footer content</footer>';
			const result = insertBeforeBodyEnd(html, section);

			expect(result).toBe(
				'<!DOCTYPE html><html><body><h1>Test</h1><footer>Footer content</footer>',
			);
		});

		test('handles case-insensitive body closing tag search', () => {
			const html = '<!DOCTYPE html><html><body><h1>Test</h1></BODY></html>';
			const section = '<footer>Footer</footer>';
			const result = insertBeforeBodyEnd(html, section);

			expect(result).toContain('<footer>Footer</footer></body>');
		});

		test('handles empty section content', () => {
			const html = '<!DOCTYPE html><html><body><h1>Test</h1></body></html>';
			const section = '';
			const result = insertBeforeBodyEnd(html, section);

			expect(result).toBe(
				'<!DOCTYPE html><html><body><h1>Test</h1></body></html>',
			);
		});
	});
});
