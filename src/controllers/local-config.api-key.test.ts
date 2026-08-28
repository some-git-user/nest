import type {Request, Response} from 'express';

type MockedResponse = {
	res: Response;
	statusMock: jest.Mock;
	jsonMock: jest.Mock;
};

const createMockResponse = (): MockedResponse => {
	const statusMock = jest.fn();
	const jsonMock = jest.fn();
	statusMock.mockReturnValue({json: jsonMock});
	return {
		res: {status: statusMock} as unknown as Response,
		statusMock,
		jsonMock,
	};
};

/**
 * Load the controller with an API key configured. The default env has an empty
 * `API_KEY`, so the "missing API key" branch can only be reached by reloading
 * the module against a mocked environment.
 */
type LoadedController = {
	postLocalConfig: (req: Request, res: Response) => Promise<void>;
	getLocalConfig: (req: Request, res: Response) => Promise<void>;
	safeLookupConfig: jest.Mock;
	makeInternalRequest: jest.Mock;
};

const loadController = (apiKey: string): LoadedController => {
	jest.resetModules();
	jest.doMock('../config/env', () => ({
		env: {
			API_KEY: apiKey,
			API_KEY_HEADER: 'x-api-key',
			LOG_FILE_PATH: undefined,
			NODE_ENV: 'production',
		},
	}));
	jest.doMock('../lib/local-config', () => ({
		hasRuntimeValidationFailed: jest.fn(() => false),
		safeLookupConfig: jest.fn(),
	}));
	jest.doMock('../lib/internal-http-client', () => ({
		makeInternalRequest: jest.fn(),
	}));

	let loaded: LoadedController | undefined;

	jest.isolateModules(() => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const controller = require('./local-config') as {
			postLocalConfig: (req: Request, res: Response) => Promise<void>;
			getLocalConfig: (req: Request, res: Response) => Promise<void>;
		};
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const localConfigLib = require('../lib/local-config') as {
			safeLookupConfig: jest.Mock;
		};
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const clientLib = require('../lib/internal-http-client') as {
			makeInternalRequest: jest.Mock;
		};
		loaded = {
			postLocalConfig: controller.postLocalConfig,
			getLocalConfig: controller.getLocalConfig,
			safeLookupConfig: localConfigLib.safeLookupConfig,
			makeInternalRequest: clientLib.makeInternalRequest,
		};
	});

	if (!loaded) {
		throw new Error('Failed to load the local-config controller');
	}

	return loaded;
};

const configEntry = {command: 'check_test', params: {device: '/dev/sda'}};

describe('local-config controller with an API key configured', () => {
	it('returns 401 when a POST has no API key header', async () => {
		const {postLocalConfig, safeLookupConfig, makeInternalRequest} =
			loadController('configured-key');
		safeLookupConfig.mockReturnValue(configEntry);
		const {res, statusMock, jsonMock} = createMockResponse();

		await postLocalConfig(
			{
				body: {localConfig: 'test-key'},
				headers: {},
			} as unknown as Request,
			res,
		);

		expect(statusMock).toHaveBeenCalledWith(401);
		expect(jsonMock).toHaveBeenCalledWith({
			code: 3,
			message: "Missing API key. Provide it in the 'x-api-key' header.",
		});
		expect(makeInternalRequest).not.toHaveBeenCalled();
	});

	it('forwards the API key when a POST provides one', async () => {
		const {postLocalConfig, safeLookupConfig, makeInternalRequest} =
			loadController('configured-key');
		safeLookupConfig.mockReturnValue(configEntry);
		makeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify({code: 0, message: 'OK'}),
		});
		const {res, statusMock, jsonMock} = createMockResponse();

		await postLocalConfig(
			{
				body: {localConfig: 'test-key'},
				headers: {'x-api-key': 'configured-key'},
			} as unknown as Request,
			res,
		);

		expect(statusMock).toHaveBeenCalledWith(200);
		expect(jsonMock).toHaveBeenCalledWith({code: 0, message: 'OK'});
		expect(makeInternalRequest).toHaveBeenCalledWith(
			expect.objectContaining({apiKey: 'configured-key'}),
		);
	});

	it('does not require an API key for GET requests', async () => {
		const {getLocalConfig, safeLookupConfig, makeInternalRequest} =
			loadController('configured-key');
		safeLookupConfig.mockReturnValue(configEntry);
		makeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify({code: 0, message: 'OK'}),
		});
		const {res, statusMock} = createMockResponse();

		await getLocalConfig(
			{query: {config: 'test-key'}, headers: {}} as unknown as Request,
			res,
		);

		expect(statusMock).toHaveBeenCalledWith(200);
		expect(makeInternalRequest).toHaveBeenCalledWith(
			expect.objectContaining({requireApiKey: false}),
		);
	});

	it('forwards the configured key for a keyless GET so the internal request authenticates', async () => {
		const {getLocalConfig, safeLookupConfig, makeInternalRequest} =
			loadController('configured-key');
		safeLookupConfig.mockReturnValue(configEntry);
		makeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify({code: 0, message: 'OK'}),
		});
		const {res} = createMockResponse();

		await getLocalConfig(
			{query: {config: 'test-key'}, headers: {}} as unknown as Request,
			res,
		);

		expect(makeInternalRequest).toHaveBeenCalledWith(
			expect.objectContaining({apiKey: 'configured-key'}),
		);
	});

	it('forwards the key supplied via Basic Auth for a GET request', async () => {
		const {getLocalConfig, safeLookupConfig, makeInternalRequest} =
			loadController('configured-key');
		safeLookupConfig.mockReturnValue(configEntry);
		makeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify({code: 0, message: 'OK'}),
		});
		const {res} = createMockResponse();
		const encoded = Buffer.from(':browser-key').toString('base64');

		await getLocalConfig(
			{
				query: {config: 'test-key'},
				headers: {authorization: `Basic ${encoded}`},
			} as unknown as Request,
			res,
		);

		expect(makeInternalRequest).toHaveBeenCalledWith(
			expect.objectContaining({apiKey: 'browser-key'}),
		);
	});
});

describe('local-config controller without an API key configured', () => {
	it('allows a keyless POST when authentication is disabled', async () => {
		const {postLocalConfig, safeLookupConfig, makeInternalRequest} =
			loadController('');
		safeLookupConfig.mockReturnValue(configEntry);
		makeInternalRequest.mockResolvedValue({
			statusCode: 200,
			headers: {},
			body: JSON.stringify({code: 0, message: 'OK'}),
		});
		const {res, statusMock, jsonMock} = createMockResponse();

		await postLocalConfig(
			{body: {localConfig: 'test-key'}, headers: {}} as unknown as Request,
			res,
		);

		expect(statusMock).toHaveBeenCalledWith(200);
		expect(jsonMock).toHaveBeenCalledWith({code: 0, message: 'OK'});
	});
});
