import * as https from 'https';
import {env} from '../config/env';

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
				rejectUnauthorized: env.NODE_ENV === 'production',
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

		req.on('error', (error) => {
			reject(error);
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
