/**
 * A certificate certificate has to carry the configured host *and* every
 * loopback identity. openssl renders IPv6 SANs fully expanded, so the fixtures
 * below use the same spelling that `parseCertificateInfo()` sees at runtime.
 */
const LOOPBACK_SANS =
	'DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1';
const VALID_SAN = `IP Address:192.168.111.50, ${LOOPBACK_SANS}`;
const FAR_FUTURE = 'Aug 24 19:16:50 2027 GMT';

/**
 * Build the `openssl x509 -text` output that the certificate parser consumes.
 * Passing a null `notAfter` omits the expiry line entirely.
 */
const certText = (notAfter: string | null, sans: string): string =>
	[
		'Certificate:',
		'    Data:',
		'        Version: 3 (0x2)',
		'    Signature Algorithm: sha256WithRSAEncryption',
		'    Issuer: CN=Nest Self-Signed',
		'    Validity',
		'        Not Before: Aug 24 19:16:50 2024 GMT',
		...(notAfter ? [`        Not After : ${notAfter}`] : []),
		'    Subject: CN=Nest Self-Signed',
		'    Subject Public Key Info:',
		'    X509v3 extensions:',
		'        X509v3 Subject Alternative Name:',
		`            ${sans}`,
	].join('\n');

const loadTlsModule = (options?: {
	envOverrides?: Record<string, unknown>;
	env?: Record<string, unknown>;
	existingPaths?: string[];
	spawnSyncImplementation?: jest.Mock;
	chmodThrows?: boolean;
	statSyncOverride?: (filePath: string) => unknown;
	writeFails?: boolean;
}) => {
	jest.resetModules();

	const existsSync = jest.fn((targetPath: string) =>
		(options?.existingPaths ?? []).includes(targetPath),
	);
	const mkdirSync = jest.fn();
	const chmodSync = jest.fn();
	const writeFileSync = jest.fn();
	const unlinkSync = jest.fn();
	const rmSync = jest.fn();

	if (options?.chmodThrows) {
		chmodSync.mockImplementation(() => {
			throw new Error('chmod failed');
		});
	}

	if (options?.writeFails) {
		writeFileSync.mockImplementation(() => {
			throw new Error('write failed');
		});
	}

	const spawnSync =
		options?.spawnSyncImplementation ??
		jest.fn().mockReturnValueOnce({status: 0}).mockReturnValueOnce({status: 0});

	const warn = jest.fn();
	const info = jest.fn();
	const error = jest.fn();

	const env =
		options?.env ??
		({
			TLS_CERT_PATH: 'certs/nest-cert.pem',
			TLS_KEY_PATH: 'certs/nest-key.pem',
			...options?.envOverrides,
		} as Record<string, unknown>);

	const startupWarnings: string[] = [];

	jest.doMock('../config/env', () => ({env}));
	jest.doMock('./logger', () => ({logger: {warn, info, error}}));
	jest.doMock('./startup-warning-registry', () => ({
		recordStartupWarning: (warning: string) => {
			startupWarnings.push(warning);
		},
	}));
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
		default: {
			existsSync,
			mkdirSync,
			chmodSync,
			statSync,
			writeFileSync,
			unlinkSync,
			rmSync,
		},
		existsSync,
		mkdirSync,
		chmodSync,
		statSync,
		writeFileSync,
		unlinkSync,
		rmSync,
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
		writeFileSync,
		unlinkSync,
		rmSync,
		spawnSync,
		warn,
		info,
		error,
		startupWarnings,
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
				spawnSyncImplementation: jest.fn().mockReturnValueOnce({
					status: 0,
					stdout: certText(FAR_FUTURE, VALID_SAN),
				}), // parse cert - matches
				env: {
					HOST: '192.168.111.50',
					PORT: '5000',
					TLS_CERT_PATH: certPath,
					TLS_KEY_PATH: keyPath,
				} as Record<string, unknown>,
			});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(1);
		expect(spawnSync).toHaveBeenNthCalledWith(
			1,
			'openssl',
			['x509', '-in', certPath, '-noout', '-text'],
			expect.objectContaining({encoding: 'utf8'}),
		);
		expect(mkdirSync).not.toHaveBeenCalled();
		expect(chmodSync).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith('Certificate is valid and up to date.');
	});

	it('resolves relative cert and key paths from the current working directory', () => {
		const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/opt/nest');
		const certPath = '/opt/nest/certs/nest-cert.pem';
		const keyPath = '/opt/nest/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync} = loadTlsModule({
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest.fn().mockReturnValueOnce({
				status: 0,
				stdout: certText(FAR_FUTURE, VALID_SAN),
			}), // parse cert - matches
			env: {
				HOST: '192.168.111.50',
				PORT: '5000',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			} as Record<string, unknown>,
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(1);
	});

	it('generates a self-signed certificate when either file is missing', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {
			ensureTlsCertificate,
			spawnSync,
			mkdirSync,
			chmodSync,
			warn,
			info,
			rmSync,
		} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath], // Only cert exists, key is missing
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
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
				'/CN=192.168.111.50',
				'-addext',
				'subjectAltName=IP:192.168.111.50,DNS:localhost,IP:127.0.0.1,IP:::1',
				'-addext',
				'basicConstraints=CA:false',
				'-addext',
				'keyUsage=digitalSignature,keyEncipherment',
				'-addext',
				'extendedKeyUsage=serverAuth',
				'-batch',
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
		const {ensureTlsCertificate, info, rmSync} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({
					status: 0,
					stdout:
						'X509v3 Subject Alternative Name:\n    IP Address:192.168.111.50',
				}) // parse cert - no match
				.mockReturnValueOnce({status: 0}), // generate cert
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
		const {ensureTlsCertificate, spawnSync, error} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({
					status: 0,
					error: new Error('exec failure'),
				}), // generate cert fails
		});

		expect(() => ensureTlsCertificate()).toThrow(
			'Failed to generate TLS certificate',
		);
		expect(spawnSync).toHaveBeenCalledTimes(2);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining('Failed to generate TLS certificate'),
		);
	});

	it('throws when openssl exits non-zero during certificate generation', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, error} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 1, stderr: 'bad openssl args'}), // generate cert fails
		});

		expect(() => ensureTlsCertificate()).toThrow(
			'openssl command failed with status 1: bad openssl args',
		);
		expect(spawnSync).toHaveBeenCalledTimes(2);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining('openssl command failed'),
		);
	});

	it('throws when openssl exits non-zero without stderr during certificate generation', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, error} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 2}), // generate cert fails
		});

		expect(() => ensureTlsCertificate()).toThrow(
			'openssl command failed with status 2',
		);
		expect(spawnSync).toHaveBeenCalledTimes(2);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining('openssl command failed'),
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

	it('regenerates certificate when host does not match SAN', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {
			ensureTlsCertificate,
			spawnSync,
			mkdirSync,
			chmodSync,
			warn,
			rmSync,
		} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({
					status: 0,
					stdout:
						'Certificate:\n    Data:\n        Version: 3 (0x2)\n    Signature Algorithm: sha256WithRSAEncryption\n    Issuer: CN=Nest Self-Signed\n    Validity\n        Not Before: Aug 24 19:16:50 2024 GMT\n        Not After : Aug 24 19:16:50 2027 GMT\n    Subject: CN=Nest Self-Signed\n    Subject Public Key Info:\n    X509v3 extensions:\n        X509v3 Subject Alternative Name:\n            IP:192.168.1.1',
				}) // parse cert - host mismatch
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(3);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('regenerates certificate when certificate is expiring soon', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const expiringDate = new Date();
		expiringDate.setDate(expiringDate.getDate() + 10);
		// Format as OpenSSL date format: "Aug 24 19:16:50 2027 GMT"
		const months = [
			'Jan',
			'Feb',
			'Mar',
			'Apr',
			'May',
			'Jun',
			'Jul',
			'Aug',
			'Sep',
			'Oct',
			'Nov',
			'Dec',
		];
		const opensslDate = `${months[expiringDate.getMonth()]} ${expiringDate.getDate().toString().padStart(2, ' ')} ${expiringDate.getHours().toString().padStart(2, '0')}:${expiringDate.getMinutes().toString().padStart(2, '0')}:${expiringDate.getSeconds().toString().padStart(2, '0')} ${expiringDate.getFullYear()} GMT`;
		const {
			ensureTlsCertificate,
			spawnSync,
			mkdirSync,
			chmodSync,
			warn,
			rmSync,
		} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({
					status: 0,
					stdout: certText(opensslDate, VALID_SAN),
				}) // parse cert - expiring soon
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(3);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('regenerates certificate when parseCertificateInfo returns null', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {
			ensureTlsCertificate,
			spawnSync,
			mkdirSync,
			chmodSync,
			warn,
			rmSync,
		} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({
					status: 1,
					stderr: 'openssl error',
				}) // parse cert fails
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(3);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('generates certificate with DNS SAN for hostname', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, mkdirSync, chmodSync, rmSync} =
			loadTlsModule({
				envOverrides: {
					HOST: 'myhost.example.com',
					TLS_CERT_PATH: certPath,
					TLS_KEY_PATH: keyPath,
				},
				existingPaths: [],
				spawnSyncImplementation: jest
					.fn()
					.mockReturnValueOnce({status: 0}) // openssl version check
					.mockReturnValueOnce({status: 0}), // generate cert
			});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(2);
		expect(spawnSync).toHaveBeenNthCalledWith(
			2,
			'openssl',
			expect.arrayContaining([
				'-subj',
				'/CN=myhost.example.com',
				'-addext',
				'subjectAltName=DNS:myhost.example.com,DNS:localhost,IP:127.0.0.1,IP:::1',
			]),
			expect.objectContaining({encoding: 'utf8'}),
		);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);
	});

	it('resolves relative TLS cert/key paths using process.cwd()', () => {
		const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/opt/nest');
		const relativeCertPath = 'certs/nest-cert.pem';
		const relativeKeyPath = 'certs/nest-key.pem';
		const resolvedCertPath = '/opt/nest/certs/nest-cert.pem';
		const resolvedKeyPath = '/opt/nest/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync} = loadTlsModule({
			envOverrides: {
				TLS_CERT_PATH: relativeCertPath,
				TLS_KEY_PATH: relativeKeyPath,
			},
			existingPaths: [resolvedCertPath, resolvedKeyPath],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({
					status: 0,
					stdout: certText(FAR_FUTURE, VALID_SAN),
				}) // parse cert
				.mockReturnValueOnce({status: 0, error: undefined}), // openssl version check
			env: {
				HOST: '192.168.111.50',
				PORT: '5000',
				TLS_CERT_PATH: relativeCertPath,
				TLS_KEY_PATH: relativeKeyPath,
			} as Record<string, unknown>,
		});

		expect(ensureTlsCertificate()).toEqual({
			certPath: resolvedCertPath,
			keyPath: resolvedKeyPath,
		});
		expect(spawnSync).toHaveBeenCalledTimes(1);
		cwdSpy.mockRestore();
	});

	it('handles spawnSync throwing an error during certificate parsing', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {
			ensureTlsCertificate,
			spawnSync,
			mkdirSync,
			chmodSync,
			warn,
			rmSync,
		} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest
				.fn()
				.mockImplementationOnce(() => {
					throw new Error('openssl command failed');
				}) // parse cert throws (caught, returns null)
				.mockReturnValueOnce({status: 0, error: undefined}) // openssl version check succeeds
				.mockReturnValueOnce({status: 0, error: undefined}), // generate cert succeeds
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(3);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('parses certificate with multiple SAN entries (IP and DNS)', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, info} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest.fn().mockReturnValueOnce({
				status: 0,
				stdout: certText(FAR_FUTURE, `${VALID_SAN}, DNS:nest.local`),
			}), // parse cert with multiple SANs
			env: {
				HOST: '192.168.111.50',
				PORT: '5000',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			} as Record<string, unknown>,
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith('Certificate is valid and up to date.');
	});

	it('parses certificate with no SAN entries', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {
			ensureTlsCertificate,
			spawnSync,
			mkdirSync,
			chmodSync,
			warn,
			rmSync,
		} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({
					status: 0,
					stdout:
						'Certificate:\n    Data:\n        Version: 3 (0x2)\n    Signature Algorithm: sha256WithRSAEncryption\n    Issuer: CN=Nest Self-Signed\n    Validity\n        Not Before: Aug 24 19:16:50 2024 GMT\n        Not After : Aug 24 19:16:50 2027 GMT\n    Subject: CN=Nest Self-Signed\n    Subject Public Key Info:\n    X509v3 extensions:\n        X509v3 Subject Alternative Name:\n            ',
				}) // parse cert with empty SAN
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(3);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('parses certificate with no expiry date', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, info} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest.fn().mockReturnValueOnce({
				status: 0,
				stdout: certText(null, VALID_SAN),
			}), // parse cert with no expiry
			env: {
				HOST: '192.168.111.50',
				PORT: '5000',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			} as Record<string, unknown>,
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith('Certificate is valid and up to date.');
	});

	it('parses certificate with no SAN section at all', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {
			ensureTlsCertificate,
			spawnSync,
			mkdirSync,
			chmodSync,
			warn,
			rmSync,
		} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({
					status: 0,
					stdout:
						'Certificate:\n    Data:\n        Version: 3 (0x2)\n    Signature Algorithm: sha256WithRSAEncryption\n    Issuer: CN=Nest Self-Signed\n    Validity\n        Not Before: Aug 24 19:16:50 2024 GMT\n        Not After : Aug 24 19:16:50 2027 GMT\n    Subject: CN=Nest Self-Signed',
				}) // parse cert with no SAN section
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(3);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('accepts certificate with expiry date but not expiring soon', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		// Use a fixed date format that JavaScript can parse: "Mon, 24 Aug 2027 19:16:50 GMT"
		const futureDate = 'Mon, 24 Aug 2027 19:16:50 GMT';
		const {ensureTlsCertificate, spawnSync, info} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest.fn().mockReturnValueOnce({
				status: 0,
				stdout: certText(futureDate, VALID_SAN),
			}), // parse cert with far expiry
			env: {
				HOST: '192.168.111.50',
				PORT: '5000',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			} as Record<string, unknown>,
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith('Certificate is valid and up to date.');
	});

	it('regenerates an already expired certificate', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const expiredDate = 'Apr  1 00:00:00 2020 GMT';
		const {
			ensureTlsCertificate,
			spawnSync,
			mkdirSync,
			chmodSync,
			warn,
			rmSync,
		} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({
					status: 0,
					stdout: certText(expiredDate, VALID_SAN),
				}) // parse cert - expired
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(3);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);
		expect(warn).toHaveBeenCalledTimes(2);
		// The reported remaining lifetime has to stay negative - an absolute
		// value would hide the fact that the certificate is already expired.
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/Certificate expires in -\d+ days/),
		);
	});

	it('treats an unparsable expiry date as missing instead of expiring today', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, info} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest.fn().mockReturnValueOnce({
				status: 0,
				stdout: certText('this is not a date', VALID_SAN),
			}), // parse cert - Invalid Date
			env: {
				HOST: '192.168.111.50',
				PORT: '5000',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			} as Record<string, unknown>,
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith('Certificate is valid and up to date.');
	});

	it('regenerates a certificate that is missing a loopback SAN', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {
			ensureTlsCertificate,
			spawnSync,
			mkdirSync,
			chmodSync,
			warn,
			rmSync,
			startupWarnings,
		} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({
					status: 0,
					// Host SAN present, but no loopback coverage, so internal
					// self-requests could not verify the certificate.
					stdout: certText(FAR_FUTURE, 'IP Address:192.168.111.50'),
				}) // parse cert - loopback SANs missing
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(3);
		expect(mkdirSync).toHaveBeenCalledWith('/certs', {recursive: true});
		expect(chmodSync).toHaveBeenCalledWith(keyPath, 0o600);
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('Certificate SAN does not include DNS:localhost'),
		);
		// The startup warning has to describe the state the service is running
		// in, plus what the operator should do about it - not a problem that
		// was already fixed while starting.
		expect(startupWarnings).toHaveLength(1);
		expect(startupWarnings[0]).toContain(
			'TLS certificate replaced automatically: Certificate SAN does not include DNS:localhost',
		);
		expect(startupWarnings[0]).toContain(
			`New self-signed certificate: ${certPath}`,
		);
		expect(startupWarnings[0]).toContain('What to do now:');
		expect(startupWarnings[0]).toContain('fingerprint');
		expect(startupWarnings[0]).not.toContain('Regenerating certificate.');
	});

	it('records an actionable startup warning when a certificate is created from scratch', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, startupWarnings} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(startupWarnings).toHaveLength(1);
		expect(startupWarnings[0]).toContain('TLS certificate or key was missing.');
		expect(startupWarnings[0]).toContain(
			`New self-signed certificate: ${certPath}`,
		);
		expect(startupWarnings[0]).toContain('What to do now:');
	});

	it('accepts a certificate whose IPv6 SAN is written in a compressed form', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync, info} = loadTlsModule({
			envOverrides: {
				HOST: '192.168.111.50',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [certPath, keyPath],
			spawnSyncImplementation: jest.fn().mockReturnValueOnce({
				status: 0,
				stdout: certText(
					FAR_FUTURE,
					'IP Address:192.168.111.50, DNS:localhost, IP Address:127.0.0.1, IP Address:::1',
				),
			}), // parse cert - compressed ::1
			env: {
				HOST: '192.168.111.50',
				PORT: '5000',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			} as Record<string, unknown>,
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenCalledTimes(1);
		expect(info).toHaveBeenCalledWith('Certificate is valid and up to date.');
	});

	it('does not add a wildcard bind address to the SAN', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync} = loadTlsModule({
			envOverrides: {
				HOST: '0.0.0.0',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenNthCalledWith(
			2,
			'openssl',
			expect.arrayContaining([
				'-subj',
				'/CN=localhost',
				'-addext',
				'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1',
			]),
			expect.objectContaining({encoding: 'utf8'}),
		);
	});

	it('does not duplicate the host when it is already a loopback identity', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync} = loadTlsModule({
			envOverrides: {
				HOST: '127.0.0.1',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenNthCalledWith(
			2,
			'openssl',
			expect.arrayContaining([
				'-addext',
				'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1',
			]),
			expect.objectContaining({encoding: 'utf8'}),
		);
	});

	it('uses an IPv6 SAN for an IPv6 host instead of a DNS entry', () => {
		const certPath = '/certs/nest-cert.pem';
		const keyPath = '/certs/nest-key.pem';
		const {ensureTlsCertificate, spawnSync} = loadTlsModule({
			envOverrides: {
				HOST: 'fd00::10',
				TLS_CERT_PATH: certPath,
				TLS_KEY_PATH: keyPath,
			},
			existingPaths: [],
			spawnSyncImplementation: jest
				.fn()
				.mockReturnValueOnce({status: 0}) // openssl version check
				.mockReturnValueOnce({status: 0}), // generate cert
		});

		expect(ensureTlsCertificate()).toEqual({certPath, keyPath});
		expect(spawnSync).toHaveBeenNthCalledWith(
			2,
			'openssl',
			expect.arrayContaining([
				'-subj',
				'/CN=fd00::10',
				'-addext',
				'subjectAltName=IP:fd00::10,DNS:localhost,IP:127.0.0.1,IP:::1',
			]),
			expect.objectContaining({encoding: 'utf8'}),
		);
	});
});

describe('calculateDaysUntilExpiry', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.resetModules();
	});

	it('calculates days until expiry for certificate expiring in 1 year', () => {
		// Mock Date to use a fixed "now" date
		const fixedNow = new Date('2026-08-25T00:00:00.000Z');
		const expiryDate = new Date('2027-08-25T00:00:00.000Z');

		// Import after mocking
		jest.doMock('child_process', () => ({spawnSync: jest.fn()}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: jest.fn(),
				mkdirSync: jest.fn(),
				chmodSync: jest.fn(),
				statSync: jest.fn(),
				writeFileSync: jest.fn(),
				unlinkSync: jest.fn(),
				rmSync: jest.fn(),
			},
			existsSync: jest.fn(),
			mkdirSync: jest.fn(),
			chmodSync: jest.fn(),
			statSync: jest.fn(),
			writeFileSync: jest.fn(),
			unlinkSync: jest.fn(),
			rmSync: jest.fn(),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const tlsModule = require('./tls') as {
			calculateDaysUntilExpiry: (expiryDate: Date, now?: Date) => number;
		};

		const days = tlsModule.calculateDaysUntilExpiry?.(expiryDate, fixedNow);
		expect(days).toBe(365);
	});

	it('returns a negative number for an already expired certificate', () => {
		// A negative value is what makes needsCertRegeneration renew the cert:
		// an absolute value would make an expired cert look far in the future.
		const fixedNow = new Date('2026-08-25T00:00:00.000Z');
		const expiryDate = new Date('2026-06-16T00:00:00.000Z'); // 70 days earlier

		jest.doMock('child_process', () => ({spawnSync: jest.fn()}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: jest.fn(),
				mkdirSync: jest.fn(),
				chmodSync: jest.fn(),
				statSync: jest.fn(),
				writeFileSync: jest.fn(),
				unlinkSync: jest.fn(),
				rmSync: jest.fn(),
			},
			existsSync: jest.fn(),
			mkdirSync: jest.fn(),
			chmodSync: jest.fn(),
			statSync: jest.fn(),
			writeFileSync: jest.fn(),
			unlinkSync: jest.fn(),
			rmSync: jest.fn(),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const tlsModule = require('./tls') as {
			calculateDaysUntilExpiry: (expiryDate: Date, now?: Date) => number;
		};

		const days = tlsModule.calculateDaysUntilExpiry?.(expiryDate, fixedNow);
		expect(days).toBe(-70);
	});

	it('calculates days until expiry for certificate expiring in 10 days', () => {
		const fixedNow = new Date('2026-08-25T00:00:00.000Z');
		const expiryDate = new Date('2026-09-04T00:00:00.000Z'); // 10 days later

		jest.doMock('child_process', () => ({spawnSync: jest.fn()}));
		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: jest.fn(),
				mkdirSync: jest.fn(),
				chmodSync: jest.fn(),
				statSync: jest.fn(),
				writeFileSync: jest.fn(),
				unlinkSync: jest.fn(),
				rmSync: jest.fn(),
			},
			existsSync: jest.fn(),
			mkdirSync: jest.fn(),
			chmodSync: jest.fn(),
			statSync: jest.fn(),
			writeFileSync: jest.fn(),
			unlinkSync: jest.fn(),
			rmSync: jest.fn(),
		}));

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const tlsModule = require('./tls') as {
			calculateDaysUntilExpiry: (expiryDate: Date, now?: Date) => number;
		};

		const days = tlsModule.calculateDaysUntilExpiry?.(expiryDate, fixedNow);
		expect(days).toBe(10);
	});
});
