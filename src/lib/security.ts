import {NextFunction, Request, Response} from 'express';
import {sendNagiosUnknownError} from './http-nagios';
import {getClientIpFromRequest, normalizeIp} from './request-ip';

export type AccessControlConfig = {
	apiKey?: string;
	apiKeyHeader?: string;
	allowedIps?: string;
};

export type RecommendedSecurityConfig = {
	NODE_ENV?: string;
	ENABLE_SECURITY_MIDDLEWARE?: boolean;
	API_KEY?: string;
	ALLOWED_IPS?: string;
	RATE_LIMIT_WINDOW_MS?: number;
	RATE_LIMIT_MAX?: number;
};

const parseAllowedIps = (value: string | undefined): Set<string> => {
	if (!value) {
		return new Set<string>();
	}

	return new Set(
		value
			.split(',')
			.map((part) => normalizeIp(part))
			.filter((part) => part.length > 0),
	);
};

const isDefaultLoopbackAllowlist = (value: string | undefined): boolean => {
	const allowedIps = parseAllowedIps(value);

	return (
		allowedIps.size === 2 &&
		allowedIps.has('127.0.0.1') &&
		allowedIps.has('::1')
	);
};

export const getRecommendedSecurityWarnings = (
	config: RecommendedSecurityConfig,
): string[] => {
	const warnings: string[] = [];

	if (!config.ENABLE_SECURITY_MIDDLEWARE) {
		warnings.push(
			'Security recommendation: ENABLE_SECURITY_MIDDLEWARE is disabled.',
		);
		return warnings;
	}

	if (String(config.API_KEY ?? '').trim().length === 0) {
		warnings.push(
			'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
		);
	}

	const allowedIpsValue = String(config.ALLOWED_IPS ?? '').trim();
	if (allowedIpsValue.length === 0) {
		warnings.push(
			'Security recommendation: ALLOWED_IPS is empty; requests are not restricted to trusted source IPs.',
		);
	} else if (isDefaultLoopbackAllowlist(config.ALLOWED_IPS)) {
		warnings.push(
			'Security recommendation: ALLOWED_IPS is limited to loopback addresses (127.0.0.1, ::1); configure trusted monitoring source IPs if remote access is required.',
		);
	}

	if (
		(config.RATE_LIMIT_WINDOW_MS ?? 0) <= 0 ||
		(config.RATE_LIMIT_MAX ?? 0) <= 0
	) {
		warnings.push(
			'Security recommendation: rate limiting is effectively disabled because RATE_LIMIT_WINDOW_MS or RATE_LIMIT_MAX is not set to a positive value.',
		);
	}

	return warnings;
};

export const createAccessControlMiddleware = (config: AccessControlConfig) => {
	const expectedApiKey = String(config.apiKey ?? '').trim();
	const apiKeyHeader = String(config.apiKeyHeader ?? 'x-api-key').toLowerCase();
	const allowedIps = parseAllowedIps(config.allowedIps);

	return (req: Request, res: Response, next: NextFunction) => {
		if (expectedApiKey.length > 0) {
			const rawHeader = req.headers[apiKeyHeader];
			const providedApiKey = Array.isArray(rawHeader)
				? String(rawHeader[0] ?? '')
				: String(rawHeader ?? '');

			if (providedApiKey !== expectedApiKey) {
				return sendNagiosUnknownError(
					res,
					401,
					'Unauthorized: invalid API key',
				);
			}
		}

		if (allowedIps.size > 0) {
			const requesterIp = getClientIpFromRequest(req);
			if (!allowedIps.has(requesterIp)) {
				return sendNagiosUnknownError(
					res,
					403,
					`Forbidden: IP ${requesterIp} is not allowed`,
				);
			}
		}

		next();
	};
};
