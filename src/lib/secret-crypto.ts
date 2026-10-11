import {createCipheriv, createDecipheriv, hkdfSync, randomBytes} from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {env} from '../config/env';
import {getErrorMessage} from './error-message';
import {validateUnixFileSecurity} from './file-security';
import {logger} from './logger';

/**
 * Encryption at rest for secrets stored in `local-presets.conf`.
 *
 * Threat model (deliberately narrow, and honest about it): the service runs as
 * root and must hand the plaintext credential to the plugin at runtime, so an
 * attacker who already controls the process or reads the master key can always
 * recover plaintext. Encryption is NOT a boundary against root. What it does
 * protect is the realistic leak paths: backups and tarballs that copy the
 * presets file, non-root local readers, accidental commits, and any future bug
 * that serves file content. Ciphertext never leaves this module as plaintext.
 *
 * Format: `enc:v1:` + base64(salt | iv | authTag | ciphertext)
 *   - salt:     16 random bytes, per value, feeds HKDF so the master key is
 *               never used directly and identical plaintexts differ.
 *   - iv:       12 random bytes, per value (GCM's standard nonce size).
 *   - authTag:  16 bytes, GCM authentication tag - tampering fails decryption.
 *   - key:      HKDF-SHA256(masterKey, salt, info) -> 32 bytes.
 *
 * The master key lives in its own file (`SECRET_KEY_PATH`, default
 * `secrets/nest.key`, `/etc/nest/nest.key` in the deb), owner-only 0600, and
 * deliberately OUTSIDE the plugins directory so the admin editor - which can
 * read and rewrite `local-presets.conf` - can never read or overwrite it.
 */
export const ENCRYPTED_PREFIX = 'enc:v1:';

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HKDF_INFO = 'nest-secret-v1';

/** Directories the master key file may live in. Mirrors the config path rules. */
const ALLOWED_KEY_DIRS = ['/etc/nest', process.cwd()];

/** Cached master key, loaded once. Tests override via setSecretKeyProvider. */
let cachedKey: Buffer | null = null;

/**
 * Injectable key provider (for testing). When set, it fully replaces disk
 * access, so unit tests never touch the filesystem for the master key.
 */
let secretKeyProviderFn: (() => Buffer) | null = null;

/**
 * Set the key provider (for testing purposes).
 *
 * @param fn Function returning the 32-byte master key, or null to restore disk access
 */
export const setSecretKeyProvider = (fn: (() => Buffer) | null): void => {
	secretKeyProviderFn = fn;
	cachedKey = null;
};

/**
 * Reset module state (for testing purposes).
 */
export const resetSecretCryptoState = (): void => {
	secretKeyProviderFn = null;
	cachedKey = null;
};

/**
 * True when a config value is an encrypted blob rather than plaintext.
 *
 * Values without the prefix are treated as plaintext, so existing presets keep
 * working with no migration.
 *
 * @param value The raw config value
 */
export const isEncryptedValue = (value: string): boolean =>
	value.startsWith(ENCRYPTED_PREFIX);

/**
 * Resolve the master key file path from configuration.
 *
 * @returns Absolute path to the master key file
 */
export const getSecretKeyPath = (): string => {
	const configured = env.SECRET_KEY_PATH;
	return path.isAbsolute(configured)
		? path.resolve(configured)
		: path.resolve(process.cwd(), configured);
};

/**
 * Validate the master key file path for security.
 *
 * Rejects path traversal and any location outside the allowed directories, so a
 * misconfigured `SECRET_KEY_PATH` cannot point at an arbitrary file.
 *
 * @throws Error if the path is insecure
 */
export const validateSecretKeyPath = (): void => {
	const configured = env.SECRET_KEY_PATH;
	if (configured.includes('..')) {
		throw new Error('Secret key path contains path traversal sequence');
	}
	const absolutePath = getSecretKeyPath();
	const isAllowed = ALLOWED_KEY_DIRS.some((baseDir) => {
		const resolvedBaseDir = path.resolve(baseDir);
		return (
			absolutePath.startsWith(resolvedBaseDir + path.sep) ||
			absolutePath === resolvedBaseDir
		);
	});
	if (!isAllowed) {
		throw new Error(
			`Secret key path not in allowed directory: ${absolutePath}`,
		);
	}
};

/**
 * True when the master key file exists on disk.
 */
export const secretKeyFileExists = (): boolean => {
	if (secretKeyProviderFn) {
		return true;
	}
	validateSecretKeyPath();
	return fs.existsSync(getSecretKeyPath());
};

/**
 * Read and validate the master key from disk, caching it.
 *
 * Enforces the same ownership/permission rules as the presets file: the key
 * must be owned by the running uid and not group- or other-writable. A key that
 * fails these checks is refused rather than trusted.
 *
 * @returns The 32-byte master key
 * @throws Error if the file is missing, malformed, or insecure
 */
