import {spawnSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {env} from '../config/env';
import {logger} from './logger';
import {recordStartupWarning} from './startup-warning-registry';

const resolvePathFromCwd = (inputPath: string): string => {
	if (path.isAbsolute(inputPath)) {
		return inputPath;
	}

	return path.resolve(process.cwd(), inputPath);
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
	const certExists = fs.existsSync(certPath);
	const keyExists = fs.existsSync(keyPath);

	if (certExists && keyExists) {
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
		env.TLS_CERT_COMMON_NAME,
		env.TLS_CERT_DAYS,
	);

	logger.info('Generated self-signed TLS certificate for HTTPS startup.');

	return {certPath, keyPath};
};
