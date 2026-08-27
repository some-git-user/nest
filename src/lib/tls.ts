import {spawnSync} from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import {env} from '../config/env';
import {getErrorMessage} from './error-message';
import {logger} from './logger';
import {LOOPBACK_HOSTS, WILDCARD_HOSTS} from './network-identity';
import {recordStartupWarning} from './startup-warning-registry';

// Certificate generation configuration
const DEFAULT_CERT_VALIDITY_DAYS = 365;
const CERT_RENEWAL_THRESHOLD_DAYS = 30; // Renew if less than 30 days remaining

// How `openssl x509 -text` labels the two SAN kinds. The IP label includes its
// own colon, which matters when splitting a value off an IPv6 entry.
const IP_SAN_PREFIX = 'IP Address:';

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
	host: string,
	days: number,
): void => {
	const certDir = path.dirname(certPath);
	const keyDir = path.dirname(keyPath);

	fs.mkdirSync(certDir, {recursive: true});
	fs.mkdirSync(keyDir, {recursive: true});

	// Use -addext flags for SAN (OpenSSL 1.1.1+) to avoid config file issues
	const requiredSans = buildRequiredSans(host);
	const sanExt = requiredSans
		.map((entry) => toOpenSslSanExtension(entry))
		.join(',');

	// A wildcard bind address is not an identity, so the CN falls back to the
	// first real identity in the certificate.
	const commonName = requiredSans[0];

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
		'/CN=' + commonName,
		'-addext',
		'subjectAltName=' + sanExt,
		'-addext',
		'basicConstraints=CA:false',
		'-addext',
		'keyUsage=digitalSignature,keyEncipherment',
		'-addext',
		'extendedKeyUsage=serverAuth',
		'-batch',
	]);

	try {
		fs.chmodSync(keyPath, 0o600);
	} catch {
		// Best effort: key permissions are tightened when filesystem supports chmod.
	}
};

/**
 * Build the `-addext subjectAltName=` value for an identity.
 *
 * OpenSSL expects `IP:<addr>` / `DNS:<name>` here, while `openssl x509 -text`
 * prints the same identities as `IP Address:<addr>` / `DNS:<name>`. Keeping the
 * two spellings next to each other avoids the two formats drifting apart.
 */
const toOpenSslSanExtension = (identity: string): string => {
	return net.isIP(identity) ? `IP:${identity}` : `DNS:${identity}`;
};

/**
 * The identity spelling used by `openssl x509 -text` output.
 */
const toParsedSanEntry = (identity: string): string => {
	return net.isIP(identity) ? `${IP_SAN_PREFIX}${identity}` : `DNS:${identity}`;
};

/**
 * Expand an IPv6 address to its fully written-out form.
 *
 * `openssl x509 -text` prints IPv6 SANs expanded (`0:0:0:0:0:0:0:1` for `::1`),
 * so both sides of a comparison are expanded before matching.
 */
const expandIpv6 = (address: string): string => {
	// `split('::')` always yields at least one element, so only the tail needs a default.
	const [headPart, tailPart = ''] = address.split('::');
	const head = headPart ? headPart.split(':') : [];
	const tail = tailPart ? tailPart.split(':') : [];
	const groups = [
		...head,
		...Array<string>(Math.max(8 - head.length - tail.length, 0)).fill('0'),
		...tail,
	];

	return groups.map((group) => group.padStart(4, '0')).join(':');
};

/**
 * Bring a SAN entry to a common comparison key.
 *
 * Entries always come from `parseCertificateInfo()` or `toParsedSanEntry()`,
 * so they always carry an `IP Address:` or `DNS:` label. The label has to be
 * stripped by prefix rather than at the first colon: an IPv6 value starts with
 * a colon itself (`IP Address:::1`).
 */
const normalizeSanEntry = (entry: string): string => {
	if (!entry.startsWith(IP_SAN_PREFIX)) {
		return entry.toLowerCase();
	}

	const value = entry.slice(IP_SAN_PREFIX.length);

	return net.isIP(value) === 6 ? `${IP_SAN_PREFIX}${expandIpv6(value)}` : entry;
};

/**
 * Every identity a certificate must carry to be usable in the current setup:
 * the configured host (unless it is a wildcard bind address) plus loopback, so
 * that internal self-requests always find a matching SAN.
 */
export const buildRequiredSans = (host: string): string[] => {
	const identities = [...LOOPBACK_HOSTS];

	if (!WILDCARD_HOSTS.includes(host) && !identities.includes(host)) {
		identities.unshift(host);
	}

	return identities;
};

/**
 * Parse certificate to extract SAN and expiry date
 */
