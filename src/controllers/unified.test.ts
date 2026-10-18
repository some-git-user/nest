import {Request, Response} from 'express';
import {env} from '../config/env';
import {extractApiKey} from '../lib/browser-auth';
import {HttpStatusCodes} from '../lib/http-status-codes';
import {makeInternalRequest} from '../lib/internal-http-client';
import {hasRuntimeValidationFailed} from '../lib/local-config';
import {logger} from '../lib/logger';
import {getUnifiedChecks} from '../lib/unified-check';
import {unifiedCheck} from './unified';

jest.mock('../lib/browser-auth');
jest.mock('../lib/internal-http-client', () => {
	const actual = jest.requireActual('../lib/internal-http-client');
	return {
		...actual,
		makeInternalRequest: jest.fn(),
	};
});
jest.mock('../lib/local-config');
jest.mock('../lib/logger');
jest.mock('../lib/unified-check', () => {
	const actual = jest.requireActual('../lib/unified-check');
	return {
		...actual,
		getUnifiedChecks: jest.fn(),
	};
});
jest.mock('../config/env', () => ({
	env: {
		API_KEY: '',
		API_KEY_HEADER: 'x-api-key',
		// Passed to makeInternalRequest's timeoutMs; the value itself is irrelevant
		// since the test mocks the request to reject with the timeout sentinel.
		UNIFIED_TIMEOUT_MS: 1,
	},
}));

const mockedExtractApiKey = jest.mocked(extractApiKey);
const mockedMakeInternalRequest = jest.mocked(makeInternalRequest);
const mockedHasRuntimeValidationFailed = jest.mocked(
	hasRuntimeValidationFailed,
);
const mockedGetUnifiedChecks = jest.mocked(getUnifiedChecks);
const mockedLoggerWarn = jest.mocked(logger.warn);

type MockResponse = {
	status: jest.Mock;
	json: jest.Mock;
	setHeader: jest.Mock;
	send: jest.Mock;
};

const makeResponse = (): MockResponse => {
	const res: MockResponse = {
		status: jest.fn(),
		json: jest.fn(),
		setHeader: jest.fn(),
		send: jest.fn(),
	};
	res.status.mockReturnValue(res);
	return res;
};

const makeRequest = (method: string, headers = {}, query = {}): Request =>
	({method, headers, query}) as unknown as Request;

const okBody = (code: number, message: string, perf?: string): string =>
	JSON.stringify({code, message, ...(perf ? {performanceData: perf} : {})});

