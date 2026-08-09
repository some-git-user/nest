import {Request, Response} from 'express';
import {HttpStatusCodes} from '../lib/http-status-codes';
import {makeInternalRequest} from '../lib/internal-http-client';
import {
	hasRuntimeValidationFailed,
	safeLookupConfig,
} from '../lib/local-config';
import {getLocalConfig, postLocalConfig} from './local-config';

jest.mock('../lib/local-config');
jest.mock('../lib/internal-http-client');

const mockedSafeLookupConfig = jest.mocked(safeLookupConfig);
const mockedMakeInternalRequest = jest.mocked(makeInternalRequest);
const mockedHasRuntimeValidationFailed = jest.mocked(
	hasRuntimeValidationFailed,
);

describe('POST /local-config controller', () => {
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let statusMock: jest.Mock;
	let jsonMock: jest.Mock;
	let returnMock: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		mockedHasRuntimeValidationFailed.mockReturnValue(false);
		statusMock = jest.fn().mockReturnThis();
		jsonMock = jest.fn();
		returnMock = jest.fn();
		mockResponse = {
			status: statusMock,
			json: jsonMock,
		};
		mockRequest = {};
	});

	it('should return 400 when request body is missing', async () => {
		mockRequest.body = undefined;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Missing request body. Expected JSON object.',
		});
	});

	it('should return 400 when extra fields are provided', async () => {
		mockRequest.body = {localConfig: 'test', extraField: 'value'};

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message:
				"Unexpected fields in request: extraField. Only 'localConfig' is allowed.",
		});
	});

	it('should return 400 when localConfig is missing', async () => {
		mockRequest.body = {};

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message:
				'Missing or invalid request body. Expected { localConfig: <key> }',
		});
	});

	it('should return 400 when localConfig is not a string', async () => {
		mockRequest.body = {localConfig: 123};

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'localConfig must be a string',
		});
	});

	it('should return 400 when localConfig is empty string', async () => {
		mockRequest.body = {localConfig: ''};

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message:
				'Missing or invalid request body. Expected { localConfig: <key> }',
		});
	});

	it('should return 400 when localConfig exceeds max length', async () => {
		const longKey = 'a'.repeat(129);
		mockRequest.body = {localConfig: longKey};

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Config key must be between 1 and 128 characters',
		});
	});

	it('should return 400 when config key contains invalid characters', async () => {
		mockRequest.body = {localConfig: 'test@invalid'};

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message:
				'Config key contains invalid characters. Only alphanumeric, underscore, and hyphen are allowed',
		});
	});

	it('should execute plugin and return result on valid request', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {device: '/dev/sda'},
		};
		const mockPluginResult = {
			code: 0,
			message: 'OK',
		};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify(mockPluginResult),
		});

		mockRequest.headers = {};
		mockRequest.body = {localConfig: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.OK);
		expect(jsonMock).toHaveBeenCalledWith(mockPluginResult);
		expect(mockedSafeLookupConfig).toHaveBeenCalledWith('test-key');
		expect(mockedMakeInternalRequest).toHaveBeenCalledWith({
			method: 'POST',
			path: '/plugins/check-test',
			body: {device: '/dev/sda'},
			apiKey: undefined,
			apiKeyHeader: 'x-api-key',
		});
	});

	it('should return 404 when config key is not found', async () => {
		mockedSafeLookupConfig.mockReturnValue(undefined);

		mockRequest.body = {localConfig: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.NOT_FOUND);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Config key not found',
		});
	});

	it('should return 403 when config presets are unavailable', async () => {
		mockedHasRuntimeValidationFailed.mockReturnValue(true);

		mockRequest.body = {localConfig: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: expect.stringContaining('unavailable'),
		});
	});

	it('should return 500 when plugin fails to load or transpile', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {},
		};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockRejectedValue(
			new Error('Failed to load plugin'),
		);

		mockRequest.body = {localConfig: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(
			HttpStatusCodes.INTERNAL_SERVER_ERROR,
		);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Internal server error',
		});
	});

	it('should return 500 for unexpected errors', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {},
		};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockRejectedValue(new Error('Unexpected error'));

		mockRequest.body = {localConfig: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(
			HttpStatusCodes.INTERNAL_SERVER_ERROR,
		);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Internal server error',
		});
	});

	it('should trim whitespace from config key', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {},
		};
		const mockPluginResult = {code: 0, message: 'OK'};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify(mockPluginResult),
		});

		mockRequest.headers = {};
		mockRequest.body = {localConfig: '  test-key  '};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.OK);
		expect(mockedSafeLookupConfig).toHaveBeenCalledWith('test-key');
	});

	it('should return 403 when runtime validation has failed', async () => {
		mockedHasRuntimeValidationFailed.mockReturnValue(true);

		mockRequest.body = {localConfig: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message:
				'Local config presets are currently unavailable due to hash validation failure. Please update the whitelist and restart the service.',
		});
	});

	it('should return 500 when plugin response is invalid JSON', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {},
		};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: 'invalid json response',
		});

		mockRequest.headers = {};
		mockRequest.body = {localConfig: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(
			HttpStatusCodes.INTERNAL_SERVER_ERROR,
		);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Invalid response from plugin',
		});
	});

	it('should pass API key header to internal request', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {device: '/dev/sda'},
		};
		const mockPluginResult = {
			code: 0,
			message: 'OK',
		};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify(mockPluginResult),
		});

		mockRequest.headers = {'x-api-key': 'secret-key-123'};
		mockRequest.body = {localConfig: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(mockedMakeInternalRequest).toHaveBeenCalledWith({
			method: 'POST',
			path: '/plugins/check-test',
			body: {device: '/dev/sda'},
			apiKey: 'secret-key-123',
			apiKeyHeader: 'x-api-key',
		});
	});

	it('should use default API key header when env.API_KEY_HEADER is undefined', async () => {
		// Mock env with undefined API_KEY_HEADER to trigger fallback
		jest.doMock('../config/env', () => ({
			env: {
				API_KEY_HEADER: undefined,
			},
		}));

		const mockConfigEntry = {
			command: 'check_test',
			params: {device: '/dev/sda'},
		};
		const mockPluginResult = {
			code: 0,
			message: 'OK',
		};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify(mockPluginResult),
		});

		mockRequest.headers = {'x-api-key': 'secret-key-123'};
		mockRequest.body = {localConfig: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await postLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(mockedMakeInternalRequest).toHaveBeenCalledWith({
			method: 'POST',
			path: '/plugins/check-test',
			body: {device: '/dev/sda'},
			apiKey: 'secret-key-123',
			apiKeyHeader: 'x-api-key',
		});
	});
});

