import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const mockKeyDir = path.join(__dirname, '../../test/fixtures/secret-key');
const mockKeyPath = path.join(mockKeyDir, 'nest.key');

jest.mock('../config/env', () => ({
	env: {
		SECRET_KEY_PATH: mockKeyPath,
	},
}));

const {
	ENCRYPTED_PREFIX,
	createSecretKey,
	decryptSecret,
	encryptSecret,
	getSecretKey,
	getSecretKeyPath,
	isEncryptedValue,
	resetSecretCryptoState,
	secretKeyFileExists,
	setSecretKeyProvider,
	validateSecretKeyPath,
} = require('./secret-crypto');

describe('secret-crypto', () => {
	afterEach(() => {
		resetSecretCryptoState();
		if (fs.existsSync(mockKeyDir)) {
			fs.rmSync(mockKeyDir, {recursive: true, force: true});
		}
		const fixturesDir = path.join(__dirname, '../../test/fixtures');
		if (
			fs.existsSync(fixturesDir) &&
			fs.readdirSync(fixturesDir).length === 0
		) {
			fs.rmSync(fixturesDir, {recursive: true, force: true});
		}
		const testRootDir = path.join(__dirname, '../../test');
		if (
			fs.existsSync(testRootDir) &&
			fs.readdirSync(testRootDir).length === 0
		) {
			fs.rmSync(testRootDir, {recursive: true, force: true});
		}
	});

	describe('isEncryptedValue', () => {
		it('recognises the enc:v1: prefix', () => {
			expect(isEncryptedValue('enc:v1:abc123')).toBe(true);
		});

		it('treats plaintext as not encrypted', () => {
			expect(isEncryptedValue('hunter2')).toBe(false);
			expect(isEncryptedValue('')).toBe(false);
		});
	});

	describe('encrypt/decrypt with an injected key', () => {
		const key = crypto.randomBytes(32);

		beforeEach(() => {
			setSecretKeyProvider(() => key);
		});

		it('round-trips a secret', () => {
			const encoded = encryptSecret('s3cret value');
			expect(encoded.startsWith(ENCRYPTED_PREFIX)).toBe(true);
			expect(encoded).not.toContain('s3cret');
			expect(decryptSecret(encoded)).toBe('s3cret value');
		});

		it('produces a different blob each time (random salt + iv)', () => {
			const a = encryptSecret('same');
			const b = encryptSecret('same');
			expect(a).not.toBe(b);
			expect(decryptSecret(a)).toBe('same');
			expect(decryptSecret(b)).toBe('same');
		});

		it('round-trips an empty string', () => {
			const encoded = encryptSecret('');
			expect(decryptSecret(encoded)).toBe('');
		});

		it('round-trips unicode', () => {
			const secret = 'pässwörd-é中文';
			expect(decryptSecret(encryptSecret(secret))).toBe(secret);
		});

		it('rejects decryption with the wrong key', () => {
			const encoded = encryptSecret('topsecret');
			setSecretKeyProvider(() => crypto.randomBytes(32));
			expect(() => decryptSecret(encoded)).toThrow(
				'Could not decrypt the secret',
			);
		});

		it('rejects a tampered ciphertext', () => {
			const encoded = encryptSecret('topsecret');
			const payload = Buffer.from(
				encoded.slice(ENCRYPTED_PREFIX.length),
				'base64',
			);
			payload[payload.length - 1] ^= 0xff;
			const tampered = `${ENCRYPTED_PREFIX}${payload.toString('base64')}`;
			expect(() => decryptSecret(tampered)).toThrow(
				'Could not decrypt the secret',
			);
		});

		it('rejects a truncated blob', () => {
			const short = `${ENCRYPTED_PREFIX}${Buffer.alloc(4).toString('base64')}`;
			expect(() => decryptSecret(short)).toThrow('truncated');
		});

		it('rejects decrypting a plaintext value', () => {
			expect(() => decryptSecret('plaintext')).toThrow(
				'not an encrypted secret',
			);
		});
	});

	describe('getSecretKeyPath', () => {
		it('returns the configured absolute path', () => {
			expect(getSecretKeyPath()).toBe(path.resolve(mockKeyPath));
		});
	});

	describe('validateSecretKeyPath', () => {
		it('accepts a path under the working directory', () => {
			expect(() => validateSecretKeyPath()).not.toThrow();
		});
	});

	describe('secretKeyFileExists', () => {
		it('is false when the file is absent', () => {
			expect(secretKeyFileExists()).toBe(false);
		});

		it('is true when the file exists', () => {
			fs.mkdirSync(mockKeyDir, {recursive: true});
			fs.writeFileSync(mockKeyPath, crypto.randomBytes(32), {mode: 0o600});
			expect(secretKeyFileExists()).toBe(true);
		});

		it('is true when a provider is injected', () => {
			setSecretKeyProvider(() => crypto.randomBytes(32));
			expect(secretKeyFileExists()).toBe(true);
		});
	});

	describe('createSecretKey', () => {
		it('creates a 32-byte key file and caches it', () => {
			const key = createSecretKey();
			expect(key.length).toBe(32);
			expect(fs.existsSync(mockKeyPath)).toBe(true);
			expect(fs.readFileSync(mockKeyPath).length).toBe(32);
			expect(getSecretKey()).toEqual(key);
		});

		it('sets owner-only permissions', () => {
			createSecretKey();
			const mode = fs.statSync(mockKeyPath).mode & 0o777;
			// Must not be group- or other-writable.
			expect(mode & 0o022).toBe(0);
		});

		it('refuses to overwrite an existing key', () => {
			fs.mkdirSync(mockKeyDir, {recursive: true});
			fs.writeFileSync(mockKeyPath, crypto.randomBytes(32), {mode: 0o600});
			expect(() => createSecretKey()).toThrow('Could not create secret key');
		});
	});

	describe('getSecretKey from disk', () => {
		it('reads a valid key file', () => {
			const key = crypto.randomBytes(32);
			fs.mkdirSync(mockKeyDir, {recursive: true});
			fs.writeFileSync(mockKeyPath, key, {mode: 0o600});
			expect(getSecretKey()).toEqual(key);
		});

		it('throws when the file is missing', () => {
			expect(() => getSecretKey()).toThrow('Secret key file not found');
		});

		it('throws when the key has the wrong length', () => {
			fs.mkdirSync(mockKeyDir, {recursive: true});
			fs.writeFileSync(mockKeyPath, crypto.randomBytes(16), {mode: 0o600});
			expect(() => getSecretKey()).toThrow('must be 32 bytes');
		});

		it('throws when the path is not a regular file', () => {
			fs.mkdirSync(mockKeyDir, {recursive: true});
			fs.mkdirSync(mockKeyPath);
			expect(() => getSecretKey()).toThrow('not a regular file');
		});

		it('throws when the key file has insecure permissions', () => {
			fs.mkdirSync(mockKeyDir, {recursive: true});
			fs.writeFileSync(mockKeyPath, crypto.randomBytes(32), {mode: 0o600});
			// Group-writable: validateUnixFileSecurity must refuse the key.
			fs.chmodSync(mockKeyPath, 0o660);
			expect(() => getSecretKey()).toThrow('insecure ownership or permissions');
		});

		it('skips the ownership check when getuid is unavailable', () => {
			fs.mkdirSync(mockKeyDir, {recursive: true});
			const key = crypto.randomBytes(32);
			fs.writeFileSync(mockKeyPath, key, {mode: 0o600});
			const originalGetuid = process.getuid;
			process.getuid = undefined as never;
			try {
				expect(getSecretKey()).toEqual(key);
			} finally {
				process.getuid = originalGetuid;
			}
		});
	});

	describe('validateSecretKeyPath rejections', () => {
		const loadWithKeyPath = (secretKeyPath: string) => {
			jest.resetModules();
			jest.doMock('../config/env', () => ({
				env: {SECRET_KEY_PATH: secretKeyPath},
			}));
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			return require('./secret-crypto');
		};

		it('resolves a relative path against the working directory', () => {
			const mod = loadWithKeyPath('secrets/nest.key');
			expect(mod.getSecretKeyPath()).toBe(
				path.resolve(process.cwd(), 'secrets/nest.key'),
			);
			jest.resetModules();
		});

		it('rejects a path containing traversal sequences', () => {
			const mod = loadWithKeyPath('secrets/../nest.key');
			expect(() => mod.validateSecretKeyPath()).toThrow(
				'path traversal sequence',
			);
			expect(() => mod.secretKeyFileExists()).toThrow(
				'path traversal sequence',
			);
			jest.resetModules();
		});

		it('rejects a path outside the allowed directories', () => {
			const mod = loadWithKeyPath('/tmp/nest-evil.key');
			expect(() => mod.validateSecretKeyPath()).toThrow(
				'not in allowed directory',
			);
			jest.resetModules();
		});
	});
});