describe('unified controller', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(env as {API_KEY: string}).API_KEY = '';
		mockedHasRuntimeValidationFailed.mockReturnValue(false);
		mockedExtractApiKey.mockReturnValue('');
	});

	it('serves the help page when ?help is present', async () => {
		const res = makeResponse();

		await unifiedCheck(
			makeRequest('GET', {}, {help: ''}),
			res as unknown as Response,
		);

		expect(res.setHeader).toHaveBeenCalledWith(
			'Content-Type',
			'text/html; charset=utf-8',
		);
		expect(res.send).toHaveBeenCalledWith(
			expect.stringContaining('Built-in Help: /unified'),
		);
		// The help branch must short-circuit before any check work.
		expect(mockedGetUnifiedChecks).not.toHaveBeenCalled();
	});

	it('returns 403 when runtime validation failed', async () => {
		mockedHasRuntimeValidationFailed.mockReturnValue(true);
		const res = makeResponse();

		await unifiedCheck(makeRequest('GET'), res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
		expect(res.json).toHaveBeenCalledWith({
			code: 3,
			message: expect.stringContaining('hash validation failure'),
		});
	});

	it('returns 401 for a POST with a key configured but none provided', async () => {
		mockedEnvApiKey('secret');
		mockedExtractApiKey.mockReturnValue('');
		const res = makeResponse();

		await unifiedCheck(makeRequest('POST'), res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.UNAUTHORIZED);
		expect(res.json).toHaveBeenCalledWith({
			code: 3,
			message: expect.stringContaining('Missing API key'),
		});
		expect(mockedLoggerWarn).toHaveBeenCalled();
	});

	it('reports UNKNOWN when the check list is empty', async () => {
		mockedGetUnifiedChecks.mockReturnValue([]);
		const res = makeResponse();

		await unifiedCheck(makeRequest('GET'), res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.OK);
		expect(res.json).toHaveBeenCalledWith({
			code: 3,
			message: 'NEST UNIFIED: UNKNOWN - no presets were run',
		});
	});

	it('returns a Nagios JSON 500 when an unexpected error is thrown', async () => {
		mockedGetUnifiedChecks.mockImplementation(() => {
			throw new Error('boom');
		});
		const res = makeResponse();

		await unifiedCheck(makeRequest('GET'), res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(
			HttpStatusCodes.INTERNAL_SERVER_ERROR,
		);
		expect(res.json).toHaveBeenCalledWith({
			code: 3,
			message: 'Internal server error',
		});
	});

	it('aggregates results and forwards the worst status', async () => {
		mockedGetUnifiedChecks.mockReturnValue([
			{key: 'a', path: '/plugins/check-a', params: {host: 'h'}},
			{key: 'b', path: '/plugins/check-b', params: {}},
		]);
		mockedMakeInternalRequest.mockImplementation(async ({path}) => ({
			statusCode: 200,
			headers: {},
			body: path.includes('check-a')
				? okBody(2, 'broken', 'a=1')
				: okBody(0, 'fine', 'b=2'),
		}));
		const res = makeResponse();

		await unifiedCheck(makeRequest('GET'), res as unknown as Response);

		expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.OK);
		expect(res.json).toHaveBeenCalledWith({
			code: 2,
			message:
				'NEST UNIFIED: CRITICAL - 1 problem(s) of 2; a: CRITICAL - broken',
			performanceData: 'a=1 b=2',
		});
	});

	it('passes the resolved API key through to the dial-back', async () => {
		mockedEnvApiKey('secret');
		mockedExtractApiKey.mockReturnValue('caller-key');
		mockedGetUnifiedChecks.mockReturnValue([
			{key: 'a', path: '/plugins/check-a', params: {}},
		]);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: okBody(0, 'fine'),
		});
		const res = makeResponse();

		await unifiedCheck(makeRequest('POST'), res as unknown as Response);

		expect(mockedMakeInternalRequest).toHaveBeenCalledWith(
			expect.objectContaining({apiKey: 'caller-key', requireApiKey: true}),
		);
	});

	it('falls back to the configured key for a keyless GET', async () => {
		mockedEnvApiKey('secret');
		mockedExtractApiKey.mockReturnValue('');
		mockedGetUnifiedChecks.mockReturnValue([
			{key: 'a', path: '/plugins/check-a', params: {}},
		]);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: okBody(0, 'fine'),
		});
		const res = makeResponse();

		await unifiedCheck(makeRequest('GET'), res as unknown as Response);

		expect(mockedMakeInternalRequest).toHaveBeenCalledWith(
			expect.objectContaining({apiKey: 'secret', requireApiKey: false}),
		);
	});

	describe('runCheck failure handling', () => {
		const singlePreset = () =>
			mockedGetUnifiedChecks.mockReturnValue([
				{key: 'a', path: '/plugins/check-a', params: {}},
			]);

		it('marks a preset UNKNOWN when the dial-back times out', async () => {
			singlePreset();
			mockedMakeInternalRequest.mockRejectedValue(
				new Error('Internal request timeout'),
			);
			const res = makeResponse();

			await unifiedCheck(makeRequest('GET'), res as unknown as Response);

			expect(mockedMakeInternalRequest).toHaveBeenCalledWith(
				expect.objectContaining({timeoutMs: 1}),
			);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					code: 3,
					message: expect.stringContaining('Timed out'),
				}),
			);
		});

		it('marks a preset UNKNOWN when the body is not JSON', async () => {
			singlePreset();
			mockedMakeInternalRequest.mockResolvedValue({
				statusCode: 200,
				headers: {},
				body: 'not json',
			});
			const res = makeResponse();

			await unifiedCheck(makeRequest('GET'), res as unknown as Response);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining('Invalid response from plugin'),
				}),
			);
		});

		it('marks a preset UNKNOWN when the body is valid JSON but not an object', async () => {
			singlePreset();
			mockedMakeInternalRequest.mockResolvedValue({
				statusCode: 200,
				headers: {},
				body: '[1,2,3]',
			});
			const res = makeResponse();

			await unifiedCheck(makeRequest('GET'), res as unknown as Response);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining('Invalid response from plugin'),
				}),
			);
		});

		it('treats an unrecognised code as UNKNOWN', async () => {
			singlePreset();
			mockedMakeInternalRequest.mockResolvedValue({
				statusCode: 200,
				headers: {},
				body: okBody(9, 'weird'),
			});
			const res = makeResponse();

			await unifiedCheck(makeRequest('GET'), res as unknown as Response);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					code: 3,
					message: expect.stringContaining('weird'),
				}),
			);
		});

		it('substitutes a message when the plugin sends none', async () => {
			singlePreset();
			mockedMakeInternalRequest.mockResolvedValue({
				statusCode: 200,
				headers: {},
				body: JSON.stringify({code: 1}),
			});
			const res = makeResponse();

			await unifiedCheck(makeRequest('GET'), res as unknown as Response);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining('No message from plugin'),
				}),
			);
		});

		it('ignores non-string performance data', async () => {
			singlePreset();
			mockedMakeInternalRequest.mockResolvedValue({
				statusCode: 200,
				headers: {},
				body: JSON.stringify({code: 0, message: 'fine', performanceData: 5}),
			});
			const res = makeResponse();

			await unifiedCheck(makeRequest('GET'), res as unknown as Response);

			expect(res.json).toHaveBeenCalledWith({
				code: 0,
				message: 'NEST UNIFIED: OK - 0 problem(s) of 1',
			});
		});

		it('marks a preset UNKNOWN when the dial-back throws', async () => {
			singlePreset();
			mockedMakeInternalRequest.mockRejectedValue(new Error('socket reset'));
			const res = makeResponse();

			await unifiedCheck(makeRequest('GET'), res as unknown as Response);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					code: 3,
					message: expect.stringContaining('socket reset'),
				}),
			);
		});
	});
});

// Helper to mutate the mocked env's API_KEY per test without re-mocking.
function mockedEnvApiKey(value: string): void {
	(env as {API_KEY: string}).API_KEY = value;
}