describe('GET /local-config controller', () => {
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let statusMock: jest.Mock;
	let jsonMock: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		mockedHasRuntimeValidationFailed.mockReturnValue(false);
		statusMock = jest.fn().mockReturnThis();
		jsonMock = jest.fn();
		mockResponse = {
			status: statusMock,
			json: jsonMock,
		};
		mockRequest = {};
	});

	it('should return 400 when config query parameter is missing', async () => {
		mockRequest.query = {};

		await getLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Missing config parameter. Expected ?config=<key>',
		});
	});

	it('should return 400 when config query parameter is not a string', async () => {
		mockRequest.query = {config: 123 as unknown as string};

		await getLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Missing config parameter. Expected ?config=<key>',
		});
	});

	it('should return 400 when config key contains invalid characters', async () => {
		mockRequest.query = {config: 'test@invalid'};

		await getLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message:
				'Invalid config key format. Only alphanumeric, underscore, and hyphen are allowed.',
		});
	});

	it('should return 403 when runtime validation has failed', async () => {
		mockedHasRuntimeValidationFailed.mockReturnValue(true);
		mockRequest.query = {config: 'test-key'};

		await getLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message:
				'Local config presets are currently unavailable due to hash validation failure. Please update the whitelist and restart the service.',
		});
	});

	it('should execute plugin and return result on valid request', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {device: '/dev/sda'},
		};
		const mockPluginResult = {
			code: 0,
			message: 'OK',
		};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify(mockPluginResult),
		});

		mockRequest.headers = {};
		mockRequest.query = {config: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await getLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(HttpStatusCodes.OK);
		expect(jsonMock).toHaveBeenCalledWith(mockPluginResult);
		expect(mockedSafeLookupConfig).toHaveBeenCalledWith('test-key');
		expect(mockedMakeInternalRequest).toHaveBeenCalledWith({
			method: 'GET',
			path: '/plugins/check-test',
			params: {device: '/dev/sda'},
			apiKey: undefined,
			apiKeyHeader: 'x-api-key',
		});
	});

	it('should return 500 when plugin response is invalid JSON', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {},
		};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: 'invalid json',
		});

		mockRequest.headers = {};
		mockRequest.query = {config: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await getLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(
			HttpStatusCodes.INTERNAL_SERVER_ERROR,
		);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Invalid response from plugin',
		});
	});

	it('should pass API key header to internal request', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {},
		};
		const mockPluginResult = {code: 0, message: 'OK'};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify(mockPluginResult),
		});

		mockRequest.headers = {'x-api-key': 'secret-key-123'};
		mockRequest.query = {config: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await getLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(mockedMakeInternalRequest).toHaveBeenCalledWith({
			method: 'GET',
			path: '/plugins/check-test',
			params: {},
			apiKey: 'secret-key-123',
			apiKeyHeader: 'x-api-key',
		});
	});

	it('should use default API key header when env.API_KEY_HEADER is undefined', async () => {
		// Mock env with undefined API_KEY_HEADER to trigger fallback
		jest.doMock('../config/env', () => ({
			env: {
				API_KEY_HEADER: undefined,
			},
		}));

		const mockConfigEntry = {
			command: 'check_test',
			params: {},
		};
		const mockPluginResult = {code: 0, message: 'OK'};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify(mockPluginResult),
		});

		mockRequest.headers = {'x-api-key': 'secret-key-123'};
		mockRequest.query = {config: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await getLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(mockedMakeInternalRequest).toHaveBeenCalledWith({
			method: 'GET',
			path: '/plugins/check-test',
			params: {},
			apiKey: 'secret-key-123',
			apiKeyHeader: 'x-api-key',
		});
	});

	it('should return 500 on unexpected error', async () => {
		const mockConfigEntry = {
			command: 'check_test',
			params: {},
		};

		mockedSafeLookupConfig.mockReturnValue(mockConfigEntry);
		mockedMakeInternalRequest.mockRejectedValue(new Error('Unexpected error'));

		mockRequest.headers = {};
		mockRequest.query = {config: 'test-key'};
		mockResponse.status = statusMock;
		mockResponse.json = jsonMock;

		await getLocalConfig(mockRequest as Request, mockResponse as Response);

		expect(statusMock).toHaveBeenCalledWith(
			HttpStatusCodes.INTERNAL_SERVER_ERROR,
		);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: 'Internal server error',
		});
	});
});
