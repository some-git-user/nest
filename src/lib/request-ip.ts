import {Request} from 'express';

// Value accepted by Express's `app.set('trust proxy', ...)`. `false` disables
// `X-Forwarded-For` handling entirely; a number trusts that many proxy hops;
// a string is interpreted by Express as a single IP/CIDR/subnet entry.
export type TrustProxySetting = boolean | number | string;

// Turn the TRUST_PROXY env string into an Express trust-proxy value. Anything
// that is not an explicit truthy/numeric/CIDR value disables the feature, so a
// missing or malformed setting fails closed (header ignored).
export const parseTrustProxy = (
	value: string | undefined,
): TrustProxySetting => {
	const trimmed = (value ?? '').trim();
	if (trimmed.length === 0 || trimmed.toLowerCase() === 'false') {
		return false;
	}
	if (trimmed.toLowerCase() === 'true') {
		return true;
	}
	if (/^\d+$/.test(trimmed)) {
		return Number(trimmed);
	}
	return trimmed;
};

export const normalizeIp = (value: string): string => {
	const trimmed = value.trim();
	if (trimmed.startsWith('::ffff:')) {
		return trimmed.slice('::ffff:'.length);
	}
	return trimmed;
};

// The client IP is taken from Express's own `req.ip`, which only reflects the
// `X-Forwarded-For` header when the app has explicitly opted in via
// `app.set('trust proxy', ...)`. Reading the header directly here would let any
// caller spoof their apparent source address and bypass the ALLOWED_IPS
// allowlist, so we deliberately never parse it in this module.
export const getClientIpFromRequest = (req: Request): string => {
	const requestIp = req.ip || req.socket.remoteAddress || 'unknown';
	return normalizeIp(requestIp);
};
