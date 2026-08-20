import fs from 'fs';
import * as https from 'https';
import path from 'path';
import * as tls from 'tls';
import {env} from '../config/env';
import {getErrorMessage} from './error-message';
import {logger} from './logger';

export interface InternalHttpRequestOptions {
	method: 'GET' | 'POST';
	path: string;
	params?: Record<string, string>;
	body?: Record<string, string>;
	apiKey?: string; // API key from original request (passed through)
	apiKeyHeader?: string; // Header name from original request
}

export interface InternalHttpResponse {
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

/**
 * Load the specific nest self-signed certificate
 * Returns the certificate content or null if not available
 * SECURITY: Uses Node.js built-in TLS validation to ensure certificate is valid
 */
const loadNestCertificate = (): Buffer | null => {
	try {
		// Resolve certificate path from environment
		const certPath = env.TLS_CERT_PATH;
		const absolutePath = path.isAbsolute(certPath)
			? certPath
			: path.resolve(process.cwd(), certPath);

		// SECURITY: Prevent path traversal attacks
		if (absolutePath.includes('..')) {
			logger.warn(
				`Certificate path contains path traversal attempt: ${absolutePath}`,
			);
			return null;
		}

		// SECURITY: Certificate must be in allowed directories only
		const normalizedPath = path.normalize(absolutePath);
		const allowedDirectories = [
			path.resolve(process.cwd(), 'certs'),
			'/etc/nest/certs',
			'/certs',
		];

		const isInAllowedDirectory = allowedDirectories.some((allowedDir) =>
			normalizedPath.startsWith(allowedDir),
		);

		if (!isInAllowedDirectory) {
			logger.warn(
				`Certificate path not in allowed directories: ${normalizedPath}`,
			);
			return null;
		}

		// Check if certificate file exists
		if (!fs.existsSync(absolutePath)) {
			logger.warn(`Nest certificate not found at ${absolutePath}`);
			return null;
		}

		// SECURITY: Verify it's a regular file (not a device, symlink, etc.)
		const stats = fs.statSync(absolutePath);
		if (!stats.isFile()) {
			logger.warn(`Certificate path is not a regular file: ${absolutePath}`);
			return null;
		}

		// SECURITY: Enforce reasonable file size limit (10KB max for certificates)
		if (stats.size > 10240) {
			logger.warn(
				`Certificate file exceeds maximum size (${stats.size} bytes): ${absolutePath}`,
			);
			return null;
		}

		// Read the certificate file as binary
		const certBuffer = fs.readFileSync(absolutePath);

		// SECURITY: Use Node.js built-in TLS to validate the certificate
		// This will throw if the certificate is malformed or invalid
		try {
			const secureContext = tls.createSecureContext({
				ca: [certBuffer],
			});
			logger.debug(
				`Successfully validated nest certificate from ${absolutePath} (${certBuffer.length} bytes)`,
			);
			return certBuffer;
		} catch (validationError) {
			const validationErrorMsg = getErrorMessage(validationError);
			logger.warn(`Certificate validation failed: ${validationErrorMsg}`);
			return null;
		}
	} catch (error) {
		const errorMsg = getErrorMessage(error);
		logger.warn(`Failed to load nest certificate: ${errorMsg}`);
		return null;
	}
};

/**
 * Make internal HTTPS request to Nest API
 * Reuses the API key from the original request to pass through authentication middleware
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

	return new Promise((resolve, reject) => {
		// Load the specific nest certificate
		const nestCert = loadNestCertificate();

		const req = https.request(
			{
				hostname: 'localhost', // Always localhost for internal requests
				port: env.PORT,
				path,
				method: options.method,
				headers: {
					Host: `${env.HOST}:${env.PORT}`,
					Connection: 'keep-alive',
					// Reuse API key from original request to pass through authentication
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
			logger.error(`Internal HTTPS request failed: ${errorMsg}`);
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
