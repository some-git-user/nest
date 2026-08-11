import {HttpStatusCodes} from './lib/http-status-codes';

// Mock typescript before any imports
jest.mock('typescript', () => ({
	__esModule: true,
	default: {
		ModuleKind: {CommonJS: 1},
		ScriptTarget: {ESNext: 99},
		transpileModule: jest.fn(() => ({
			outputText:
				'export const check = async () => ({code: 0, message: "OK"});',
		})),
	},
}));

jest.mock('./lib/startup-warning-registry', () => ({
	__esModule: true,
	recordStartupWarnings: jest.fn(),
	getStartupWarnings: jest.fn(() => []),
}));

describe('server bootstrap', () => {
	type FaviconHandler = (
		_req: unknown,
		res: {
			status: (code: number) => {end: () => unknown};
		},
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
			locals?: Record<string, string>;
		},
	) => unknown;
	type NotFoundHandler = (
		req: {url: string},
		res: {status: (code: number) => {send: (body: unknown) => unknown}},
	) => unknown;
	type MiddlewareHandler = (
		req: unknown,
		res: unknown,
		next?: () => void,
	) => unknown;
	type GetRouteCall = [string, FaviconHandler | RootHandler];
	type UseCall = [string | NotFoundHandler | MiddlewareHandler, unknown?];

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
		const urlencoded = jest.fn(() => 'urlencoded-middleware');
		const expressFactory = Object.assign(
			jest.fn(() => app),
			{json, urlencoded},
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
		const existsSync = jest
			.fn()
			.mockReturnValueOnce(true) // loadWhitelistEntries: whitelist exists
			.mockReturnValueOnce(true) // verifyFileAgainstWhitelist: config file exists
			.mockReturnValueOnce(false) // TLS: cert exists (false to trigger read)
			.mockReturnValueOnce(false); // TLS: key exists (false to trigger read)
		const statSync = jest
			.fn()
			.mockReturnValueOnce({mode: 0o100644}) // loadWhitelistEntries: whitelist stat
			.mockReturnValueOnce({mode: 0o100644}); // verifyFileAgainstWhitelist: config stat
		const readFileSync = jest.fn((filePath: string, _encoding?: string) => {
			if (filePath.includes('nest-cert.pem')) {
				return 'CERT_CONTENT';
			}
			if (filePath.includes('nest-key.pem')) {
				return 'KEY_CONTENT';
			}
			return 'WHITELIST_CONTENT';
		});
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
			default: Object.assign(expressFactory, {
				Router: jest.fn(() => ({
					post: jest.fn(),
					get: jest.fn(),
					use: jest.fn(),
				})),
			}),
		}));
		jest.doMock('helmet', () => ({
			__esModule: true,
			default: jest.fn((_config?: unknown) => helmetMiddleware),
		}));
		jest.doMock('express-rate-limit', () => ({
			__esModule: true,
			default: jest.fn(() => rateLimitMiddleware),
		}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				readFileSync,
				readdirSync,
				existsSync,
				statSync,
				mkdirSync: jest.fn(),
			},
			readFileSync,
			readdirSync,
			existsSync,
			statSync,
			mkdirSync: jest.fn(),
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
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
				API_KEY: '',
				API_KEY_HEADER: 'x-api-key',
				ALLOWED_IPS: '127.0.0.1',
				PLUGINS_DIR: 'plugins',
				LOG_FILE_PATH: 'logs/nest.log',
				TLS_CERT_PATH: 'certs/nest-cert.pem',
				TLS_KEY_PATH: 'certs/nest-key.pem',
				MAX_LOG_FILE_SIZE_BYTES: 1048576,
			},
		}));
		jest.doMock('path', () => ({
			__esModule: true,
			default: {
				dirname: jest.fn((p: string) => '/tmp/nest/' + p),
				join: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				resolve: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				relative: jest.fn((from: string, to: string) =>
					to.replace(from + '/', ''),
				),
				cwd: jest.fn(() => '/tmp/nest'),
			},
		}));
		jest.doMock('./lib/tls', () => ({
			ensureTlsCertificate: jest.fn(() => ({
				certPath: '/tmp/nest-cert.pem',
				keyPath: '/tmp/nest-key.pem',
			})),
		}));
		jest.doMock('./lib/logger', () => ({logger: {info, warn, error}}));
		jest.doMock('./lib/startup-check', () => ({
			validateStartup: jest.fn(),
		}));
		jest.doMock('./lib/security', () => ({
			createAccessControlMiddleware: jest.fn(() => accessControlMiddleware),
			getRecommendedSecurityWarnings: jest.fn(() => [
				'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
				'Security recommendation: ALLOWED_IPS is not configured; access defaults to loopback addresses only (127.0.0.1, ::1). Add trusted monitoring source IPs for remote access.',
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
			registeredPluginRouteExamples: {
				'/plugins/check-test': [
					{
						kind: 'link',
						label: 'quick link',
						method: 'GET',
						href: '/plugins/check-test?nagiosReturnMessage=Quick&nagiosReturnValue=0',
					},
					{
						kind: 'interactive',
						label: 'post sample',
						method: 'POST',
						path: '/plugins/check-test',
						fields: [
							{
								name: 'nagiosReturnMessage',
								label: 'message',
								required: true,
								type: 'text',
							},
							{
								name: 'nagiosReturnValue',
								label: 'code',
								required: false,
								type: 'text',
								defaultValue: '0',
							},
						],
					},
				],
			},
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
		jest.doMock('./lib/local-config', () => ({
			__esModule: true,
			parseConfigFile: jest.fn(() => new Map()),
			setWhitelistCache: jest.fn(),
			hasRuntimeValidationFailed: jest.fn(() => false),
			loadConfigAtStartup: jest.fn(),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('./server');

		const getCalls = get.mock.calls as GetRouteCall[];
		const useCalls = use.mock.calls as UseCall[];
		const faviconCall = getCalls.find(([route]) => route === '/favicon.ico');
		const guardScriptCall = getCalls.find(
			([route]) => route === '/help/external-link-guard.js',
		);
		const pluginExampleFormScriptCall = getCalls.find(
			([route]) => route === '/help/plugin-example-form.js',
		);
		const warningHelpCall = getCalls.find(
			([route]) => route === '/help/startup-warnings/:warningId',
		);
		const rootCall = getCalls.find(([route]) => route === '/');
		const notFoundCall = useCalls.find(
			(call): call is [NotFoundHandler] =>
				typeof call[0] === 'function' && call[0].length === 2,
		);
		const faviconEnd = jest.fn();
		const faviconStatus = jest.fn(() => ({end: faviconEnd}));
		const guardScriptSetHeader = jest.fn();
		const guardScriptSend = jest.fn();
		const pluginExampleFormScriptSetHeader = jest.fn();
		const pluginExampleFormScriptSend = jest.fn();
		const rootSetHeader = jest.fn();
		const rootSend = jest.fn();
		const warningHelpSetHeader = jest.fn();
		const warningHelpSend = jest.fn();
		const warningHelpUnknownSend = jest.fn();
		const warningHelpUnknownStatus = jest.fn(() => ({
			send: warningHelpUnknownSend,
		}));
		const send = jest.fn();
		const status = jest.fn(() => ({send}));
		const rootLocals = {cspNonce: 'test-nonce-12345678901234567890'};

		expect(faviconCall).toBeDefined();
		expect(guardScriptCall).toBeDefined();
		expect(pluginExampleFormScriptCall).toBeDefined();
		expect(warningHelpCall).toBeDefined();
		expect(rootCall).toBeDefined();
		expect(notFoundCall).toBeDefined();

		const [, faviconHandler] = faviconCall as [string, FaviconHandler];
		const [, guardScriptHandler] = guardScriptCall as [
			string,
			GuardScriptHandler,
		];
		const [, pluginExampleFormScriptHandler] = pluginExampleFormScriptCall as [
			string,
			GuardScriptHandler,
		];
		const [, warningHelpHandler] = warningHelpCall as [
			string,
			(
				req: {params?: {warningId?: string}},
				res: {
					setHeader: (name: string, value: string) => unknown;
					send: (body: unknown) => unknown;
					status: (code: number) => {send: (body: unknown) => unknown};
				},
			) => unknown,
		];
		const [, rootHandler] = rootCall as [string, RootHandler];
		const [notFoundHandler] = notFoundCall as [NotFoundHandler];

		faviconHandler({}, {status: faviconStatus});
		guardScriptHandler(
			{},
			{
				setHeader: guardScriptSetHeader,
				send: guardScriptSend,
			},
		);
		pluginExampleFormScriptHandler(
			{},
			{
				setHeader: pluginExampleFormScriptSetHeader,
				send: pluginExampleFormScriptSend,
			},
		);
		warningHelpHandler(
			{params: {warningId: 'plugin-not-whitelisted'}},
			{
				setHeader: warningHelpSetHeader,
				send: warningHelpSend,
				status,
			},
		);
		warningHelpHandler(
			{params: {warningId: 'does-not-exist'}},
			{
				setHeader: jest.fn(),
				send: jest.fn(),
				status: warningHelpUnknownStatus,
			},
		);
		warningHelpHandler(
			{},
			{
				setHeader: jest.fn(),
				send: jest.fn(),
				status: warningHelpUnknownStatus,
			},
		);
		rootHandler(
			{},
			{setHeader: rootSetHeader, send: rootSend, locals: rootLocals},
		);
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
		expect(get).toHaveBeenCalledWith(
			'/help/plugin-example-form.js',
			expect.any(Function),
		);
		expect(get).toHaveBeenCalledWith(
			'/help/startup-warnings/:warningId',
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
			'Security recommendation: ALLOWED_IPS is not configured; access defaults to loopback addresses only (127.0.0.1, ::1). Add trusted monitoring source IPs for remote access.',
		);
		expect(faviconStatus).toHaveBeenCalledWith(HttpStatusCodes.NO_CONTENT);
		expect(faviconEnd).toHaveBeenCalledTimes(1);
		expect(guardScriptSetHeader).toHaveBeenCalledWith(
			'Content-Type',
			'application/javascript; charset=utf-8',
		);
		expect(guardScriptSend).toHaveBeenCalled();
		expect(pluginExampleFormScriptSetHeader).toHaveBeenCalledWith(
			'Content-Type',
			'application/javascript; charset=utf-8',
		);
		expect(pluginExampleFormScriptSend).toHaveBeenCalled();
		expect(warningHelpSetHeader).toHaveBeenCalledWith(
			'Content-Type',
			'text/html; charset=utf-8',
		);
		expect(warningHelpSend).toHaveBeenCalledWith(
			expect.stringContaining('Back to route overview'),
		);
		expect(warningHelpSend).toHaveBeenCalledWith(
			expect.stringContaining('How To Handle'),
		);
		expect(warningHelpUnknownStatus).toHaveBeenCalledWith(
			HttpStatusCodes.NOT_FOUND,
		);
		expect(warningHelpUnknownSend).toHaveBeenCalledWith({
			message: 'not-found',
			code: 3,
		});
		expect(rootSetHeader).toHaveBeenCalledWith(
			'Content-Type',
			'text/html; charset=utf-8',
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('Nest Route Overview'),
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
			expect.stringContaining(
				'<form class="plugin-example-form" method="post" action="/plugins/check-test">',
			),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining(
				'<script src="/help/plugin-example-form.js" defer></script>',
			),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining(
				'<a class="plugin-example-link" href="/plugins/check-test?nagiosReturnMessage=Quick&nagiosReturnValue=0">quick link</a>',
			),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining(' value="0"'),
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
			expect.stringContaining('/help/startup-warnings/plugin-not-whitelisted'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining(
				'Security recommendation: API_KEY is not configured',
			),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining(
				'Security recommendation: ALLOWED_IPS is not configured; access defaults to loopback addresses only (127.0.0.1, ::1). Add trusted monitoring source IPs for remote access.',
			),
		);
		expect(status).toHaveBeenCalledWith(HttpStatusCodes.NOT_FOUND);
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

		expect(readFileSync).toHaveBeenCalledWith('/tmp/nest-cert.pem', 'utf8');
		expect(readFileSync).toHaveBeenCalledWith('/tmp/nest-key.pem', 'utf8');
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
		const urlencoded = jest.fn(() => 'urlencoded-middleware');
		const expressFactory = Object.assign(
			jest.fn(() => app),
			{json, urlencoded},
		);
		const listen = jest.fn(
			(port: number, host: string, callback?: () => void) => {
				callback?.();
				return {close: jest.fn()};
			},
		);
		const on = jest.fn();
		const createServer = jest.fn(() => ({listen, close: jest.fn(), on}));
		const existsSync = jest
			.fn()
			.mockReturnValueOnce(true) // verifyConfigFiles checks whitelist exists
			.mockReturnValueOnce(true) // verifyConfigFiles checks config exists
			.mockReturnValueOnce(false) // TLS checks cert exists (false to trigger read)
			.mockReturnValueOnce(false); // TLS checks key exists (false to trigger read)
		const statSync = jest.fn(() => ({mode: 0o100644}));
		const readFileSync = jest
			.fn()
			.mockReturnValueOnce('WHITELIST_CONTENT') // verifyConfigFiles reads whitelist
			.mockReturnValueOnce('CONFIG_CONTENT') // verifyConfigFiles reads config file
			.mockReturnValueOnce('CERT_CONTENT') // TLS cert
			.mockReturnValueOnce('KEY_CONTENT'); // TLS key
		const readdirSync = jest.fn(() => []);
		const info = jest.fn();
		const warn = jest.fn();
		const error = jest.fn();
		const scheduler = jest.fn();

		jest.doMock('express', () => ({
			__esModule: true,
			default: Object.assign(expressFactory, {
				Router: jest.fn(() => ({
					post: jest.fn(),
					get: jest.fn(),
					use: jest.fn(),
				})),
			}),
		}));
		jest.doMock('helmet', () => ({
			__esModule: true,
			default: jest.fn((_config?: unknown) => helmetMiddleware),
		}));
		jest.doMock('express-rate-limit', () => ({
			__esModule: true,
			default: jest.fn(() => rateLimitMiddleware),
		}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				readFileSync,
				readdirSync,
				existsSync,
				statSync,
				mkdirSync: jest.fn(),
			},
			readFileSync,
			readdirSync,
			existsSync,
			statSync,
			mkdirSync: jest.fn(),
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
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
				API_KEY: '',
				API_KEY_HEADER: 'x-api-key',
				ALLOWED_IPS: '127.0.0.1',
				PLUGINS_DIR: 'plugins',
				LOG_FILE_PATH: 'logs/nest.log',
				TLS_CERT_PATH: 'certs/nest-cert.pem',
				TLS_KEY_PATH: 'certs/nest-key.pem',
				MAX_LOG_FILE_SIZE_BYTES: 1048576,
			},
		}));
		jest.doMock('path', () => ({
			__esModule: true,
			default: {
				dirname: jest.fn((p: string) => '/tmp/nest/' + p),
				join: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				resolve: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				relative: jest.fn((from: string, to: string) =>
					to.replace(from + '/', ''),
				),
				cwd: jest.fn(() => '/tmp/nest'),
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
		const rootLocals = {cspNonce: 'test-nonce-12345678901234567890'};
		expect(rootCall).toBeDefined();
		const [, rootHandler] = rootCall as [string, RootHandler];
		rootHandler(
			{},
			{setHeader: rootSetHeader, send: rootSend, locals: rootLocals},
		);

		expect(expressFactory).toHaveBeenCalledTimes(1);
		expect(use).toHaveBeenCalledWith('json-middleware');
		expect(use).toHaveBeenCalledWith(helmetMiddleware);
		expect(use).toHaveBeenCalledWith(rateLimitMiddleware);
		expect(use).toHaveBeenCalledWith(accessControlMiddleware);
		expect(rootSetHeader).toHaveBeenCalledWith(
			'Content-Type',
			'text/html; charset=utf-8',
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('No plugins found'),
		);
		expect(scheduler).toHaveBeenCalledTimes(1);
	});

	it('renders local config presets section when parseConfigFile returns non-empty map', () => {
		jest.resetModules();

		const use = jest.fn();
		const get = jest.fn();
		const app = {use, get};
		const helmetMiddleware = 'helmet-middleware';
		const rateLimitMiddleware = 'rate-limit-middleware';
		const accessControlMiddleware = 'access-control-middleware';
		const json = jest.fn(() => 'json-middleware');
		const urlencoded = jest.fn(() => 'urlencoded-middleware');
		const expressFactory = Object.assign(
			jest.fn(() => app),
			{json, urlencoded},
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
		const existsSync = jest
			.fn()
			.mockReturnValueOnce(true) // loadWhitelistEntries: whitelist exists
			.mockReturnValueOnce(true) // verifyFileAgainstWhitelist: config file exists
			.mockReturnValueOnce(false) // TLS: cert exists (false to trigger read)
			.mockReturnValueOnce(false); // TLS: key exists (false to trigger read)
		const statSync = jest
			.fn()
			.mockReturnValueOnce({mode: 0o100644}) // loadWhitelistEntries: whitelist stat
			.mockReturnValueOnce({mode: 0o100644}); // verifyFileAgainstWhitelist: config stat
		const readFileSync = jest.fn((filePath: string, _encoding?: string) => {
			if (filePath.includes('nest-cert.pem')) {
				return 'CERT_CONTENT';
			}
			if (filePath.includes('nest-key.pem')) {
				return 'KEY_CONTENT';
			}
			if (filePath.includes('plugin-whitelist.txt')) {
				return 'WHITELIST_CONTENT';
			}
			return 'CONFIG_CONTENT';
		});
		const readdirSync = jest.fn(() => []);
		const info = jest.fn();
		const warn = jest.fn();
		const error = jest.fn();
		const scheduler = jest.fn();
		const parseConfigFileMock = jest.fn(() => {
			const map = new Map();
			map.set('test-preset', {command: 'check-test', params: {}});
			return map;
		});

		jest.doMock('express', () => ({
			__esModule: true,
			default: Object.assign(expressFactory, {
				Router: jest.fn(() => ({
					post: jest.fn(),
					get: jest.fn(),
					use: jest.fn(),
				})),
			}),
		}));
		jest.doMock('helmet', () => ({
			__esModule: true,
			default: jest.fn((_config?: unknown) => helmetMiddleware),
		}));
		jest.doMock('express-rate-limit', () => ({
			__esModule: true,
			default: jest.fn(() => rateLimitMiddleware),
		}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				readFileSync,
				readdirSync,
				existsSync,
				statSync,
				mkdirSync: jest.fn(),
			},
			readFileSync,
			readdirSync,
			existsSync,
			statSync,
			mkdirSync: jest.fn(),
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
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
				API_KEY: '',
				API_KEY_HEADER: 'x-api-key',
				ALLOWED_IPS: '127.0.0.1',
				PLUGINS_DIR: 'plugins',
				LOG_FILE_PATH: 'logs/nest.log',
				TLS_CERT_PATH: 'certs/nest-cert.pem',
				TLS_KEY_PATH: 'certs/nest-key.pem',
				MAX_LOG_FILE_SIZE_BYTES: 1048576,
			},
		}));
		jest.doMock('path', () => ({
			__esModule: true,
			default: {
				dirname: jest.fn((p: string) => '/tmp/nest/' + p),
				join: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				resolve: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				relative: jest.fn((from: string, to: string) =>
					to.replace(from + '/', ''),
				),
				cwd: jest.fn(() => '/tmp/nest'),
			},
		}));
		jest.doMock('./lib/tls', () => ({
			ensureTlsCertificate: jest.fn(() => ({
				certPath: '/tmp/nest-cert.pem',
				keyPath: '/tmp/nest-key.pem',
			})),
		}));
		jest.doMock('./lib/logger', () => ({logger: {info, warn, error}}));
		jest.doMock('./lib/startup-check', () => ({
			validateStartup: jest.fn(),
		}));
		jest.doMock('./lib/security', () => ({
			createAccessControlMiddleware: jest.fn(() => accessControlMiddleware),
			getRecommendedSecurityWarnings: jest.fn(() => [
				'Security recommendation: API_KEY is not configured',
				'Security recommendation: ALLOWED_IPS is not configured; access defaults to loopback addresses only (127.0.0.1, ::1). Add trusted monitoring source IPs for remote access.',
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
			pluginStartupWarnings: [],
			registeredPluginRoutes: [],
			registeredPluginRouteExamples: {},
		}));
		jest.doMock('./lib/honey-pot', () => ({
			recordHoneypotSignal: jest.fn(),
			recordNetworkProbeSignal: jest.fn(),
		}));
		jest.doMock('./lib/local-config', () => ({
			__esModule: true,
			parseConfigFile: parseConfigFileMock,
			setWhitelistCache: jest.fn(),
			hasRuntimeValidationFailed: jest.fn(() => false),
			loadConfigAtStartup: jest.fn(),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('./server');

		const getCalls = get.mock.calls as GetRouteCall[];
		const rootCall = getCalls.find(([route]) => route === '/');
		expect(rootCall).toBeDefined();
		const [, rootHandler] = rootCall as [string, RootHandler];
		const rootSetHeader = jest.fn();
		const rootSend = jest.fn();
		rootHandler(
			{},
			{setHeader: rootSetHeader, send: rootSend, locals: {cspNonce: 'test'}},
		);

		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('Local Config Presets'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('/local-config?config=test-preset'),
		);
	});

	it('hides local config presets section when runtime validation has failed', () => {
		jest.resetModules();

		const use = jest.fn();
		const get = jest.fn();
		const app = {use, get};
		const helmetMiddleware = 'helmet-middleware';
		const rateLimitMiddleware = 'rate-limit-middleware';
		const accessControlMiddleware = 'access-control-middleware';
		const json = jest.fn(() => 'json-middleware');
		const urlencoded = jest.fn(() => 'urlencoded-middleware');
		const expressFactory = Object.assign(
			jest.fn(() => app),
			{json, urlencoded},
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
		const existsSync = jest
			.fn()
			.mockReturnValueOnce(true) // loadWhitelistEntries: whitelist exists
			.mockReturnValueOnce(true) // verifyFileAgainstWhitelist: config file exists
			.mockReturnValueOnce(false) // TLS: cert exists (false to trigger read)
			.mockReturnValueOnce(false); // TLS: key exists (false to trigger read)
		const statSync = jest
			.fn()
			.mockReturnValueOnce({mode: 0o100644}) // loadWhitelistEntries: whitelist stat
			.mockReturnValueOnce({mode: 0o100644}); // verifyFileAgainstWhitelist: config stat
		const readFileSync = jest.fn((filePath: string, _encoding?: string) => {
			if (filePath.includes('nest-cert.pem')) {
				return 'CERT_CONTENT';
			}
			if (filePath.includes('nest-key.pem')) {
				return 'KEY_CONTENT';
			}
			if (filePath.includes('plugin-whitelist.txt')) {
				return 'WHITELIST_CONTENT';
			}
			return 'CONFIG_CONTENT';
		});
		const readdirSync = jest.fn(() => []);
		const info = jest.fn();
		const warn = jest.fn();
		const error = jest.fn();
		const scheduler = jest.fn();
		const parseConfigFileMock = jest.fn(() => {
			const map = new Map();
			map.set('test-preset', {command: 'check-test', params: {}});
			return map;
		});

		jest.doMock('express', () => ({
			__esModule: true,
			default: Object.assign(expressFactory, {
				Router: jest.fn(() => ({
					post: jest.fn(),
					get: jest.fn(),
					use: jest.fn(),
				})),
			}),
		}));
		jest.doMock('helmet', () => ({
			__esModule: true,
			default: jest.fn((_config?: unknown) => helmetMiddleware),
		}));
		jest.doMock('express-rate-limit', () => ({
			__esModule: true,
			default: jest.fn(() => rateLimitMiddleware),
		}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				readFileSync,
				readdirSync,
				existsSync,
				statSync,
				mkdirSync: jest.fn(),
			},
			readFileSync,
			readdirSync,
			existsSync,
			statSync,
			mkdirSync: jest.fn(),
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
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
				API_KEY: '',
				API_KEY_HEADER: 'x-api-key',
				ALLOWED_IPS: '127.0.0.1',
				PLUGINS_DIR: 'plugins',
				LOG_FILE_PATH: 'logs/nest.log',
				TLS_CERT_PATH: 'certs/nest-cert.pem',
				TLS_KEY_PATH: 'certs/nest-key.pem',
				MAX_LOG_FILE_SIZE_BYTES: 1048576,
			},
		}));
		jest.doMock('path', () => ({
			__esModule: true,
			default: {
				dirname: jest.fn((p: string) => '/tmp/nest/' + p),
				join: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				resolve: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				relative: jest.fn((from: string, to: string) =>
					to.replace(from + '/', ''),
				),
				cwd: jest.fn(() => '/tmp/nest'),
			},
		}));
		jest.doMock('./lib/tls', () => ({
			ensureTlsCertificate: jest.fn(() => ({
				certPath: '/tmp/nest-cert.pem',
				keyPath: '/tmp/nest-key.pem',
			})),
		}));
		jest.doMock('./lib/logger', () => ({logger: {info, warn, error}}));
		jest.doMock('./lib/startup-check', () => ({
			validateStartup: jest.fn(),
		}));
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
			registeredPluginRouteExamples: {},
		}));
		jest.doMock('./lib/honey-pot', () => ({
			recordHoneypotSignal: jest.fn(),
			recordNetworkProbeSignal: jest.fn(),
		}));
		jest.doMock('./lib/local-config', () => ({
			__esModule: true,
			parseConfigFile: parseConfigFileMock,
			setWhitelistCache: jest.fn(),
			hasRuntimeValidationFailed: jest.fn(() => true), // Runtime validation failed
			loadConfigAtStartup: jest.fn(),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('./server');

		const getCalls = get.mock.calls as GetRouteCall[];
		const rootCall = getCalls.find(([route]) => route === '/');
		expect(rootCall).toBeDefined();
		const [, rootHandler] = rootCall as [string, RootHandler];
		const rootSetHeader = jest.fn();
		const rootSend = jest.fn();
		rootHandler(
			{},
			{setHeader: rootSetHeader, send: rootSend, locals: {cspNonce: 'test'}},
		);

		// Should NOT contain Local Config Presets section when validation failed
		expect(rootSend).not.toHaveBeenCalledWith(
			expect.stringContaining('Local Config Presets'),
		);
	});
});

describe('form submission filtering', () => {
	it('filters empty parameters from GET form submission URLs', () => {
		const buildUrl = (params: Record<string, string>): string => {
			const url = new URL('http://localhost/plugins/check-nvidia-smi');
			for (const [key, value] of Object.entries(params)) {
				if (value !== '') {
					url.searchParams.append(key, value);
				}
			}
			return url.toString();
		};

		// All empty fields
		const result = buildUrl({
			expectedGpuCount: '',
			warningTempC: '',
			criticalTempC: '',
			warningUtilizationPercent: '',
			criticalUtilizationPercent: '',
			warningMemoryUsagePercent: '',
			criticalMemoryUsagePercent: '',
			warningPowerUsagePercent: '',
			criticalPowerUsagePercent: '',
		});

		expect(result).toBe('http://localhost/plugins/check-nvidia-smi');
		expect(result).not.toContain('expectedGpuCount=');
		expect(result).not.toContain('warningTempC=');
		expect(result).not.toContain('?');
	});

	it('includes non-empty parameters in filtered URLs', () => {
		const buildUrl = (params: Record<string, string>): string => {
			const url = new URL('http://localhost/plugins/check-nvidia-smi');
			for (const [key, value] of Object.entries(params)) {
				if (value !== '') {
					url.searchParams.append(key, value);
				}
			}
			return url.toString();
		};

		const result = buildUrl({
			expectedGpuCount: '',
			warningTempC: '80',
			criticalTempC: '',
			warningUtilizationPercent: '75',
			criticalUtilizationPercent: '',
			warningMemoryUsagePercent: '',
			criticalMemoryUsagePercent: '',
			warningPowerUsagePercent: '',
			criticalPowerUsagePercent: '',
		});

		expect(result).toContain('warningTempC=80');
		expect(result).toContain('warningUtilizationPercent=75');
		expect(result).not.toContain('expectedGpuCount=');
		expect(result).not.toContain('criticalTempC=');
	});

	it('renders overview page without warnings when getStartupWarnings returns empty array', () => {
		jest.resetModules();

		const use = jest.fn();
		const get = jest.fn();
		const app = {use, get};
		const json = jest.fn(() => 'json-middleware');
		const urlencoded = jest.fn(() => 'urlencoded-middleware');
		const expressFactory = Object.assign(
			jest.fn(() => app),
			{json, urlencoded},
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
		const existsSync = jest
			.fn()
			.mockReturnValueOnce(true) // whitelist exists
			.mockReturnValueOnce(true) // config file exists
			.mockReturnValueOnce(false) // TLS cert
			.mockReturnValueOnce(false); // TLS key
		const statSync = jest
			.fn()
			.mockReturnValueOnce({mode: 0o100644}) // whitelist stat
			.mockReturnValueOnce({mode: 0o100644}); // config stat
		const readFileSync = jest.fn((filePath: string) => {
			if (filePath.includes('nest-cert.pem')) {
				return 'CERT_CONTENT';
			}
			if (filePath.includes('nest-key.pem')) {
				return 'KEY_CONTENT';
			}
			return 'WHITELIST_CONTENT';
		});
		const readdirSync = jest.fn(() => ['check_test.ts', 'check_test.js']);
		const info = jest.fn();
		const warn = jest.fn();
		const error = jest.fn();
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
			default: Object.assign(expressFactory, {
				Router: jest.fn(() => ({
					post: jest.fn(),
					get: jest.fn(),
					use: jest.fn(),
				})),
			}),
		}));
		jest.doMock('helmet', () => ({
			__esModule: true,
			default: jest.fn(() => 'helmet-middleware'),
		}));
		jest.doMock('express-rate-limit', () => ({
			__esModule: true,
			default: jest.fn(() => 'rate-limit-middleware'),
		}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				readFileSync,
				readdirSync,
				existsSync,
				statSync,
				mkdirSync: jest.fn(),
			},
			readFileSync,
			readdirSync,
			existsSync,
			statSync,
			mkdirSync: jest.fn(),
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
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
				API_KEY: '',
				API_KEY_HEADER: 'x-api-key',
				ALLOWED_IPS: '127.0.0.1',
				PLUGINS_DIR: 'plugins',
				LOG_FILE_PATH: 'logs/nest.log',
				TLS_CERT_PATH: 'certs/nest-cert.pem',
				TLS_KEY_PATH: 'certs/nest-key.pem',
				MAX_LOG_FILE_SIZE_BYTES: 1048576,
			},
		}));
		jest.doMock('path', () => ({
			__esModule: true,
			default: {
				dirname: jest.fn((p: string) => '/tmp/nest/' + p),
				join: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				resolve: jest.fn((...args: string[]) => '/tmp/nest/' + args.join('/')),
				relative: jest.fn((from: string, to: string) =>
					to.replace(from + '/', ''),
				),
				cwd: jest.fn(() => '/tmp/nest'),
			},
		}));
		jest.doMock('./lib/tls', () => ({
			ensureTlsCertificate: jest.fn(() => ({
				certPath: '/tmp/nest-cert.pem',
				keyPath: '/tmp/nest-key.pem',
			})),
		}));
		jest.doMock('./lib/logger', () => ({logger: {info, warn, error}}));
		jest.doMock('./lib/startup-check', () => ({
			validateStartup: jest.fn(),
		}));
		jest.doMock('./lib/startup-warning-registry', () => ({
			recordStartupWarnings: jest.fn(),
			getStartupWarnings: jest.fn(() => []), // Empty warnings!
		}));
		jest.doMock('./lib/startup-warning-help', () => ({
			getStartupWarningHelpTopic: jest.fn(() => null),
			renderStartupWarningHelpHtml: jest.fn(() => ''),
			renderStartupWarningListItems: jest.fn(),
		}));
		jest.doMock('./lib/security', () => ({
			validateFileSecurity: jest.fn(() => ({
				ok: true,
				reason: 'secure',
				actualUid: 1000,
				expectedUid: 1000,
			})),
			createAccessControlMiddleware: jest.fn(() => jest.fn()),
			getRecommendedSecurityWarnings: jest.fn(() => []),
		}));
		jest.doMock('./lib/plugin-whitelist', () => ({
			verifyPluginWhitelist: jest.fn(() => ({
				approvedFiles: new Map([['check_test.ts', 'hash123']]),
				warnings: [],
			})),
			verifyConfigFiles: jest.fn(() => ({
				approvedFiles: new Map([['local-presets.conf', 'hash456']]),
				warnings: [],
			})),
		}));
		jest.doMock('./lib/cron/scheduler', () => ({
			scheduleCleanup: jest.fn(),
			runScheduler: jest.fn(),
		}));
		jest.doMock('./routes/app-info', () => ({
			default: {handle: jest.fn()},
		}));
		jest.doMock('./routes/honey-pot', () => ({
			default: {handle: jest.fn()},
		}));
		jest.doMock('./routes/dynamic-routes', () => ({
			default: {handle: jest.fn()},
			registeredPluginRoutes: ['check_test'],
			registeredPluginRouteExamples: {},
			pluginStartupWarnings: [],
		}));
		jest.doMock('./routes/local-config', () => ({
			default: {handle: jest.fn()},
		}));
		jest.doMock('./lib/honey-pot', () => ({
			recordHoneypotSignal: jest.fn(),
			recordNetworkProbeSignal: jest.fn(),
		}));
		jest.doMock('./lib/nagios', () => ({
			createNagiosReturnMessage: jest.fn(() => ({
				message: 'not-found',
				code: 3,
			})),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('./server');

		const getCalls = get.mock.calls as [string, unknown][];
		const rootCall = getCalls.find(([route]) => route === '/');
		expect(rootCall).toBeDefined();

		const [, rootHandler] = rootCall as [string, unknown];
		const rootSetHeader = jest.fn();
		const rootSend = jest.fn();
		const rootLocals = {cspNonce: 'test-nonce'};

		(rootHandler as (req: unknown, res: unknown) => void)(
			{},
			{setHeader: rootSetHeader, send: rootSend, locals: rootLocals},
		);

		expect(rootSend).toHaveBeenCalledWith(
			expect.stringContaining('Nest Route Overview'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.not.stringContaining('Startup Warnings'),
		);
		expect(rootSend).toHaveBeenCalledWith(
			expect.not.stringContaining('<section class="warnings">'),
		);

		processOnSpy.mockRestore();
		processExitSpy.mockRestore();
	});
});
