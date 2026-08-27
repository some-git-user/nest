import express from 'express';
import request from 'supertest';
import {HttpStatusCodes} from '../lib/http-status-codes';
import * as internalHttpClient from '../lib/internal-http-client';
import * as localConfig from '../lib/local-config';
import localConfigRouter from './local-config';

const app = express();
app.use(express.json());
app.use('/local-config', localConfigRouter);

// Mock the dependencies
jest.mock('../lib/local-config');
jest.mock('../lib/internal-http-client');
// Authentication is disabled by default (empty API_KEY), so a POST without a
// key header is forwarded without requiring one.
jest.mock('../config/env', () => ({
	env: {
		API_KEY: '',
		API_KEY_HEADER: 'x-api-key',
		LOG_FILE_PATH: undefined,
		NODE_ENV: 'production',
	},
}));

const mockedMakeInternalRequest = jest.mocked(
	internalHttpClient.makeInternalRequest,
);
const mockedHasRuntimeValidationFailed = jest.mocked(
	localConfig.hasRuntimeValidationFailed,
);

describe('local-config route', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedHasRuntimeValidationFailed.mockReturnValue(false);
	});

	describe('POST /local-config', () => {
		it('should return 400 when request body is missing localConfig', async () => {
			const response = await request(app).post('/local-config').send({});

			expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
			expect(response.body).toEqual({
				code: 3,
				message: expect.stringContaining('Missing or invalid request body'),
			});
		});

		it('should return 400 when localConfig key is missing', async () => {
			const response = await request(app)
				.post('/local-config')
				.send({foo: 'bar'});

			expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
			expect(response.body).toEqual({
				code: 3,
				message: expect.stringContaining('Unexpected fields in request'),
			});
		});

		it('should return 400 when localConfig is not a string', async () => {
			const response = await request(app)
				.post('/local-config')
				.send({localConfig: 123});

			expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
			expect(response.body).toEqual({
				code: 3,
				message: 'localConfig must be a string',
			});
		});

		it('should return 400 when localConfig contains invalid characters', async () => {
			const response = await request(app)
				.post('/local-config')
				.send({localConfig: '../etc/passwd'});

			expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
			expect(response.body).toEqual({
				code: 3,
				message: expect.stringContaining('invalid characters'),
			});
		});

		it('should return 400 when localConfig is too long', async () => {
			const longKey = 'a'.repeat(129);
			const response = await request(app)
				.post('/local-config')
				.send({localConfig: longKey});

			expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
			expect(response.body).toEqual({
				code: 3,
				message: expect.stringContaining('must be between 1 and 128'),
			});
		});

		it('should return 400 when localConfig is empty', async () => {
			const response = await request(app)
				.post('/local-config')
				.send({localConfig: ''});

			expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
			expect(response.body).toEqual({
				code: 3,
				message: expect.stringContaining('Missing or invalid request body'),
			});
		});

		it('should return 400 when extra fields are present in request body', async () => {
			const response = await request(app)
				.post('/local-config')
				.send({localConfig: 'test', extraField: 'should-be-rejected'});

			expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
			expect(response.body).toEqual({
				code: 3,
				message: expect.stringContaining('Unexpected fields in request'),
			});
		});

		it('should log warning for extra fields in request body', async () => {
			const mockConfigEntry = {
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test'},
			};

			const mockPluginResult = {
				code: 0,
				message: 'All systems operational',
			};

			jest
				.spyOn(localConfig, 'safeLookupConfig')
				.mockReturnValue(mockConfigEntry);
			jest.spyOn(internalHttpClient, 'makeInternalRequest').mockResolvedValue({
				statusCode: 200,
				headers: {},
				body: JSON.stringify(mockPluginResult),
			});

			const response = await request(app)
				.post('/local-config')
				.send({localConfig: 'test', extraField: 'should-be-rejected'});

			expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
		});

		it('should execute plugin and return 200 with valid config key', async () => {
			const mockConfigEntry = {
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test', nagiosReturnValue: '0'},
			};

			const mockPluginResult = {
				code: 0,
				message: 'All systems operational',
			};

			jest
				.spyOn(localConfig, 'safeLookupConfig')
				.mockReturnValue(mockConfigEntry);
			jest.spyOn(internalHttpClient, 'makeInternalRequest').mockResolvedValue({
				statusCode: 200,
				headers: {},
				body: JSON.stringify(mockPluginResult),
			});

			const response = await request(app)
				.post('/local-config')
				.send({localConfig: 'test'});

			expect(response.status).toBe(HttpStatusCodes.OK);
			expect(response.body).toEqual(mockPluginResult);
			expect(localConfig.safeLookupConfig).toHaveBeenCalledWith('test');
			expect(internalHttpClient.makeInternalRequest).toHaveBeenCalledWith({
				method: 'POST',
				path: '/plugins/check-test',
				body: mockConfigEntry.params,
				apiKey: undefined,
				apiKeyHeader: 'x-api-key',
				requireApiKey: false,
			});
		});

		it('should return 404 when config key is not found', async () => {
			jest.spyOn(localConfig, 'safeLookupConfig').mockReturnValue(undefined);

			const response = await request(app)
				.post('/local-config')
				.send({localConfig: 'nonexistent'});

			expect(response.status).toBe(HttpStatusCodes.NOT_FOUND);
			expect(response.body).toEqual({
				code: 3,
				message: 'Config key not found',
			});
		});

		it('should return 400 for configuration errors', async () => {
			// With safeLookupConfig, configuration errors are handled at startup
			// This test verifies that unavailable config returns 403
			jest
				.spyOn(localConfig, 'hasRuntimeValidationFailed')
				.mockReturnValue(true);

			const response = await request(app)
				.post('/local-config')
				.send({localConfig: 'test'});

			expect(response.status).toBe(HttpStatusCodes.FORBIDDEN);
			expect(response.body).toEqual({
				code: 3,
				message: expect.stringContaining('unavailable'),
			});
		});

		it('should return 500 for plugin execution errors', async () => {
			const mockConfigEntry = {
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test'},
			};

			jest
				.spyOn(localConfig, 'safeLookupConfig')
				.mockReturnValue(mockConfigEntry);
			mockedMakeInternalRequest.mockRejectedValue(
				new Error('Plugin execution failed'),
			);

			const response = await request(app)
				.post('/local-config')
				.send({localConfig: 'test'});

			expect(response.status).toBe(HttpStatusCodes.INTERNAL_SERVER_ERROR);
			expect(response.body).toEqual({
				code: 3,
				message: 'Internal server error',
			});
		});

		it('should handle plugin with performance data', async () => {
			const mockConfigEntry = {
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test', performanceData: 'true'},
			};

			const mockPluginResult = {
				code: 0,
				message: 'Test message',
				performanceData: [
					{label: 'test', value: 42, warning: 80, critical: 90},
				],
			};

			jest
				.spyOn(localConfig, 'safeLookupConfig')
				.mockReturnValue(mockConfigEntry);
			mockedMakeInternalRequest.mockResolvedValue({
				statusCode: 200,
				headers: {},
				body: JSON.stringify(mockPluginResult),
			});

			const response = await request(app)
				.post('/local-config')
				.send({localConfig: 'test'});

			expect(response.status).toBe(HttpStatusCodes.OK);
			expect(response.body).toEqual(mockPluginResult);
			expect(response.body.performanceData).toBeDefined();
		});

		it('should return 400 when request body is missing entirely', async () => {
			const response = await request(app).post('/local-config').send();

			expect(response.status).toBe(HttpStatusCodes.BAD_REQUEST);
			expect(response.body).toEqual({
				code: 3,
				message: 'Missing request body. Expected JSON object.',
			});
		});

		it('should return 500 for internal HTTP request errors', async () => {
			const mockConfigEntry = {
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test'},
			};

			jest
				.spyOn(localConfig, 'safeLookupConfig')
				.mockReturnValue(mockConfigEntry);
			mockedMakeInternalRequest.mockRejectedValue(
				new Error('Internal request failed'),
			);

			const response = await request(app)
				.post('/local-config')
				.send({localConfig: 'test'});

			expect(response.status).toBe(HttpStatusCodes.INTERNAL_SERVER_ERROR);
			expect(response.body).toEqual({
				code: 3,
				message: 'Internal server error',
			});
		});
	});
});
