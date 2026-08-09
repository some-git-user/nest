import * as https from 'https';
import {env} from '../config/env';
import {
	InternalHttpRequestOptions,
	makeInternalRequest,
} from '../lib/internal-http-client';

jest.mock('https');

const mockedHttps = jest.mocked(https);

describe('makeInternalRequest', () => {
	let mockRequest: any;
	let mockResponse: any;
	let onDataCallbacks: ((chunk: string) => void)[];
	let onEndCallbacks: (() => void)[];
	let onErrorCallbacks: ((error: Error) => void)[];
	let onTimeoutCallbacks: (() => void)[];

	beforeEach(() => {
		jest.clearAllMocks();
		onDataCallbacks = [];
		onEndCallbacks = [];
		onErrorCallbacks = [];
		onTimeoutCallbacks = [];

		mockResponse = {
			on: jest
				.fn()
				.mockImplementation((event: string, callback: () => void) => {
					if (event === 'data') {
						onDataCallbacks.push(callback as (chunk: string) => void);
					} else if (event === 'end') {
						onEndCallbacks.push(callback);
					}
					return mockResponse;
				}),
			statusCode: 200,
			headers: {},
		};

		mockRequest = {
			on: jest
				.fn()
				.mockImplementation((event: string, callback: () => void) => {
					if (event === 'error') {
						onErrorCallbacks.push(callback as (error: Error) => void);
					} else if (event === 'timeout') {
						onTimeoutCallbacks.push(callback);
					}
					return mockRequest;
				}),
			setHeader: jest.fn(),
			write: jest.fn(),
			end: jest.fn(),
			destroy: jest.fn(),
			setTimeout: jest
				.fn()
				.mockImplementation((ms: number, callback: () => void) => {
					onTimeoutCallbacks.push(callback);
					return mockRequest;
				}),
		};

		mockedHttps.request.mockReturnValue(mockRequest);
	});

	it('should make GET request without body', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
		};

		const promise = makeInternalRequest(options);

		expect(mockedHttps.request).toHaveBeenCalledWith(
			expect.objectContaining({
				hostname: 'localhost',
				port: env.PORT,
				path: '/plugins/check_test',
				method: 'GET',
			}),
			expect.any(Function),
		);

		// Trigger response
		const callback = mockedHttps.request.mock.calls[0][1] as (
			res: unknown,
		) => void;
		callback(mockResponse);

		// Trigger data and end events
		onDataCallbacks.forEach((cb) => cb('{"code":0}'));
		onEndCallbacks.forEach((cb) => cb());

		const result = await promise;

		expect(result.statusCode).toBe(200);
		expect(result.body).toBe('{"code":0}');
		expect(mockRequest.end).toHaveBeenCalled();
	});

	it('should make POST request with body', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'POST',
			path: '/plugins/check_test',
			body: {device: '/dev/sda'},
		};

		const promise = makeInternalRequest(options);

		// Trigger response
		const callback = mockedHttps.request.mock.calls[0][1] as (
			res: unknown,
		) => void;
		callback(mockResponse);

		// Trigger data and end events
		onDataCallbacks.forEach((cb) => cb('{"code":0}'));
		onEndCallbacks.forEach((cb) => cb());

		const result = await promise;

		expect(mockRequest.setHeader).toHaveBeenCalledWith(
			'Content-Type',
			'application/json',
		);
		expect(mockRequest.write).toHaveBeenCalled();
		expect(result.body).toBe('{"code":0}');
	});

	it('should pass query params in URL for GET request', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
			params: {device: '/dev/sda', threshold: '80'},
		};

		makeInternalRequest(options);

		expect(mockedHttps.request).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/plugins/check_test?device=%2Fdev%2Fsda&threshold=80',
			}),
			expect.any(Function),
		);
	});

	it('should pass API key in headers when provided', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
			apiKey: 'test-api-key',
			apiKeyHeader: 'x-api-key',
		};

		makeInternalRequest(options);

		expect(mockedHttps.request).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.objectContaining({
					'x-api-key': 'test-api-key',
				}),
			}),
			expect.any(Function),
		);
	});

	it('should not include API key header when apiKey is undefined', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
		};

		makeInternalRequest(options);

		expect(mockedHttps.request).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.not.objectContaining({
					'x-api-key': expect.anything(),
				}),
			}),
			expect.any(Function),
		);
	});

	it('should handle empty params object', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
			params: {},
		};

		makeInternalRequest(options);

		expect(mockedHttps.request).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/plugins/check_test',
			}),
			expect.any(Function),
		);
	});

	it('should handle request error', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
		};

		const promise = makeInternalRequest(options);

		// Trigger error
		onErrorCallbacks.forEach((cb) => cb(new Error('Connection refused')));

		await expect(promise).rejects.toThrow('Connection refused');
	});

	it('should handle timeout and destroy request', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
		};

		const promise = makeInternalRequest(options);

		// Trigger timeout
		onTimeoutCallbacks.forEach((cb) => cb());

		await expect(promise).rejects.toThrow('Internal request timeout');
		expect(mockRequest.destroy).toHaveBeenCalled();
	});

	it('should set rejectUnauthorized based on NODE_ENV', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
		};

		makeInternalRequest(options);

		// NODE_ENV defaults to 'production' in env.ts, but test environment may override
		// Just verify the property is set correctly based on current NODE_ENV
		expect(mockedHttps.request).toHaveBeenCalledWith(
			expect.objectContaining({
				rejectUnauthorized: process.env.NODE_ENV === 'production',
			}),
			expect.any(Function),
		);
	});

	it('should handle response with no statusCode', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
		};

		mockResponse.statusCode = undefined;

		const promise = makeInternalRequest(options);

		const callback = mockedHttps.request.mock.calls[0][1] as (
			res: unknown,
		) => void;
		callback(mockResponse);

		onDataCallbacks.forEach((cb) => cb('{"code":0}'));
		onEndCallbacks.forEach((cb) => cb());

		const result = await promise;

		expect(result.statusCode).toBe(500);
	});

	it('should handle multiple data chunks', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
		};

		const promise = makeInternalRequest(options);

		const callback = mockedHttps.request.mock.calls[0][1] as (
			res: unknown,
		) => void;
		callback(mockResponse);

		onDataCallbacks.forEach((cb) => {
			cb('{"code":');
			cb('0}');
		});
		onEndCallbacks.forEach((cb) => cb());

		const result = await promise;

		expect(result.body).toBe('{"code":0}');
	});

	it('should handle POST request with empty body', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'POST',
			path: '/plugins/check_test',
			body: {},
		};

		const promise = makeInternalRequest(options);

		const callback = mockedHttps.request.mock.calls[0][1] as (
			res: unknown,
		) => void;
		callback(mockResponse);

		onDataCallbacks.forEach((cb) => cb('{"code":0}'));
		onEndCallbacks.forEach((cb) => cb());

		const result = await promise;

		expect(result.body).toBe('{"code":0}');
	});
});
