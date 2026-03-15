import path from 'path';

describe('env config loading', () => {
	const originalEnv = process.env;
	const originalArgv = process.argv;

	afterEach(() => {
		process.env = originalEnv;
		process.argv = originalArgv;
		jest.resetModules();
		jest.restoreAllMocks();
	});

	const loadEnvModule = (options: {
		argv: string[];
		env: Record<string, string | undefined>;
		existsSyncImpl: (filePath: string) => boolean;
		fileContent?: string;
	}) => {
		jest.resetModules();

		process.argv = [...options.argv];
		process.env = {
			...originalEnv,
			...options.env,
		};

		const existsSyncMock = jest.fn(options.existsSyncImpl);
		const readFileSyncMock = jest
			.fn()
			.mockReturnValue(options.fileContent ?? '');

		jest.doMock('fs', () => ({
			__esModule: true,
			existsSync: existsSyncMock,
			readFileSync: readFileSyncMock,
		}));

		jest.doMock('envalid', () => ({
			cleanEnv: (environment: NodeJS.ProcessEnv) => environment,
			host: () => ({}),
			num: () => ({}),
			port: () => ({}),
			str: () => ({}),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const loaded = require('./env') as {env: NodeJS.ProcessEnv};

		return {
			env: loaded.env,
			existsSyncMock,
			readFileSyncMock,
		};
	};

	it('prefers --configPath and parses quoted values', () => {
		const configPath = '/tmp/custom-nest.conf';
		const {existsSyncMock, readFileSyncMock} = loadEnvModule({
			argv: ['node', 'server.js', '--configPath', configPath],
			env: {
				NODE_ENV: 'production',
				HOST: undefined,
				PORT: undefined,
			},
			existsSyncImpl: (filePath) => filePath === configPath,
			fileContent:
				'# comment\nHOST=\'example.local\'\nPORT=7001\nLOG_FILE_PATH="/tmp/nest.log"\nIGNORED_LINE\nPLUGINS_DIR=custom-plugins\n',
		});

		expect(existsSyncMock).toHaveBeenCalledWith(configPath);
		expect(readFileSyncMock).toHaveBeenCalledWith(configPath, 'utf8');
		expect(process.env.HOST).toBe('example.local');
		expect(process.env.PORT).toBe('7001');
		expect(process.env.LOG_FILE_PATH).toBe('/tmp/nest.log');
		expect(process.env.PLUGINS_DIR).toBe('custom-plugins');
	});

	it('uses NEST_CONFIG_FILE when --configPath is not provided', () => {
		const configPath = '/etc/nest/from-env.conf';
		const {existsSyncMock} = loadEnvModule({
			argv: ['node', 'server.js'],
			env: {
				NEST_CONFIG_FILE: configPath,
				NODE_ENV: 'development',
			},
			existsSyncImpl: (filePath) => filePath === configPath,
			fileContent: 'HOST=host-from-env-file\n',
		});

		expect(existsSyncMock).toHaveBeenCalledWith(configPath);
		expect(process.env.HOST).toBe('host-from-env-file');
	});

	it('uses /etc/nest/nest.conf by default in production', () => {
		const defaultProdConfigPath = '/etc/nest/nest.conf';
		const {existsSyncMock, readFileSyncMock} = loadEnvModule({
			argv: ['node', 'server.js'],
			env: {
				NEST_CONFIG_FILE: undefined,
				NODE_ENV: 'production',
			},
			existsSyncImpl: () => false,
		});

		expect(existsSyncMock).toHaveBeenCalledWith(defaultProdConfigPath);
		expect(readFileSyncMock).not.toHaveBeenCalled();
	});

	it('uses .env in non-production when no explicit config path is provided', () => {
		const expectedDotEnvPath = path.resolve(process.cwd(), '.env');
		const {existsSyncMock} = loadEnvModule({
			argv: ['node', 'server.js'],
			env: {
				NEST_CONFIG_FILE: undefined,
				NODE_ENV: 'development',
			},
			existsSyncImpl: (filePath) => filePath === expectedDotEnvPath,
			fileContent: 'LOG_FILE_PATH=logs/dev.log\n',
		});

		expect(existsSyncMock).toHaveBeenCalledWith(expectedDotEnvPath);
		expect(process.env.LOG_FILE_PATH).toBe('logs/dev.log');
	});

	it('falls back to NEST_CONFIG_FILE when --configPath has no value', () => {
		const fallbackConfigPath = '/etc/nest/fallback.conf';
		const {existsSyncMock, readFileSyncMock} = loadEnvModule({
			argv: ['node', 'server.js', '--configPath'],
			env: {
				NODE_ENV: undefined,
				NEST_CONFIG_FILE: fallbackConfigPath,
			},
			existsSyncImpl: (filePath) => filePath === fallbackConfigPath,
			fileContent: 'HOST=fallback-host\n',
		});

		expect(existsSyncMock).toHaveBeenCalledWith(fallbackConfigPath);
		expect(readFileSyncMock).toHaveBeenCalledWith(fallbackConfigPath, 'utf8');
		expect(process.env.HOST).toBe('fallback-host');
	});
});
