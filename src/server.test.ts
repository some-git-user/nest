describe('server bootstrap', () => {
	type FaviconHandler = (
		_req: unknown,
		res: {status: (code: number) => unknown},
	) => unknown;
	type NotFoundHandler = (
		req: {url: string},
		res: {status: (code: number) => {send: (body: unknown) => unknown}},
	) => unknown;
	type GetRouteCall = [string, FaviconHandler];
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
		const info = jest.fn();
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
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {readFileSync},
			readFileSync,
		}));
		jest.doMock('https', () => ({
			__esModule: true,
			default: {createServer},
			createServer,
		}));
		jest.doMock('./config/env', () => ({
			env: {HOST: '127.0.0.1', PORT: 5443, NODE_ENV: 'test'},
		}));
		jest.doMock('./lib/tls', () => ({
			ensureTlsCertificate: jest.fn(() => ({
				certPath: '/tmp/nest-cert.pem',
				keyPath: '/tmp/nest-key.pem',
			})),
		}));
		jest.doMock('./lib/logger', () => ({logger: {info, error}}));
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
		const notFoundCall = useCalls.find(
			(call): call is [NotFoundHandler] => typeof call[0] === 'function',
		);
		const faviconStatus = jest.fn();
		const send = jest.fn();
		const status = jest.fn(() => ({send}));

		expect(faviconCall).toBeDefined();
		expect(notFoundCall).toBeDefined();

		const [, faviconHandler] = faviconCall as GetRouteCall;
		const [notFoundHandler] = notFoundCall as [NotFoundHandler];

		faviconHandler({}, {status: faviconStatus});
		notFoundHandler({url: '/missing'}, {status});

		eventHandlers.get('unhandledRejection')?.({message: 'rejection'});
		eventHandlers.get('uncaughtException')?.({message: 'exception'});
		eventHandlers.get('SIGTERM')?.({message: 'shutdown'});

		expect(expressFactory).toHaveBeenCalledTimes(1);
		expect(json).toHaveBeenCalledTimes(1);
		expect(get).toHaveBeenCalledWith('/favicon.ico', expect.any(Function));
		expect(use).toHaveBeenCalledWith('json-middleware');
		expect(use).toHaveBeenCalledWith('/', 'dynamicRoutesRouter');
		expect(use).toHaveBeenCalledWith('/nagios', 'appInfoRouter');
		expect(use).toHaveBeenCalledWith('/nagios/honey-pot', 'honeyPotRouter');
		expect(faviconStatus).toHaveBeenCalledWith(204);
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
				'HTTPS server running in test mode on host 127.0.0.1 and port 5443',
			),
		);
		expect(info).toHaveBeenCalledWith('Started application in test mode...');
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
});
