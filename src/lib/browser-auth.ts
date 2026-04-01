import {timingSafeEqual} from 'crypto';
import {Request} from 'express';

/** Timing-safe comparison for API keys. */
export const apiKeyMatches = (provided: string, expected: string): boolean => {
	const bufA = Buffer.from(provided, 'utf8');
	const bufB = Buffer.from(expected, 'utf8');
	if (bufA.byteLength !== bufB.byteLength) {
		return false;
	}
	return timingSafeEqual(bufA, bufB);
};

/**
 * Extracts the password from an HTTP Basic Authorization header.
 * Returns an empty string when the header is absent or malformed.
 */
export const parseBasicAuthPassword = (authHeader: string): string => {
	if (!authHeader.startsWith('Basic ')) {
		return '';
	}
	try {
		const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
		const colonIdx = decoded.indexOf(':');
		if (colonIdx === -1) {
			return '';
		}
		return decoded.slice(colonIdx + 1);
	} catch {
		return '';
	}
};

/** Returns true when the request comes from a browser (Accept includes text/html). */
export const isBrowserRequest = (req: Request): boolean => {
	const accept = req.headers.accept ?? '';
	return accept.includes('text/html');
};