const readSecretKeyFromDisk = (): Buffer => {
	validateSecretKeyPath();
	const keyPath = getSecretKeyPath();

	if (!fs.existsSync(keyPath)) {
		throw new Error(`Secret key file not found: ${keyPath}`);
	}

	const stats = fs.statSync(keyPath);
	if (!stats.isFile()) {
		throw new Error('Secret key path is not a regular file');
	}

	const expectedUid =
		typeof process.getuid === 'function' ? process.getuid() : undefined;
	if (expectedUid !== undefined) {
		const validation = validateUnixFileSecurity(stats, expectedUid);
		if (!validation.ok) {
			throw new Error(
				`Secret key file has insecure ownership or permissions: ${validation.reason}`,
			);
		}
	}

	const key = fs.readFileSync(keyPath);
	if (key.length !== KEY_LENGTH) {
		throw new Error(
			`Secret key must be ${KEY_LENGTH} bytes, found ${key.length}`,
		);
	}
	return key;
};

/**
 * Get the master key, loading and caching it on first use.
 *
 * @returns The 32-byte master key
 * @throws Error if no key is available
 */
export const getSecretKey = (): Buffer => {
	if (secretKeyProviderFn) {
		return secretKeyProviderFn();
	}
	if (!cachedKey) {
		cachedKey = readSecretKeyFromDisk();
	}
	return cachedKey;
};

/**
 * Create a fresh master key file with owner-only permissions.
 *
 * Used to bootstrap a deployment that has no key yet. The file is written with
 * `wx` (fail if it already exists) and chmod 0600 so umask cannot widen it,
 * matching how the presets file is written.
 *
 * @returns The newly created 32-byte key
 */
export const createSecretKey = (): Buffer => {
	validateSecretKeyPath();
	const keyPath = getSecretKeyPath();
	const key = randomBytes(KEY_LENGTH);

	fs.mkdirSync(path.dirname(keyPath), {recursive: true});
	try {
		fs.writeFileSync(keyPath, key, {mode: 0o600, flag: 'wx'});
		fs.chmodSync(keyPath, 0o600);
	} catch (error) {
		throw new Error(
			`Could not create secret key file: ${getErrorMessage(error)}`,
		);
	}
	cachedKey = key;
	logger.info(`Generated a new secret key at ${keyPath} (0600).`);
	return key;
};

/**
 * Derive a per-value AES key from the master key and the value's salt.
 */
const deriveKey = (masterKey: Buffer, salt: Buffer): Buffer =>
	Buffer.from(
		hkdfSync('sha256', masterKey, salt, Buffer.from(HKDF_INFO), KEY_LENGTH),
	);

/**
 * Encrypt a plaintext secret into an `enc:v1:` value.
 *
 * @param plaintext The secret to encrypt
 * @param key Optional key override (defaults to the configured master key)
 * @returns The `enc:v1:`-prefixed base64 blob
 */
export const encryptSecret = (plaintext: string, key?: Buffer): string => {
	const masterKey = key ?? getSecretKey();
	const salt = randomBytes(SALT_LENGTH);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', deriveKey(masterKey, salt), iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, 'utf8'),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	const payload = Buffer.concat([salt, iv, authTag, ciphertext]);
	return `${ENCRYPTED_PREFIX}${payload.toString('base64')}`;
};

/**
 * Decrypt an `enc:v1:` value back to plaintext.
 *
 * @param encoded The `enc:v1:`-prefixed base64 blob
 * @param key Optional key override (defaults to the configured master key)
 * @returns The decrypted plaintext
 * @throws Error if the value is malformed, tampered with, or the key is wrong
 */
export const decryptSecret = (encoded: string, key?: Buffer): string => {
	if (!isEncryptedValue(encoded)) {
		throw new Error('Value is not an encrypted secret');
	}
	const masterKey = key ?? getSecretKey();
	const payload = Buffer.from(encoded.slice(ENCRYPTED_PREFIX.length), 'base64');
	const minimumLength = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;
	if (payload.length < minimumLength) {
		throw new Error('Encrypted secret is truncated');
	}
	let offset = 0;
	const salt = payload.subarray(offset, offset + SALT_LENGTH);
	offset += SALT_LENGTH;
	const iv = payload.subarray(offset, offset + IV_LENGTH);
	offset += IV_LENGTH;
	const authTag = payload.subarray(offset, offset + AUTH_TAG_LENGTH);
	offset += AUTH_TAG_LENGTH;
	const ciphertext = payload.subarray(offset);

	const decipher = createDecipheriv(
		'aes-256-gcm',
		deriveKey(masterKey, salt),
		iv,
	);
	decipher.setAuthTag(authTag);
	try {
		return Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]).toString('utf8');
	} catch {
		// GCM authentication failure: wrong key or tampered ciphertext. Never
		// surface the underlying detail, which could aid an attacker.
		throw new Error(
			'Could not decrypt the secret - wrong key or tampered value',
		);
	}
};
