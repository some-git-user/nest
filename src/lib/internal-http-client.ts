import fs from 'fs';
import * as https from 'https';
import path from 'path';
import * as tls from 'tls';
import {env} from '../config/env';
import {getErrorMessage} from './error-message';
import {logger} from './logger';
import {resolveSelfRequestHost} from './network-identity';

export interface InternalHttpRequestOptions {
	method: 'GET' | 'POST';
	path: string;
	params?: Record<string, string>;
	body?: Record<string, string>;
	apiKey?: string; // API key from original request (passed through)
	apiKeyHeader?: string; // Header name from original request
	requireApiKey?: boolean; // If true, require API key for authentication (default: true)
}

export interface InternalHttpResponse {
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

// Maximum allowed certificate file size (10KB)
const MAX_CERT_FILE_SIZE = 10 * 1024;

// Successful certificate loads are memoised by absolute path: the certificate
// is only (re)generated at startup, so re-reading and re-validating it for
// every internal request is pure overhead. Failures are deliberately not
// cached, so a request made before the certificate exists can still succeed
// later on.
const certificateCache = new Map<string, Buffer>();

/**
 * Drop the memoised certificate. Intended for tests and for a startup
 * regeneration of the certificate file.
 */
export const resetNestCertificateCache = (): void => {
	certificateCache.clear();
};

/**
 * Load the specific nest self-signed certificate
 * Returns the certificate content or null if not available
 * SECURITY: Uses Node.js built-in TLS validation to ensure certificate is valid
 */
export const loadNestCertificate = (): Buffer | null => {
	let absolutePath: string | null = null;
	try {
		// Resolve certificate path from environment
		const certPath = env.TLS_CERT_PATH;
		absolutePath = path.isAbsolute(certPath)
			? certPath
			: path.resolve(process.cwd(), certPath);

		// SECURITY: Prevent path traversal attacks
		if (absolutePath.includes('..')) {
			logger.error(
				`[CERTIFICATE] Path traversal attempt blocked: ${absolutePath}`,
			);
			return null;
		}

		const cached = certificateCache.get(absolutePath);
		if (cached) {
			return cached;
		}

		// SECURITY: Certificate must be in allowed directories only
		const normalizedPath = path.normalize(absolutePath);
		const allowedDirectories = [
			path.resolve(process.cwd(), 'certs'),
			'/etc/nest/certs',
			'/certs',
		];

		// Compare against the directory *including* its separator, otherwise a
		// sibling such as /certs-evil/x.pem would be accepted for /certs.
		const isInAllowedDirectory = allowedDirectories.some(
			(allowedDir) =>
				normalizedPath === allowedDir ||
				normalizedPath.startsWith(allowedDir + path.sep),
		);

		if (!isInAllowedDirectory) {
			logger.error(
				`[CERTIFICATE] Path not in allowed directories: ${normalizedPath}`,
			);
			logger.error(
				`[CERTIFICATE] Allowed directories: ${allowedDirectories.join(', ')}`,
			);
			return null;
		}

		// Check if certificate file exists
		if (!fs.existsSync(absolutePath)) {
			logger.error(`[CERTIFICATE] Certificate file not found: ${absolutePath}`);
			logger.error(`[CERTIFICATE] Current working directory: ${process.cwd()}`);
			logger.error(`[CERTIFICATE] TLS_CERT_PATH env: ${certPath}`);
			return null;
		}

		// SECURITY: Verify it's a regular file (not a device, symlink, etc.)
		const stats = fs.statSync(absolutePath);
		if (!stats.isFile()) {
			logger.error(`[CERTIFICATE] Path is not a regular file: ${absolutePath}`);
			return null;
		}

		// SECURITY: Enforce reasonable file size limit (10KB max for certificates)
		if (stats.size > MAX_CERT_FILE_SIZE) {
			logger.error(
				`[CERTIFICATE] Certificate file too large (${stats.size} bytes): ${absolutePath}`,
			);
			return null;
		}

		// Read the certificate file as binary
		const certBuffer = fs.readFileSync(absolutePath);

		// SECURITY: Use Node.js built-in TLS to validate the certificate
		// This will throw if the certificate is malformed or invalid
		try {
			tls.createSecureContext({ca: [certBuffer]});
			certificateCache.set(absolutePath, certBuffer);
			logger.info(
				`[CERTIFICATE] Successfully loaded: ${absolutePath} (${certBuffer.length} bytes)`,
			);
			return certBuffer;
		} catch (validationError) {
			const validationErrorMsg = getErrorMessage(validationError);
			logger.error(`[CERTIFICATE] Validation failed: ${validationErrorMsg}`);
			logger.error(`[CERTIFICATE] Certificate path: ${absolutePath}`);
			return null;
		}
	} catch (error) {
		const errorMsg = getErrorMessage(error);
		logger.error(`[CERTIFICATE] Failed to load: ${errorMsg}`);
		if (absolutePath) {
			logger.error(`[CERTIFICATE] Certificate path: ${absolutePath}`);
		}
		return null;
	}
};

/**
 * Make internal HTTPS request to Nest API
 * Reuses the API key from the original request to pass through authentication middleware
 * @param options Request options including optional API key authentication
 */
export const makeInternalRequest = async (
	options: InternalHttpRequestOptions,
): Promise<InternalHttpResponse> => {
	// HTTPS Only - no HTTP protocol needed

	// Build URL with query params for GET
	let path = options.path;
	if (options.params && Object.keys(options.params).length > 0) {
		const queryString = Object.entries(options.params)
			.map(
				([key, value]) =>
					`${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
			)
			.join('&');
		path = `${path}?${queryString}`;
	}

	// Validate API key requirement. Throwing (rather than returning an orphan
	// rejected promise) keeps the rejection tied to the caller's await.
	const requireApiKey = options.requireApiKey ?? true;
	if (requireApiKey && !options.apiKey) {
		throw new Error('API key required but not provided');
	}

	return new Promise((resolve, reject) => {
		// Load the specific nest certificate
		const nestCert = loadNestCertificate();

		const targetHost = resolveSelfRequestHost(env.HOST);

		const req = https.request(
			{
				hostname: targetHost,
				port: env.PORT,
				path,
				method: options.method,
				headers: {
					Host: `${targetHost}:${env.PORT}`,
					Connection: 'keep-alive',
					// Reuse API key from original request to pass through authentication
					// Only include if provided (optional for GET requests)
					...(options.apiKey &&
						options.apiKeyHeader && {
							[options.apiKeyHeader]: options.apiKey,
						}),
				},
				// Trust ONLY the specific nest self-signed certificate
				// If certificate loading fails, fall back to rejecting unauthorized
				// This ensures we're not blindly trusting all self-signed certs
				// In development, disable cert validation for convenience
				rejectUnauthorized: env.NODE_ENV === 'production',
				...(nestCert && {ca: nestCert}),
			},
			(res) => {
				let body = '';

				res.on('data', (chunk) => {
					body += chunk;
				});

				res.on('end', () => {
					resolve({
						statusCode: res.statusCode || 500,
						headers: res.headers,
						body,
					});
				});
			},
		);

		req.on('error', (error: unknown) => {
			const errorMsg = getErrorMessage(error);
			logger.error(`[INTERNAL-HTTP] Request failed: ${options.method} ${path}`);
			logger.error(`[INTERNAL-HTTP] Error: ${errorMsg}`);
			logger.error(
				`[INTERNAL-HTTP] Details: hostname=${resolveSelfRequestHost(env.HOST)}, port=${env.PORT}`,
			);
			if (error instanceof Error && error.stack) {
				logger.error(`[INTERNAL-HTTP] Stack: ${error.stack}`);
			}
			reject(error instanceof Error ? error : new Error(errorMsg));
		});

		req.setTimeout(30000, () => {
			req.destroy();
			reject(new Error('Internal request timeout'));
		});

		// Write body for POST requests
		if (options.body && options.method === 'POST') {
			const jsonBody = JSON.stringify(options.body);
			req.setHeader('Content-Type', 'application/json');
			req.setHeader('Content-Length', Buffer.byteLength(jsonBody));
			req.write(jsonBody);
		}

		req.end();
	});
};
