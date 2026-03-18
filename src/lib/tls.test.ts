type EnvShape = {
	TLS_CERT_PATH: string;
	TLS_KEY_PATH: string;
	TLS_CERT_COMMON_NAME: string;
	TLS_CERT_DAYS: number;
};

const loadTlsModule = (options?: {
	envOverrides?: Partial<EnvShape>;
	existingPaths?: string[];
	spawnSyncImplementation?: jest.Mock;
	chmodThrows?: boolean;
}) => {
	jest.resetModules();

	const existsSync = jest.fn((targetPath: string) =>
		(options?.existingPaths ?? []).includes(targetPath),
	);
	const mkdirSync = jest.fn();
	const chmodSync = jest.fn();

	if (options?.chmodThrows) {
		chmodSync.mockImplementation(() => {
			throw new Error('chmod failed');
		});
	}

	const spawnSync =
		options?.spawnSyncImplementation ??
		jest.fn().mockReturnValueOnce({status: 0}).mockReturnValueOnce({status: 0});

	const warn = jest.fn();
	const info = jest.fn();

	const env: EnvShape = {
		TLS_CERT_PATH: 'certs/nest-cert.pem',
		TLS_KEY_PATH: 'certs/nest-key.pem',
		TLS_CERT_COMMON_NAME: 'localhost',
		TLS_CERT_DAYS: 365,
		...options?.envOverrides,
	};

	jest.doMock('../config/env', () => ({env}));
	jest.doMock('./logger', () => ({logger: {warn, info}}));
	jest.doMock('child_process', () => ({spawnSync}));
	jest.doMock('fs', () => ({
		__esModule: true,
		default: {existsSync, mkdirSync, chmodSync},
		existsSync,
		mkdirSync,
		chmodSync,
	}));

	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const loaded = require('./tls') as {
		ensureTlsCertificate: () => {certPath: string; keyPath: string};
	};

	return {
		ensureTlsCertificate: loaded.ensureTlsCertificate,
		existsSync,
		mkdirSync,
		chmodSync,
		spawnSync,
		warn,
		info,
	};
};

describe('ensureTlsCertificate', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.resetModules();
	});

	it('returns existing certificate and key paths without generating new files', () => {
		const certPath = '/tmp/nest/server.crt';
		const keyPath = '/tmp/nest/server.key';
		const {ensureTlsCertificate, spawnSync, mkdirSync, chmodSync, warn, info} =
			loadTlsModule({
				envOverrides: {
					TLS_CERT_PATH: certPath,
					TLS_KEY_PATH: keyPath,
				},
				existingPaths: [certPath, keyPath],
			});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).not.toHaveBeenCalled();
		expect(mkdirSync).not.toHaveBeenCalled();
		expect(chmodSync).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		expect(info).not.toHaveBeenCalled();
	});

	it('resolves relative cert and key paths from the current working directory', () => {
		const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/opt/nest');
		const certPath = '/opt/nest/certs/nest-cert.pem';
		const keyPath = '/opt/nest/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync} = loadTlsModule({
			existingPaths: [certPath, keyPath],
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(cwdSpy).toHaveBeenCalledTimes(2);
		expect(spawnSync).not.toHaveBeenCalled();
	});

	it('generates a self-signed certificate when either file is missing', () => {
		const certPath = '/work/certs/nest-cert.pem';
		const keyPath = '/work/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, mkdirSync, chmodSync, warn, info} =
			loadTlsModule({
				envOverrides: {
					TLS_CERT_PATH: certPath,
					TLS_KEY_PATH: keyPath,
					TLS_CERT_COMMON_NAME: 'nest.local',
					TLS_CERT_DAYS: 30,
				},
				existingPaths: [certPath],
			});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenNthCalledWith(
			1,
			'openssl',
			['version'],
			expect.objectContaining({encoding: 'utf8'}),
		);
		expect(spawnSync).toHaveBeenNthCalledWith(
			2,
			'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-sha256',
				'-nodes',
				'-keyout',
				keyPath,
				'-out',
				certPath,
				'-days',
				'30',
				'-subj',
				'/CN=nest.local',
			],
			expect.objectContaining({encoding: 'utf8'}),
		);
		expect(mkdirSync).toHaveBeenCalledWith('/work/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith(
			'Generated self-signed TLS certificate for HTTPS startup.',
		);
	});

	it('continues when chmod tightening fails after certificate generation', () => {
		const certPath = '/tmp/certs/nest-cert.pem';
		const keyPath = '/tmp/certs/nest-key.pem';
		const {ensureTlsCertificate, info} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0})
				.mockReturnValueOnce({status: 0}),
			chmodThrows: true,
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(info).toHaveBeenCalled();
	});

	it('throws when files are missing and openssl is unavailable', () => {
		const certPath = '/tmp/certs/nest-cert.pem';
		const keyPath = '/tmp/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, warn} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			spawnSyncImplementation: jest.fn().mockReturnValue({
				status: 1,
				error: new Error('missing openssl'),
			}),
		});

		expect(() => ensureTlsCertificate()).toThrow(
			`TLS certificate or key missing, and openssl is not available. Expected cert=${certPath}, key=${keyPath}`,
		);
		expect(spawnSync).toHaveBeenCalledTimes(1);
		expect(warn).not.toHaveBeenCalled();
	});

	it('throws when openssl execution fails during certificate generation', () => {
		const certPath = '/tmp/certs/nest-cert.pem';
		const keyPath = '/tmp/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0})
				.mockReturnValueOnce({
					status: 0,
					error: new Error('exec failure'),
				}),
		});

		expect(() => ensureTlsCertificate()).toThrow(
			'Failed to execute openssl: exec failure',
		);
		expect(spawnSync).toHaveBeenCalledTimes(2);
	});

	it('throws when openssl exits non-zero during certificate generation', () => {
		const certPath = '/tmp/certs/nest-cert.pem';
		const keyPath = '/tmp/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0})
				.mockReturnValueOnce({status: 1, stderr: 'bad openssl args'}),
		});

		expect(() => ensureTlsCertificate()).toThrow(
			'openssl command failed with status 1: bad openssl args',
		);
		expect(spawnSync).toHaveBeenCalledTimes(2);
	});

	it('throws when openssl exits non-zero without stderr during certificate generation', () => {
		const certPath = '/tmp/certs/nest-cert.pem';
		const keyPath = '/tmp/certs/nest-key.pem';
		const {ensureTlsCertificate} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0})
				.mockReturnValueOnce({status: 2}),
		});

		expect(() => ensureTlsCertificate()).toThrow(
			'openssl command failed with status 2',
		);
	});
});
