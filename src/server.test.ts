describe('server bootstrap', () => {
	type FaviconHandler = (
		_req: unknown,
		res: {sendFile: (filePath: string) => unknown},
	) => unknown;
	type GuardScriptHandler = (
		_req: unknown,
		res: {
			setHeader: (name: string, value: string) => unknown;
			send: (body: unknown) => unknown;
		},
	) => unknown;
	type RootHandler = (
		_req: unknown,
		res: {
			setHeader: (name: string, value: string) => unknown;
			send: (body: unknown) => unknown;
		},
	) => unknown;
	type NotFoundHandler = (
		req: {url: string},
		res: {status: (code: number) => {send: (body: unknown) => unknown}},
	) => unknown;
	type GetRouteCall = [string, FaviconHandler | RootHandler];
	type UseCall = [string | NotFoundHandler, unknown?];

	afterEach(() => {
		jest.restoreAllMocks();
		jest.resetModules();
	});

	it('creates an HTTPS server, listens with configured host and port, and starts the scheduler', () => {
		jest.resetModules();

		const use = jest.fn();
		const get = jest.fn();
		const app = {use, get};
		const helmetMiddleware = 'helmet-middleware';
		const rateLimitMiddleware = 'rate-limit-middleware';
		const accessControlMiddleware = 'access-control-middleware';
		const json = jest.fn(() => 'json-middleware');
		const expressFactory = Object.assign(
			jest.fn(() => app),
			{json},
		);
		const listen = jest.fn(
			(port: number, host: string, callback?: () => void) => {
				callback?.();
				return {close: jest.fn()};
			},
		);
		const close = jest.fn((callback?: () => void) => {
			callback?.();
		});
		const on = jest.fn();
		const createServer = jest.fn(() => ({listen, close, on}));
		const readFileSync = jest
			.fn()
			.mockReturnValueOnce('CERT_CONTENT')
			.mockReturnValueOnce('KEY_CONTENT');
		const readdirSync = jest.fn(() => [
			'check_test.ts',
			'check_test.js',
			'check_debian_eol.ts',
			'check_noise.test.ts',
		]);
		const info = jest.fn();
		const warn = jest.fn();
		const error = jest.fn();
		const scheduler = jest.fn();
		const eventHandlers = new Map<string, (err: {message: string}) => void>();
		const processOnSpy = jest.spyOn(process, 'on').mockImplementation(((
			event: string,
			handler: (err: {message: string}) => void,
		) => {
			eventHandlers.set(event, handler);
			return process;
		}) as typeof process.on);
		const processExitSpy = jest
			.spyOn(process, 'exit')
			.mockImplementation((() => undefined) as never);

		jest.doMock('express', () => ({
			__esModule: true,
			default: expressFactory,
		}));
		jest.doMock('helmet', () => ({
			__esModule: true,
			default: jest.fn(() => helmetMiddleware),
		}));
		jest.doMock('express-rate-limit', () => ({
			__esModule: true,
			default: jest.fn(() => rateLimitMiddleware),
		}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {readFileSync, readdirSync},
			readFileSync,
			readdirSync,
		}));
		jest.doMock('https', () => ({
			__esModule: true,
			default: {createServer},
			createServer,
		}));
		jest.doMock('./config/env', () => ({
			env: {
				HOST: '127.0.0.1',
				PORT: 5443,
				NODE_ENV: 'production',
				ENABLE_SECURITY_MIDDLEWARE: true,
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
				API_KEY: '',
				API_KEY_HEADER: 'x-api-key',
				ALLOWED_IPS: '127.0.0.1',
				PLUGINS_DIR: 'plugins',
			},
		}));
		jest.doMock('./lib/tls', () => ({
			ensureTlsCertificate: jest.fn(() => ({
				certPath: '/tmp/nest-cert.pem',
				keyPath: '/tmp/nest-key.pem',
			})),
		}));
		jest.doMock('./lib/logger', () => ({logger: {info, warn, error}}));
		jest.doMock('./lib/security', () => ({
			createAccessControlMiddleware: jest.fn(() => accessControlMiddleware),
			getRecommendedSecurityWarnings: jest.fn(() => [
				'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
				'Security recommendation: ALLOWED_IPS is limited to loopback addresses (127.0.0.1, ::1); configure trusted monitoring source IPs if remote access is required.',
			]),
		}));
		jest.doMock('./lib/cron/scheduler', () => ({runScheduler: scheduler}));
		jest.doMock('./routes/app-info', () => ({
			__esModule: true,
			default: 'appInfoRouter',
		}));
		jest.doMock('./routes/honey-pot', () => ({
			__esModule: true,
			default: 'honeyPotRouter',
		}));
		jest.doMock('./routes/dynamic-routes', () => ({
			__esModule: true,
			default: 'dynamicRoutesRouter',
			pluginStartupWarnings: [
				'Plugin trust warning: plugins/check_test.ts is new or not whitelisted.',
			],
			registeredPluginRoutes: [
				'/plugins/check-test',
				'/plugins/check-debian-eol',
			],
		}));
		const recordHoneypotSignal = jest.fn();
		const recordNetworkProbeSignal = jest.fn();
		jest.doMock('./lib/honey-pot', () => ({
			recordHoneypotSignal,
			recordNetworkProbeSignal,
		}));
		jest.doMock('./lib/nagios', () => ({
			createNagiosReturnMessage: jest.fn(() => ({
				message: 'not-found',
				code: 3,
			})),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('./server');

		const getCalls = get.mock.calls as GetRouteCall[];
		const useCalls = use.mock.calls as UseCall[];
		const faviconCall = getCalls.find(([route]) => route === '/favicon.ico');
		const guardScriptCall = getCalls.find(
			([route]) => route === '/help/external-link-guard.js',
		);
		const rootCall = getCalls.find(([route]) => route === '/');
		const notFoundCall = useCalls.find(
			(call): call is [NotFoundHandler] => typeof call[0] === 'function',
		);
		const faviconSendFile = jest.fn();
		const guardScriptSetHeader = jest.fn();
		const guardScriptSend = jest.fn();
		const rootSetHeader = jest.fn();
		const rootSend = jest.fn();
		const send = jest.fn();
		const status = jest.fn(() => ({send}));

		expect(faviconCall).toBeDefined();
		expect(guardScriptCall).toBeDefined();
		expect(rootCall).toBeDefined();
		expect(notFoundCall).toBeDefined();

		const [, faviconHandler] = faviconCall as GetRouteCall;
		const [, guardScriptHandler] = guardScriptCall as [
			string,
			GuardScriptHandler,
		];
		const [, rootHandler] = rootCall as GetRouteCall;
		const [notFoundHandler] = notFoundCall as [NotFoundHandler];

		faviconHandler({}, {sendFile: faviconSendFile});
		guardScriptHandler(
			{},
			{
				setHeader: guardScriptSetHeader,
				send: guardScriptSend,
			},
		);
		rootHandler({}, {setHeader: rootSetHeader, send: rootSend});
		notFoundHandler({url: '/missing'}, {status});

		eventHandlers.get('unhandledRejection')?.({message: 'rejection'});
		eventHandlers.get('uncaughtException')?.({message: 'exception'});
		eventHandlers.get('SIGTERM')?.({message: 'shutdown'});

		expect(expressFactory).toHaveBeenCalledTimes(1);
		expect(json).toHaveBeenCalledTimes(1);
		expect(get).toHaveBeenCalledWith('/favicon.ico', expect.any(Function));
		expect(get).toHaveBeenCalledWith(
			'/help/external-link-guard.js',
			expect.any(Function),
		);
		expect(get).toHaveBeenCalledWith('/', expect.any(Function));
		expect(use).toHaveBeenCalledWith('json-middleware');
		expect(use).toHaveBeenCalledWith(helmetMiddleware);
		expect(use).toHaveBeenCalledWith(rateLimitMiddleware);
		expect(use).toHaveBeenCalledWith(accessControlMiddleware);
		expect(use).toHaveBeenCalledWith('/', 'dynamicRoutesRouter');
		expect(use).toHaveBeenCalledWith('/nagios', 'appInfoRouter');
		expect(use).toHaveBeenCalledWith('/nagios/honey-pot', 'honeyPotRouter');
		expect(warn).toHaveBeenCalledWith(
			'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
		);
		expect(warn).toHaveBeenCalledWith(
			'Security recommendation: ALLOWED_IPS is limited to loopback addresses (127.0.0.1, ::1); configure trusted monitoring source IPs if remote access is required.',
		);
		expect(faviconSendFile).toHaveBeenCalledWith(
			expect.stringContaining('/favicon.ico'),
		);
		expect(guardScriptSetHeader).toHaveBeenCalledWith(
			'Content-Type',
			'application/javascript; charset=utf-8',
		);
		expect(guardScriptSend).toHaveBeenCalledWith(
			expect.stringContaining('window.confirm'),
		);
		expect(rootSetHeader).toHaveBeenCalledWith(
			'Content-Type',
			'text/html; charset=utf-8',
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('Nest Route Overview'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('href="/favicon.ico"'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('<img src="/favicon.ico"'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('/nagios?help'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('/nagios/honey-pot?help'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('https://github.com/some-git-user/nest'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('/plugins/check-test?help'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('/plugins/check-debian-eol?help'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('Startup Warnings'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining(
				'Plugin trust warning: plugins/check_test.ts is new or not whitelisted.',
			),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining(
				'Security recommendation: API_KEY is not configured',
			),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining(
				'Security recommendation: ALLOWED_IPS is limited to loopback addresses (127.0.0.1, ::1)',
			),
		);
		expect(status).toHaveBeenCalledWith(404);
		expect(send).toHaveBeenCalledWith({message: 'not-found', code: 3});
		expect(recordHoneypotSignal).toHaveBeenCalledWith(
			{url: '/missing'},
			'unknown-route',
		);
		expect(createServer).toHaveBeenCalledWith(
			{
				cert: 'CERT_CONTENT',
				key: 'KEY_CONTENT',
			},
			app,
		);
		expect(on).toHaveBeenCalledWith('tlsClientError', expect.any(Function));
		expect(on).toHaveBeenCalledWith('clientError', expect.any(Function));

		// Invoke the registered server event callbacks to cover getRemoteIp branches
		type ServerOnCall = [string, (_err: unknown, socket: unknown) => void];
		const serverOnCalls = on.mock.calls as ServerOnCall[];
		const tlsHandler = serverOnCalls.find(([e]) => e === 'tlsClientError')?.[1];
		const httpHandler = serverOnCalls.find(([e]) => e === 'clientError')?.[1];
		expect(tlsHandler).toBeDefined();
		expect(httpHandler).toBeDefined();

		// Branch: non-object primitive
		tlsHandler!(new Error('tls'), 'not-an-object');
		// Branch: null
		tlsHandler!(new Error('tls'), null);
		// Branch: object without remoteAddress
		tlsHandler!(new Error('tls'), {});
		// Branch: object with non-string remoteAddress
		tlsHandler!(new Error('tls'), {remoteAddress: 0});
		// Branch: object with empty string remoteAddress
		tlsHandler!(new Error('tls'), {remoteAddress: ''});
		// Branch: object with valid remoteAddress (tls)
		tlsHandler!(new Error('tls'), {remoteAddress: '10.0.0.1'});
		// Branch: clientError handler with valid socket
		httpHandler!(new Error('http'), {remoteAddress: '10.0.0.2'});

		expect(recordNetworkProbeSignal).toHaveBeenCalledWith(
			'unknown',
			'tls-client-error',
		);
		expect(recordNetworkProbeSignal).toHaveBeenCalledWith(
			'10.0.0.1',
			'tls-client-error',
		);
		expect(recordNetworkProbeSignal).toHaveBeenCalledWith(
			'10.0.0.2',
			'http-client-error',
		);

		expect(readFileSync).toHaveBeenCalledWith('/tmp/nest-cert.pem');
		expect(readFileSync).toHaveBeenCalledWith('/tmp/nest-key.pem');
		expect(listen).toHaveBeenCalledWith(
			5443,
			'127.0.0.1',
			expect.any(Function),
		);
		expect(scheduler).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith(
			expect.stringContaining(
				'HTTPS server running in production mode on host 127.0.0.1 and port 5443',
			),
		);
		expect(info).toHaveBeenCalledWith(
			'Started application in production mode...',
		);
		expect(processOnSpy).toHaveBeenCalledWith(
			'unhandledRejection',
			expect.any(Function),
		);
		expect(processOnSpy).toHaveBeenCalledWith(
			'uncaughtException',
			expect.any(Function),
		);
		expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
		expect(error).toHaveBeenCalledWith('Error: rejection');
		expect(error).toHaveBeenCalledWith('Error: exception');
		expect(error).toHaveBeenCalledWith('Error: shutdown');
		expect(close).toHaveBeenCalledTimes(3);
		expect(processExitSpy).toHaveBeenCalledWith(1);
	});

	it('does not register rate limit or access-control middleware when disabled', () => {
		jest.resetModules();

		const use = jest.fn();
		const get = jest.fn();
		const app = {use, get};
		const helmetMiddleware = 'helmet-middleware';
		const rateLimitMiddleware = 'rate-limit-middleware';
		const accessControlMiddleware = 'access-control-middleware';
		const json = jest.fn(() => 'json-middleware');
		const expressFactory = Object.assign(
			jest.fn(() => app),
			{json},
		);
		const listen = jest.fn(
			(port: number, host: string, callback?: () => void) => {
				callback?.();
				return {close: jest.fn()};
			},
		);
		const on = jest.fn();
		const createServer = jest.fn(() => ({listen, close: jest.fn(), on}));
		const readFileSync = jest
			.fn()
			.mockReturnValueOnce('CERT_CONTENT')
			.mockReturnValueOnce('KEY_CONTENT');
		const readdirSync = jest.fn(() => []);
		const info = jest.fn();
		const warn = jest.fn();
		const error = jest.fn();
		const scheduler = jest.fn();

		jest.doMock('express', () => ({
			__esModule: true,
			default: expressFactory,
		}));
		jest.doMock('helmet', () => ({
			__esModule: true,
			default: jest.fn(() => helmetMiddleware),
		}));
		jest.doMock('express-rate-limit', () => ({
			__esModule: true,
			default: jest.fn(() => rateLimitMiddleware),
		}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {readFileSync, readdirSync},
			readFileSync,
			readdirSync,
		}));
		jest.doMock('https', () => ({
			__esModule: true,
			default: {createServer},
			createServer,
		}));
		jest.doMock('./config/env', () => ({
			env: {
				HOST: '127.0.0.1',
				PORT: 5443,
				NODE_ENV: 'production',
				ENABLE_SECURITY_MIDDLEWARE: false,
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
				API_KEY: '',
				API_KEY_HEADER: 'x-api-key',
				ALLOWED_IPS: '127.0.0.1',
				PLUGINS_DIR: 'plugins',
			},
		}));
		jest.doMock('./lib/tls', () => ({
			ensureTlsCertificate: jest.fn(() => ({
				certPath: '/tmp/nest-cert.pem',
				keyPath: '/tmp/nest-key.pem',
			})),
		}));
		jest.doMock('./lib/logger', () => ({logger: {info, warn, error}}));
		jest.doMock('./lib/security', () => ({
			createAccessControlMiddleware: jest.fn(() => accessControlMiddleware),
			getRecommendedSecurityWarnings: jest.fn(() => []),
		}));
		jest.doMock('./lib/cron/scheduler', () => ({runScheduler: scheduler}));
		jest.doMock('./routes/app-info', () => ({
			__esModule: true,
			default: 'appInfoRouter',
		}));
		jest.doMock('./routes/honey-pot', () => ({
			__esModule: true,
			default: 'honeyPotRouter',
		}));
		jest.doMock('./routes/dynamic-routes', () => ({
			__esModule: true,
			default: 'dynamicRoutesRouter',
			pluginStartupWarnings: [],
			registeredPluginRoutes: [],
		}));
		jest.doMock('./lib/honey-pot', () => ({
			recordHoneypotSignal: jest.fn(),
			recordNetworkProbeSignal: jest.fn(),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('./server');
		const getCalls = get.mock.calls as GetRouteCall[];
		const rootCall = getCalls.find(([route]) => route === '/');
		const rootSetHeader = jest.fn();
		const rootSend = jest.fn();
		expect(rootCall).toBeDefined();
		const [, rootHandler] = rootCall as GetRouteCall;
		rootHandler({}, {setHeader: rootSetHeader, send: rootSend});

		expect(expressFactory).toHaveBeenCalledTimes(1);
		expect(use).toHaveBeenCalledWith('json-middleware');
		expect(use).toHaveBeenCalledWith(helmetMiddleware);
		expect(use).not.toHaveBeenCalledWith(rateLimitMiddleware);
		expect(use).not.toHaveBeenCalledWith(accessControlMiddleware);
		expect(rootSetHeader).toHaveBeenCalledWith(
			'Content-Type',
			'text/html; charset=utf-8',
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('No plugins found'),
		);
		expect(scheduler).toHaveBeenCalledTimes(1);
	});

	it('uses default rate-limit values when env values are non-positive', () => {
		jest.resetModules();

		const use = jest.fn();
		const get = jest.fn();
		const app = {use, get};
		const helmetMiddleware = 'helmet-middleware';
		const rateLimitMiddleware = 'rate-limit-middleware';
		const accessControlMiddleware = 'access-control-middleware';
		const json = jest.fn(() => 'json-middleware');
		const expressFactory = Object.assign(
			jest.fn(() => app),
			{json},
		);
		const rateLimit = jest.fn(() => rateLimitMiddleware);
		const listen = jest.fn(
			(port: number, host: string, callback?: () => void) => {
				callback?.();
				return {close: jest.fn()};
			},
		);
		const createServer = jest.fn(() => ({
			listen,
			close: jest.fn(),
			on: jest.fn(),
		}));

		jest.doMock('express', () => ({
			__esModule: true,
			default: expressFactory,
		}));
		jest.doMock('helmet', () => ({
			__esModule: true,
			default: jest.fn(() => helmetMiddleware),
		}));
		jest.doMock('express-rate-limit', () => ({
			__esModule: true,
			default: rateLimit,
		}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				readFileSync: jest
					.fn()
					.mockReturnValueOnce('CERT_CONTENT')
					.mockReturnValueOnce('KEY_CONTENT'),
			},
			readFileSync: jest
				.fn()
				.mockReturnValueOnce('CERT_CONTENT')
				.mockReturnValueOnce('KEY_CONTENT'),
		}));
		jest.doMock('https', () => ({
			__esModule: true,
			default: {createServer},
			createServer,
		}));
		jest.doMock('./config/env', () => ({
			env: {
				HOST: '127.0.0.1',
				PORT: 5443,
				NODE_ENV: 'production',
				ENABLE_SECURITY_MIDDLEWARE: true,
				RATE_LIMIT_WINDOW_MS: 0,
				RATE_LIMIT_MAX: 0,
				API_KEY: '',
				API_KEY_HEADER: 'x-api-key',
				ALLOWED_IPS: '127.0.0.1',
				PLUGINS_DIR: 'plugins',
			},
		}));
		jest.doMock('./lib/tls', () => ({
			ensureTlsCertificate: jest.fn(() => ({
				certPath: '/tmp/nest-cert.pem',
				keyPath: '/tmp/nest-key.pem',
			})),
		}));
		jest.doMock('./lib/logger', () => ({
			logger: {info: jest.fn(), warn: jest.fn(), error: jest.fn()},
		}));
		jest.doMock('./lib/security', () => ({
			createAccessControlMiddleware: jest.fn(() => accessControlMiddleware),
			getRecommendedSecurityWarnings: jest.fn(() => []),
		}));
		jest.doMock('./lib/cron/scheduler', () => ({runScheduler: jest.fn()}));
		jest.doMock('./routes/app-info', () => ({
			__esModule: true,
			default: 'appInfoRouter',
		}));
		jest.doMock('./routes/honey-pot', () => ({
			__esModule: true,
			default: 'honeyPotRouter',
		}));
		jest.doMock('./routes/dynamic-routes', () => ({
			__esModule: true,
			default: 'dynamicRoutesRouter',
			pluginStartupWarnings: [],
			registeredPluginRoutes: [],
		}));
		jest.doMock('./lib/honey-pot', () => ({
			recordHoneypotSignal: jest.fn(),
			recordNetworkProbeSignal: jest.fn(),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('./server');

		expect(rateLimit).toHaveBeenCalledWith(
			expect.objectContaining({
				windowMs: 60_000,
				max: 120,
			}),
		);
	});
});
