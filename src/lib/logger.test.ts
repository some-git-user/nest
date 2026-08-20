const loadLoggerWithMocks = (envOverrides: Record<string, unknown> = {}) => {
	jest.resetModules();

	const mkdirSync = jest.fn();
	const appendFileSync = jest.fn();

	const env = {
		NODE_ENV: 'production',
		LOG_FILE_PATH: '/tmp/nest/logger.log',
		...envOverrides,
	} as Record<string, unknown>;

	jest.doMock('../config/env', () => ({env}));

	jest.doMock('fs', () => ({
		__esModule: true,
		default: {mkdirSync, appendFileSync},
		mkdirSync,
		appendFileSync,
	}));

	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const {logger} = require('./logger') as {logger: Record<string, unknown>};

	return {
		logger: logger as {
			info: (msg: unknown) => void;
			warn: (msg: unknown) => void;
			error: (msg: unknown) => void;
			debug: (msg: unknown) => void;
		},
		mkdirSync,
		appendFileSync,
	};
};

describe('logger', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.resetModules();
	});

	it('logs info and writes to file when LOG_FILE_PATH is configured', () => {
		const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
		const {logger, mkdirSync, appendFileSync} = loadLoggerWithMocks();

		logger.info('hello-info');

		expect(infoSpy).toHaveBeenCalledTimes(1);
		expect(String(infoSpy.mock.calls[0][0])).toContain('[INFO] hello-info');
		expect(mkdirSync).toHaveBeenCalledWith('/tmp/nest', {recursive: true});
		expect(appendFileSync).toHaveBeenCalledTimes(1);
		const appendArgs = appendFileSync.mock.calls[0] as [string, string];
		expect(String(appendArgs[1])).toContain('[INFO] hello-info');
	});

	it('does not write logs when LOG_FILE_PATH is unset', () => {
		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		const {logger, mkdirSync, appendFileSync} = loadLoggerWithMocks({
			LOG_FILE_PATH: undefined,
		});

		logger.error('no-file');

		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(String(errorSpy.mock.calls[0][0])).toContain('[ERROR] no-file');
		expect(mkdirSync).not.toHaveBeenCalled();
		expect(appendFileSync).not.toHaveBeenCalled();
	});

	it('returns early for debug outside production', () => {
		const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
		const {logger, mkdirSync, appendFileSync} = loadLoggerWithMocks({
			NODE_ENV: 'development',
		});

		logger.debug('skip-debug');

		// Debug SHOULD be logged in development mode
		expect(debugSpy).toHaveBeenCalledTimes(1);
		expect(String(debugSpy.mock.calls[0][0])).toContain('[DEBUG] skip-debug');
		expect(mkdirSync).toHaveBeenCalled();
		expect(appendFileSync).toHaveBeenCalled();
	});

	it('logs debug in production', () => {
		const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
		const {logger, appendFileSync} = loadLoggerWithMocks({
			NODE_ENV: 'production',
		});

		logger.debug('prod-debug');

		// Debug should NOT be logged in production
		expect(debugSpy).not.toHaveBeenCalled();
		expect(appendFileSync).not.toHaveBeenCalled();
	});

	it('falls back to console.error when file writes fail', () => {
		const consoleErrorSpy = jest
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		const {logger, appendFileSync} = loadLoggerWithMocks();
		const writeError = new Error('disk full');
		appendFileSync.mockImplementation(() => {
			throw writeError;
		});

		logger.warn('warn-write-failure');

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'[Logger] Failed to write log file:',
			writeError,
		);
	});

	it('falls back to console.error when file writes fail', () => {
		const consoleErrorSpy = jest
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		const {logger, appendFileSync} = loadLoggerWithMocks();
		const writeError = new Error('disk full');
		appendFileSync.mockImplementation(() => {
			throw writeError;
		});

		logger.warn('warn-write-failure');

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'[Logger] Failed to write log file:',
			writeError,
		);
	});

	it('formats non-string messages through JSON.stringify and undefined fallback', () => {
		const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
		const {logger} = loadLoggerWithMocks({
			LOG_FILE_PATH: undefined,
		});

		logger.info({toString: () => 'object-message'});
		logger.info(undefined);

		expect(String(infoSpy.mock.calls[0][0])).toContain('[INFO] {}');
		expect(String(infoSpy.mock.calls[1][0])).toContain('[INFO] undefined');
	});
});
