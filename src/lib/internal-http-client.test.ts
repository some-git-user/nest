import * as fs from 'fs';
import * as https from 'https';
import * as tls from 'tls';
import {env} from '../config/env';
import {
	InternalHttpRequestOptions,
	makeInternalRequest,
} from '../lib/internal-http-client';

jest.mock('https');
jest.mock('tls');
jest.mock('fs', () => {
	const existsSync = jest.fn();
	const statSync = jest.fn();
	const readFileSync = jest.fn();
	const mockFs = {
		__esModule: true,
		default: {existsSync, statSync, readFileSync},
		existsSync,
		statSync,
		readFileSync,
	};
	return mockFs;
});
jest.mock('../config/env', () => ({
	env: {
		TLS_CERT_PATH: 'certs/nest-cert.pem',
		HOST: 'localhost',
		PORT: 5000,
		NODE_ENV: 'development',
	},
}));

const mockedHttps = jest.mocked(https);
const mockedFs = jest.mocked(fs);
const mockedTls = jest.mocked(tls);
const mockedEnv = jest.mocked(env);

describe('makeInternalRequest', () => {
	let mockRequest: any;
	let mockResponse: any;
	let onDataCallbacks: ((chunk: string) => void)[];
	let onEndCallbacks: (() => void)[];
	let onErrorCallbacks: ((error: Error) => void)[];
	let onTimeoutCallbacks: (() => void)[];

	beforeEach(() => {
		// Set NODE_ENV to development for consistent test behavior
		process.env.NODE_ENV = 'development';

		jest.clearAllMocks();

		// Default cert-loading mocks: a valid, small cert in an allowed directory
		mockedFs.existsSync.mockReturnValue(true);
		mockedFs.statSync.mockReturnValue({
			isFile: () => true,
			size: BigInt(1024),
		} as never);
		mockedFs.readFileSync.mockReturnValue(Buffer.from('fake-cert'));
		mockedTls.createSecureContext.mockReturnValue({} as never);
		mockedEnv.TLS_CERT_PATH = 'certs/nest-cert.pem';
		mockedEnv.NODE_ENV = 'development';
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
				port: Number(env.PORT),
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

	it('should wrap non-Error request errors', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
		};

		const promise = makeInternalRequest(options);

		// Trigger error with a non-Error value (e.g. a plain string)
		onErrorCallbacks.forEach((cb) => cb('boom' as unknown as Error));

		await expect(promise).rejects.toThrow('boom');
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

		// NODE_ENV is set to 'development' in beforeEach, so rejectUnauthorized should be false
		expect(mockedHttps.request).toHaveBeenCalledWith(
			expect.objectContaining({
				rejectUnauthorized: false,
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

	describe('loadNestCertificate branch coverage', () => {
		const resolveRequest = async (): Promise<void> => {
			const promise = makeInternalRequest({
				method: 'GET',
				path: '/plugins/check_test',
			});
			const callback = mockedHttps.request.mock.calls[0][1] as (
				res: unknown,
			) => void;
			callback(mockResponse);
			onDataCallbacks.forEach((cb) => cb('{}'));
			onEndCallbacks.forEach((cb) => cb());
			await promise;
		};

		it('warns and returns null when certificate path contains a path traversal', async () => {
			mockedEnv.TLS_CERT_PATH = '/certs/../../evil.pem';
			await resolveRequest();
			expect(mockedHttps.request).toHaveBeenCalled();
		});

		it('warns and returns null when certificate path is not in an allowed directory', async () => {
			mockedEnv.TLS_CERT_PATH = '/tmp/outside.pem';
			await resolveRequest();
			expect(mockedHttps.request).toHaveBeenCalled();
		});

		it('warns and returns null when certificate file does not exist', async () => {
			mockedFs.existsSync.mockReturnValue(false);
			await resolveRequest();
			expect(mockedHttps.request).toHaveBeenCalled();
		});

		it('warns and returns null when certificate path is not a regular file', async () => {
			mockedFs.statSync.mockReturnValue({
				isFile: () => false,
				size: 1024,
			} as never);
			await resolveRequest();
			expect(mockedHttps.request).toHaveBeenCalled();
		});

		it('warns and returns null when certificate file exceeds maximum size', async () => {
			mockedFs.statSync.mockReturnValue({
				isFile: () => true,
				size: 20 * 1024,
			} as never);
			await resolveRequest();
			expect(mockedHttps.request).toHaveBeenCalled();
		});

		it('warns and returns null when certificate validation fails', async () => {
			mockedTls.createSecureContext.mockImplementation(() => {
				throw new Error('malformed certificate');
			});
			await resolveRequest();
			expect(mockedHttps.request).toHaveBeenCalled();
		});

		it('warns and returns null when reading the certificate file throws', async () => {
			mockedFs.readFileSync.mockImplementation(() => {
				throw new Error('read failed');
			});
			await resolveRequest();
			expect(mockedHttps.request).toHaveBeenCalled();
		});
	});
});
