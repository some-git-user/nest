import {NextFunction, Request, Response} from 'express';
import {
	apiKeyMatches,
	isBrowserRequest,
	parseBasicAuthPassword,
} from './browser-auth';
import {sendNagiosUnknownError} from './http-nagios';
import {getClientIpFromRequest, normalizeIp} from './request-ip';
import {recordStartupWarnings} from './startup-warning-registry';

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

const DEFAULT_ALLOWED_IPS = '127.0.0.1,::1';

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

const getAllowedIpsOrDefault = (value: string | undefined): Set<string> => {
	const parsedAllowedIps = parseAllowedIps(value);

	if (parsedAllowedIps.size > 0) {
		return parsedAllowedIps;
	}

	return parseAllowedIps(DEFAULT_ALLOWED_IPS);
};

export const getRecommendedSecurityWarnings = (
	config: RecommendedSecurityConfig,
): string[] => {
	const warnings: string[] = [];

	if (!config.ENABLE_SECURITY_MIDDLEWARE) {
		warnings.push(
			'Security recommendation: ENABLE_SECURITY_MIDDLEWARE is disabled.',
		);
		recordStartupWarnings(warnings);
		return warnings;
	}

	if (String(config.API_KEY ?? '').trim().length === 0) {
		warnings.push(
			'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
		);
	}

	if (parseAllowedIps(config.ALLOWED_IPS).size === 0) {
		warnings.push(
			'Security recommendation: ALLOWED_IPS is not configured; access defaults to loopback addresses only (127.0.0.1, ::1). Add trusted monitoring source IPs for remote access.',
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

	recordStartupWarnings(warnings);

	return warnings;
};

export const createAccessControlMiddleware = (config: AccessControlConfig) => {
	const expectedApiKey = String(config.apiKey ?? '').trim();
	const apiKeyHeader = String(config.apiKeyHeader ?? 'x-api-key').toLowerCase();
	const allowedIps = getAllowedIpsOrDefault(config.allowedIps);

	return (req: Request, res: Response, next: NextFunction) => {
		if (expectedApiKey.length > 0) {
			const rawHeader = req.headers[apiKeyHeader];
			const headerKey = Array.isArray(rawHeader)
				? String(rawHeader[0] ?? '')
				: String(rawHeader ?? '');

			// Also accept the key via HTTP Basic Auth (password field) for browser access
			const basicKey = parseBasicAuthPassword(
				String(req.headers.authorization ?? ''),
			);
			const providedApiKey = headerKey || basicKey;

			if (!apiKeyMatches(providedApiKey, expectedApiKey)) {
				if (isBrowserRequest(req)) {
					// Trigger the browser's built-in credentials dialog
					res.setHeader(
						'WWW-Authenticate',
						'Basic realm="Nest", charset="UTF-8"',
					);
				}
				return sendNagiosUnknownError(
					res,
					401,
					'Unauthorized: invalid API key',
				);
			}
		}

		const requesterIp = getClientIpFromRequest(req);
		if (!allowedIps.has(requesterIp)) {
			return sendNagiosUnknownError(
				res,
				403,
				`Forbidden: IP ${requesterIp} is not allowed`,
			);
		}

		next();
	};
};
