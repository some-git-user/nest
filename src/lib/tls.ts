import {spawnSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {env} from '../config/env';
import {logger} from './logger';
import {recordStartupWarning} from './startup-warning-registry';

// Static defaults for self-signed certificate generation
const DEFAULT_CERT_COMMON_NAME = 'localhost';
const DEFAULT_CERT_VALIDITY_DAYS = 365;

// Maximum allowed certificate/key file size (10KB)
const MAX_CERT_FILE_SIZE = 10 * 1024;

// Allowed directories for TLS certificates
const ALLOWED_TLS_DIRS = [
	'/certs',
	'/etc/nest/certs',
	process.cwd() + '/certs', // Allow certs in project directory for development
];

const resolvePathFromCwd = (inputPath: string): string => {
	if (path.isAbsolute(inputPath)) {
		return inputPath;
	}

	return path.resolve(process.cwd(), inputPath);
};

/**
 * Validate TLS certificate/key path for security
 * Prevents path traversal and ensures file is in allowed directory
 *
 * @param certPath Absolute path to validate
 * @param certType Type of file (certificate or key)
 * @throws Error if path is insecure
 */
const validateTlsPath = (
	certPath: string,
	certType: 'certificate' | 'key',
): void => {
	// Reject paths containing path traversal sequences
	if (certPath.includes('..')) {
		throw new Error(`TLS ${certType} path contains path traversal sequence`);
	}

	// Resolve to absolute path for consistent validation
	const absolutePath = path.resolve(certPath);

	// Check if path is within allowed directories
	const isAllowed = ALLOWED_TLS_DIRS.some((baseDir) => {
		return (
			absolutePath.startsWith(baseDir + path.sep) || absolutePath === baseDir
		);
	});

	if (!isAllowed) {
		throw new Error(
			`TLS ${certType} path not in allowed directory: ${absolutePath}`,
		);
	}
};

/**
 * Validate TLS certificate/key file security (type, size)
 *
 * @param certPath Absolute path to validate
 * @param certType Type of file (certificate or key)
 * @throws Error if file security is unacceptable
 */
const validateTlsFileSecurity = (
	certPath: string,
	certType: 'certificate' | 'key',
): void => {
	const stats = fs.statSync(certPath);

	// Verify it's a regular file
	if (!stats.isFile()) {
		throw new Error(`TLS ${certType} is not a regular file`);
	}

	// Check file size
	if (stats.size > MAX_CERT_FILE_SIZE) {
		throw new Error(
			`TLS ${certType} exceeds maximum size limit (${MAX_CERT_FILE_SIZE} bytes)`,
		);
	}
};

const runOpenSsl = (args: string[]): void => {
	const result = spawnSync('openssl', args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	if (result.error) {
		throw new Error(`Failed to execute openssl: ${result.error.message}`);
	}

	if (result.status !== 0) {
		const stderr = result.stderr?.trim();
		throw new Error(
			`openssl command failed with status ${result.status}${stderr ? `: ${stderr}` : ''}`,
		);
	}
};

const opensslAvailable = (): boolean => {
	const result = spawnSync('openssl', ['version'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	return !result.error && result.status === 0;
};

const createSelfSignedCert = (
	certPath: string,
	keyPath: string,
	commonName: string,
	days: number,
): void => {
	const certDir = path.dirname(certPath);
	const keyDir = path.dirname(keyPath);

	fs.mkdirSync(certDir, {recursive: true});
	fs.mkdirSync(keyDir, {recursive: true});

	runOpenSsl([
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
		String(days),
		'-subj',
		`/CN=${commonName}`,
	]);

	try {
		fs.chmodSync(keyPath, 0o600);
	} catch {
		// Best effort: key permissions are tightened when filesystem supports chmod.
	}
};

export const ensureTlsCertificate = (): {certPath: string; keyPath: string} => {
	const certPath = resolvePathFromCwd(env.TLS_CERT_PATH);
	const keyPath = resolvePathFromCwd(env.TLS_KEY_PATH);

	// Validate paths before any file operations
	validateTlsPath(certPath, 'certificate');
	validateTlsPath(keyPath, 'key');

	const certExists = fs.existsSync(certPath);
	const keyExists = fs.existsSync(keyPath);

	if (certExists && keyExists) {
		// Validate file security for existing files
		validateTlsFileSecurity(certPath, 'certificate');
		validateTlsFileSecurity(keyPath, 'key');
		return {certPath, keyPath};
	}

	if (!opensslAvailable()) {
		throw new Error(
			`TLS certificate or key missing, and openssl is not available. Expected cert=${certPath}, key=${keyPath}`,
		);
	}

	logger.warn(
		`TLS certificate or key missing. Generating self-signed certificate at cert=${certPath}, key=${keyPath}`,
	);
	recordStartupWarning(
		`TLS certificate or key missing. Generating self-signed certificate at cert=${certPath}, key=${keyPath}`,
	);

	createSelfSignedCert(
		certPath,
		keyPath,
		DEFAULT_CERT_COMMON_NAME,
		DEFAULT_CERT_VALIDITY_DAYS,
	);

	logger.info('Generated self-signed TLS certificate for HTTPS startup.');

	return {certPath, keyPath};
};
