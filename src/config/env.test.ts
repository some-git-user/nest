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
		statSyncImpl?: (filePath: string) => {uid: number; mode: number};
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
		const statSyncMock = jest.fn(
			options.statSyncImpl ?? (() => ({uid: 1000, mode: 0o100600})),
		);
		const processGetUidSpy = jest
			.spyOn(process, 'getuid' as never)
			.mockReturnValue(1000 as never);

		jest.doMock('fs', () => ({
			__esModule: true,
			existsSync: existsSyncMock,
			readFileSync: readFileSyncMock,
			statSync: statSyncMock,
		}));

		jest.doMock('envalid', () => ({
			bool: () => ({}),
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
			statSyncMock,
			processGetUidSpy,
		};
	};

	it('prefers --configPath and parses quoted values', () => {
		const configPath = '/tmp/custom-nest.conf';
		const {existsSyncMock, readFileSyncMock, statSyncMock} = loadEnvModule({
			argv: ['node', 'server.js', '--configPath', configPath],
			env: {
				NODE_ENV: 'production',
				HOST: undefined,
				PORT: undefined,
			},
			existsSyncImpl: (filePath) => filePath === configPath,
			statSyncImpl: () => ({uid: 1000, mode: 0o100600}),
			fileContent:
				'# comment\nHOST=\'example.local\'\nPORT=7001\nLOG_FILE_PATH="/tmp/nest.log"\nTLS_CERT_PATH=certs/test-cert.pem\nTLS_KEY_PATH=certs/test-key.pem\nTLS_CERT_COMMON_NAME=nest.local\nTLS_CERT_DAYS=730\nIGNORED_LINE\nPLUGINS_DIR=custom-plugins\n',
		});

		expect(existsSyncMock).toHaveBeenCalledWith(configPath);
		expect(statSyncMock).toHaveBeenCalledWith(configPath);
		expect(readFileSyncMock).toHaveBeenCalledWith(configPath, 'utf8');
		expect(process.env.HOST).toBe('example.local');
		expect(process.env.PORT).toBe('7001');
		expect(process.env.LOG_FILE_PATH).toBe('/tmp/nest.log');
		expect(process.env.TLS_CERT_PATH).toBe('certs/test-cert.pem');
		expect(process.env.TLS_KEY_PATH).toBe('certs/test-key.pem');
		expect(process.env.TLS_CERT_COMMON_NAME).toBe('nest.local');
		expect(process.env.TLS_CERT_DAYS).toBe('730');
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

	it('throws in production when config file owner does not match process uid', () => {
		expect(() =>
			loadEnvModule({
				argv: ['node', 'server.js'],
				env: {
					NODE_ENV: 'production',
					NEST_CONFIG_FILE: '/etc/nest/nest.conf',
				},
				existsSyncImpl: () => true,
				statSyncImpl: () => ({uid: 0, mode: 0o100600}),
				fileContent: 'HOST=prod-host\n',
			}),
		).toThrow(/ownership/i);
	});

	it('throws in production when config file is group writable', () => {
		expect(() =>
			loadEnvModule({
				argv: ['node', 'server.js'],
				env: {
					NODE_ENV: 'production',
					NEST_CONFIG_FILE: '/etc/nest/nest.conf',
				},
				existsSyncImpl: () => true,
				statSyncImpl: () => ({uid: 1000, mode: 0o100660}),
				fileContent: 'HOST=prod-host\n',
			}),
		).toThrow(/permissions/i);
	});
});
