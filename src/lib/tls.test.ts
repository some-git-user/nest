const loadTlsModule = (options?: {
	envOverrides?: Record<string, unknown>;
	existingPaths?: string[];
	spawnSyncImplementation?: jest.Mock;
	chmodThrows?: boolean;
	statSyncOverride?: (filePath: string) => unknown;
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

	const env = {
		TLS_CERT_PATH: 'certs/nest-cert.pem',
		TLS_KEY_PATH: 'certs/nest-key.pem',
		...options?.envOverrides,
	} as Record<string, unknown>;

	jest.doMock('../config/env', () => ({env}));
	jest.doMock('./logger', () => ({logger: {warn, info}}));
	const statSync =
		options?.statSyncOverride ??
		jest.fn((filePath: string) => {
			if ((options?.existingPaths ?? []).includes(filePath)) {
				return {
					isFile: () => true,
					size: 1024,
				};
			}
			throw new Error('File not found');
		});

	jest.doMock('child_process', () => ({spawnSync}));
	jest.doMock('fs', () => ({
		__esModule: true,
		default: {existsSync, mkdirSync, chmodSync, statSync},
		existsSync,
		mkdirSync,
		chmodSync,
		statSync,
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
		const certPath = '/etc/nest/certs/server.crt';
		const keyPath = '/etc/nest/certs/server.key';
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
		expect(cwdSpy).toHaveBeenCalledTimes(3);
		expect(spawnSync).not.toHaveBeenCalled();
	});

	it('generates a self-signed certificate when either file is missing', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, mkdirSync, chmodSync, warn, info} =
			loadTlsModule({
				envOverrides: {
					TLS_CERT_PATH: certPath,
					TLS_KEY_PATH: keyPath,
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
				'365',
				'-subj',
				'/CN=localhost',
			],
			expect.objectContaining({encoding: 'utf8'}),
		);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith(
			'Generated self-signed TLS certificate for HTTPS startup.',
		);
	});

	it('continues when chmod tightening fails after certificate generation', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
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
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
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
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
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
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
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
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
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

	it('throws when TLS certificate path contains a path traversal sequence', () => {
		const certPath = '/certs/../../evil-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
		});

		expect(() => ensureTlsCertificate()).toThrow(/path traversal/i);
	});

	it('throws when TLS certificate path is not in an allowed directory', () => {
		const certPath = '/tmp/outside-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
		});

		expect(() => ensureTlsCertificate()).toThrow(/not in allowed directory/i);
	});

	it('throws when existing TLS certificate is not a regular file', () => {
		const certPath = '/etc/nest/certs/server.crt';
		const keyPath = '/etc/nest/certs/server.key';
		const {ensureTlsCertificate} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			statSyncOverride: jest.fn(() => ({
				isFile: () => false,
				size: 1024,
			})),
		});

		expect(() => ensureTlsCertificate()).toThrow(/not a regular file/i);
	});

	it('throws when existing TLS certificate exceeds maximum size limit', () => {
		const certPath = '/etc/nest/certs/server.crt';
		const keyPath = '/etc/nest/certs/server.key';
		const {ensureTlsCertificate} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			statSyncOverride: jest.fn(() => ({
				isFile: () => true,
				size: 20 * 1024,
			})),
		});

		expect(() => ensureTlsCertificate()).toThrow(/maximum size/i);
	});
});
