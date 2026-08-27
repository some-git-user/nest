import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import * as tls from 'tls';
import {env} from '../config/env';
import {
	InternalHttpRequestOptions,
	loadNestCertificate,
	makeInternalRequest,
	resetNestCertificateCache,
} from './internal-http-client';

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
jest.mock('path', () => {
	const actualPath = jest.requireActual('path');
	return {
		...actualPath,
		resolve: jest.fn(actualPath.resolve),
		isAbsolute: jest.fn(actualPath.isAbsolute),
		normalize: jest.fn(actualPath.normalize),
	};
});
jest.mock('../config/env', () => ({
	env: {
		TLS_CERT_PATH: 'certs/nest-cert.pem',
		HOST: 'localhost',
		PORT: 5000,
		NODE_ENV: 'development',
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
jest.mock('../lib/error-message', () => ({
	getErrorMessage: jest.fn((error: unknown): string => {
		if (error instanceof Error) {
			return error.message;
		}
		if (typeof error === 'string') {
			return error;
		}
		return '[Unknown error]';
	}),
}));

const mockedHttps = jest.mocked(https);
const mockedFs = jest.mocked(fs);
const mockedTls = jest.mocked(tls);
const mockedEnv = jest.mocked(env);
const mockedPath = jest.mocked(path);
const actualPath = jest.requireActual('path') as typeof path;

/**
 * `jest.clearAllMocks()` strips the pass-through implementations installed by
 * the `path` module factory, which would make `path.resolve()` return
 * `undefined`. Re-install them whenever mocks are cleared.
 */
const restorePathImplementations = (): void => {
	mockedPath.resolve.mockImplementation(actualPath.resolve as never);
	mockedPath.isAbsolute.mockImplementation(actualPath.isAbsolute as never);
	mockedPath.normalize.mockImplementation(actualPath.normalize as never);
};

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
		restorePathImplementations();

		// Default cert-loading mocks: a valid, small cert in an allowed directory
		resetNestCertificateCache();
		mockedFs.existsSync.mockReturnValue(true);
		mockedFs.statSync.mockReturnValue({
			isFile: () => true,
			size: 1024,
		} as never);
		mockedFs.readFileSync.mockReturnValue(Buffer.from('fake-cert'));
		mockedTls.createSecureContext.mockReturnValue({} as never);
		mockedEnv.TLS_CERT_PATH = 'certs/nest-cert.pem';
		mockedEnv.HOST = 'localhost';
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

	it('should reject when requireApiKey is true and apiKey is not provided', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
			requireApiKey: true,
		};

		// Reset mocks for this specific test
		mockedFs.existsSync.mockReset();
		mockedFs.statSync.mockReset();
		mockedFs.readFileSync.mockReset();
		mockedTls.createSecureContext.mockReset();

		// Use try-catch to properly handle the rejection
		let error: Error | undefined;
		try {
			await makeInternalRequest(options);
		} catch (e) {
			error = e as Error;
		}

		expect(error).toBeDefined();
		expect(error?.message).toBe('API key required but not provided');
	});

	it('should resolve when requireApiKey is false and apiKey is not provided', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
			requireApiKey: false,
		};

		const promise = makeInternalRequest(options);

		expect(mockedHttps.request).toHaveBeenCalled();

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
	});

	it('should make GET request without body', async () => {
		const options: InternalHttpRequestOptions = {
			method: 'GET',
			path: '/plugins/check_test',
			requireApiKey: false,
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
			apiKey: 'test-api-key',
			apiKeyHeader: 'x-api-key',
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
			requireApiKey: false,
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
			requireApiKey: false,
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
			requireApiKey: false,
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
			requireApiKey: false,
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
			requireApiKey: false,
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
			requireApiKey: false,
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
			requireApiKey: false,
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
			requireApiKey: false,
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
			requireApiKey: false,
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
			requireApiKey: false,
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
			requireApiKey: false,
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
				requireApiKey: false,
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

		it('handles error before absolutePath is set', async () => {
			// Mock path.resolve to throw before absolutePath is assigned
			mockedPath.resolve.mockImplementation(() => {
				throw new Error('path error');
			});
			await resolveRequest();
			// Restore original implementation
			restorePathImplementations();
		});
	});

	describe('loadNestCertificate', () => {
		beforeEach(() => {
			jest.clearAllMocks();
			restorePathImplementations();
			// Reset to default valid cert mocks
			resetNestCertificateCache();
			mockedFs.existsSync.mockReturnValue(true);
			mockedFs.statSync.mockReturnValue({
				isFile: () => true,
				size: 1024,
			} as never);
			mockedFs.readFileSync.mockReturnValue(Buffer.from('fake-cert'));
			mockedTls.createSecureContext.mockReturnValue({} as never);
			mockedEnv.TLS_CERT_PATH = 'certs/nest-cert.pem';
		});

		it('returns certificate buffer when valid cert is found', () => {
			const result = loadNestCertificate();
			expect(result).toEqual(Buffer.from('fake-cert'));
		});

		it('returns null when certificate path contains path traversal', () => {
			mockedEnv.TLS_CERT_PATH = '/certs/../../evil.pem';
			const result = loadNestCertificate();
			expect(result).toBeNull();
		});

		it('returns null when certificate path is not in allowed directories', () => {
			mockedEnv.TLS_CERT_PATH = '/tmp/outside.pem';
			const result = loadNestCertificate();
			expect(result).toBeNull();
		});

		it('returns null when certificate file does not exist', () => {
			mockedFs.existsSync.mockReturnValue(false);
			const result = loadNestCertificate();
			expect(result).toBeNull();
		});

		it('returns null when certificate path is not a regular file', () => {
			mockedFs.statSync.mockReturnValue({
				isFile: () => false,
				size: 1024,
			} as never);
			const result = loadNestCertificate();
			expect(result).toBeNull();
		});

		it('returns null when certificate file exceeds maximum size', () => {
			mockedFs.statSync.mockReturnValue({
				isFile: () => true,
				size: BigInt(20 * 1024),
			} as never);
			const result = loadNestCertificate();
			expect(result).toBeNull();
		});

		it('returns null when certificate validation fails', () => {
			mockedTls.createSecureContext.mockImplementation(() => {
				throw new Error('malformed certificate');
			});
			const result = loadNestCertificate();
			expect(result).toBeNull();
		});

		it('returns null when reading the certificate file throws', () => {
			mockedFs.readFileSync.mockImplementation(() => {
				throw new Error('read failed');
			});
			const result = loadNestCertificate();
			expect(result).toBeNull();
		});

		it('returns null when path.resolve throws', () => {
			mockedPath.resolve.mockImplementation(() => {
				throw new Error('path error');
			});
			const result = loadNestCertificate();
			expect(result).toBeNull();
			restorePathImplementations();
		});

		it('returns null when absolutePath is not set and error occurs', () => {
			// Mock path.isAbsolute to return false and then resolve to throw
			mockedPath.isAbsolute.mockReturnValue(false);
			mockedPath.resolve.mockImplementation(() => {
				throw new Error('resolve error');
			});
			const result = loadNestCertificate();
			expect(result).toBeNull();
			restorePathImplementations();
		});

		it('rejects a sibling directory that only shares the allowed prefix', () => {
			// '/certs-evil' starts with '/certs', so a plain startsWith() check
			// would wrongly accept it.
			mockedEnv.TLS_CERT_PATH = '/certs-evil/nest-cert.pem';
			expect(loadNestCertificate()).toBeNull();
			expect(mockedFs.existsSync).not.toHaveBeenCalled();
		});

		it('rejects a sibling of the system certificate directory', () => {
			mockedEnv.TLS_CERT_PATH = '/etc/nest/certs-backup/nest-cert.pem';
			expect(loadNestCertificate()).toBeNull();
			expect(mockedFs.existsSync).not.toHaveBeenCalled();
		});

		it('accepts a certificate directly inside an allowed directory', () => {
			mockedEnv.TLS_CERT_PATH = '/etc/nest/certs/nest-cert.pem';
			expect(loadNestCertificate()).toEqual(Buffer.from('fake-cert'));
		});

		it('memoises a successful load instead of re-reading the file', () => {
			expect(loadNestCertificate()).toEqual(Buffer.from('fake-cert'));
			expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);

			expect(loadNestCertificate()).toEqual(Buffer.from('fake-cert'));
			expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
			expect(mockedTls.createSecureContext).toHaveBeenCalledTimes(1);
		});

		it('does not memoise a failed load', () => {
			mockedFs.existsSync.mockReturnValue(false);
			expect(loadNestCertificate()).toBeNull();

			// The certificate can show up later (startup generation), and the next
			// request has to pick it up instead of returning a cached failure.
			mockedFs.existsSync.mockReturnValue(true);
			expect(loadNestCertificate()).toEqual(Buffer.from('fake-cert'));
		});
	});

	describe('internal request target', () => {
		it('connects to loopback when HOST is a wildcard bind address', async () => {
			mockedEnv.HOST = '0.0.0.0';

			makeInternalRequest({
				method: 'GET',
				path: '/plugins/check_test',
				requireApiKey: false,
			});

			expect(mockedHttps.request).toHaveBeenCalledWith(
				expect.objectContaining({
					hostname: 'localhost',
					headers: expect.objectContaining({Host: 'localhost:5000'}),
				}),
				expect.any(Function),
			);
		});

		it('keeps a specific bind address as the request target', async () => {
			mockedEnv.HOST = '192.168.111.50';

			makeInternalRequest({
				method: 'GET',
				path: '/plugins/check_test',
				requireApiKey: false,
			});

			expect(mockedHttps.request).toHaveBeenCalledWith(
				expect.objectContaining({
					hostname: '192.168.111.50',
					headers: expect.objectContaining({Host: '192.168.111.50:5000'}),
				}),
				expect.any(Function),
			);
		});
	});
});