const parseCertificateInfo = (
	certPath: string,
): {
	sans: string[];
	expiryDate: Date | null;
} | null => {
	try {
		const result = spawnSync(
			'openssl',
			['x509', '-in', certPath, '-noout', '-text'],
			{
				encoding: 'utf8',
			},
		);

		if (result.error || result.status !== 0) {
			return null;
		}

		const output = result.stdout;

		// Extract Subject Alternative Names
		const sanMatch = output.match(
			/X509v3 Subject Alternative Name:\s*\n\s*([^\n]+)/,
		);
		const sans: string[] = [];
		if (sanMatch && sanMatch[1]) {
			const sanLine = sanMatch[1].trim();
			// Parse IP Address:192.168.1.1, DNS:localhost format (OpenSSL output)
			const sanEntries = sanLine.split(',').map((s) => s.trim());
			for (const entry of sanEntries) {
				if (entry.startsWith(IP_SAN_PREFIX) || entry.startsWith('DNS:')) {
					sans.push(entry);
				}
			}
		}

		// Extract expiry date
		const expiryMatch = output.match(/Not After :\s*([^\n]+)/);
		let expiryDate: Date | null = null;
		if (expiryMatch && expiryMatch[1]) {
			// OpenSSL date format: Aug 24 19:16:50 2027 GMT
			const parsed = new Date(expiryMatch[1].trim());
			// `new Date()` returns a truthy Invalid Date, which would silently
			// poison every downstream comparison.
			if (!Number.isNaN(parsed.getTime())) {
				expiryDate = parsed;
			}
		}

		return {sans, expiryDate};
	} catch {
		return null;
	}
};

/**
 * Calculate days until certificate expiry.
 *
 * Negative when the certificate has already expired - that must stay negative,
 * otherwise an expired certificate looks far in the future and is never renewed.
 */
export const calculateDaysUntilExpiry = (
	expiryDate: Date,
	now: Date = new Date(),
): number => {
	return Math.trunc(
		(expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
	);
};

/**
 * Check if certificate needs regeneration
 */
export const needsCertRegeneration = (
	certPath: string,
	host: string,
): {needsRegen: boolean; reason: string} => {
	const info = parseCertificateInfo(certPath);

	if (!info) {
		return {needsRegen: true, reason: 'Failed to parse certificate'};
	}

	// The certificate has to cover every identity we connect with. Matching is
	// done on normalised entries because openssl expands IPv6 addresses and may
	// change the casing of DNS names, while the reason keeps the readable
	// spelling we asked for.
	const presentSans = new Set(info.sans.map((san) => normalizeSanEntry(san)));
	const missingIdentities = buildRequiredSans(host).filter(
		(identity) =>
			!presentSans.has(normalizeSanEntry(toParsedSanEntry(identity))),
	);

	if (missingIdentities.length > 0) {
		const missing = missingIdentities
			.map((identity) => toParsedSanEntry(identity))
			.join(', ');
		return {
			needsRegen: true,
			reason: `Certificate SAN does not include ${missing}. Current SANs: ${info.sans.join(', ') || 'none'}`,
		};
	}

	// Check if certificate is expiring soon
	if (info.expiryDate) {
		const daysUntilExpiry = calculateDaysUntilExpiry(info.expiryDate);

		if (daysUntilExpiry < CERT_RENEWAL_THRESHOLD_DAYS) {
			return {
				needsRegen: true,
				reason: `Certificate expires in ${daysUntilExpiry} days (threshold: ${CERT_RENEWAL_THRESHOLD_DAYS} days)`,
			};
		}
	}

	return {needsRegen: false, reason: 'Certificate is valid'};
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

		// Check if certificate needs regeneration (host mismatch or expiring soon).
		// needsCertRegeneration never throws: parse failures are reported as
		// { needsRegen: true }, so no try/catch is needed here.
		const {needsRegen, reason} = needsCertRegeneration(certPath, env.HOST);

		if (needsRegen) {
			logger.warn(
				`Certificate needs regeneration: ${reason}. Regenerating certificate.`,
			);
			recordStartupWarning(
				`Certificate needs regeneration: ${reason}. Regenerating certificate.`,
			);
			// Delete old certificate and key to trigger regeneration
			try {
				fs.unlinkSync(certPath);
				fs.unlinkSync(keyPath);
			} catch {
				// Ignore deletion errors, will fail below if still missing
			}
		} else {
			logger.info('Certificate is valid and up to date.');
			return {certPath, keyPath};
		}
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

	try {
		createSelfSignedCert(
			certPath,
			keyPath,
			env.HOST,
			DEFAULT_CERT_VALIDITY_DAYS,
		);
	} catch (error) {
		logger.error(
			`Failed to generate TLS certificate: ${getErrorMessage(error)}`,
		);
		throw new Error(
			`Failed to generate TLS certificate: ${getErrorMessage(error)}`,
		);
	}

	logger.info('Generated self-signed TLS certificate for HTTPS startup.');

	return {certPath, keyPath};
};
