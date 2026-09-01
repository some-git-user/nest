import {NextFunction, Request, Response} from 'express';
import {
	apiKeyMatches,
	isBrowserRequest,
	parseBasicAuthPassword,
} from './browser-auth';
import {recordHoneypotSignal} from './honey-pot';
import {sendNagiosUnknownError} from './http-nagios';
import {HttpStatusCodes} from './http-status-codes';
import {getClientIpFromRequest, normalizeIp} from './request-ip';
import {recordStartupWarnings} from './startup-warning-registry';

export type AccessControlConfig = {
	apiKey?: string;
	apiKeyHeader?: string;
	allowedIps?: string;
};

export type RecommendedSecurityConfig = {
	NODE_ENV?: string;
	API_KEY?: string;
	ADMIN_UI_PASSWORD?: string;
	ALLOWED_IPS?: string;
	RATE_LIMIT_WINDOW_MS?: number;
	RATE_LIMIT_MAX?: number;
};

const DEFAULT_ALLOWED_IPS = '127.0.0.1,::1';

const parseAllowedIps = (
	value: string | undefined,
): {ips: Set<string>; hasWildcard: boolean; error?: string} => {
	if (!value) {
		return {ips: new Set<string>(), hasWildcard: false};
	}

	const parts = value.split(',').map((part) => part.trim());
	const ips = new Set<string>();
	let hasWildcard = false;

	for (const part of parts) {
		if (part.length === 0) {
			continue;
		}

		if (part === '*') {
			hasWildcard = true;
		} else {
			ips.add(normalizeIp(part));
		}
	}

	// Error if both wildcard and specific IPs are provided
	if (hasWildcard && ips.size > 0) {
		return {
			ips,
			hasWildcard: true,
			error:
				'Invalid ALLOWED_IPS configuration: cannot specify both wildcard (*) and specific IP addresses',
		};
	}

	return {ips, hasWildcard};
};

const getAllowedIpsOrDefault = (
	value: string | undefined,
): {ips: Set<string>; hasWildcard: boolean; error?: string} => {
	const parsed = parseAllowedIps(value);

	if (parsed.ips.size > 0 || parsed.hasWildcard) {
		return parsed;
	}

	return parseAllowedIps(DEFAULT_ALLOWED_IPS);
};

export const getRecommendedSecurityWarnings = (
	config: RecommendedSecurityConfig,
): string[] => {
	const warnings: string[] = [];

	if (String(config.API_KEY ?? '').trim().length === 0) {
		warnings.push(
			'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
		);
	}

	if (String(config.ADMIN_UI_PASSWORD ?? '').trim().length === 0) {
		warnings.push(
			'Security recommendation: ADMIN_UI_PASSWORD is not configured; the admin UI is mounted but no credential can grant access to it.',
		);
	}

	const allowedIpsResult = parseAllowedIps(config.ALLOWED_IPS);
	if (allowedIpsResult.error) {
		warnings.push(allowedIpsResult.error);
	} else if (!allowedIpsResult.hasWildcard && allowedIpsResult.ips.size === 0) {
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
	const allowedIpsResult = getAllowedIpsOrDefault(config.allowedIps);
	const allowedIps = allowedIpsResult.ips;
	const hasWildcard = allowedIpsResult.hasWildcard;
	const hasConfigError = allowedIpsResult.error !== undefined;

	return (req: Request, res: Response, next: NextFunction): void | Response => {
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
				// Record failed API key attempt as honeypot signal
				recordHoneypotSignal(req, 'honeypot-route');

				if (isBrowserRequest(req)) {
					// Trigger the browser's built-in credentials dialog
					res.setHeader(
						'WWW-Authenticate',
						'Basic realm="Nest", charset="UTF-8"',
					);
				}
				return sendNagiosUnknownError(
					res,
					HttpStatusCodes.UNAUTHORIZED,
					'Unauthorized: invalid API key',
				);
			}
		}

		const requesterIp = getClientIpFromRequest(req);
		if (hasConfigError) {
			return sendNagiosUnknownError(
				res,
				HttpStatusCodes.FORBIDDEN,
				`Forbidden: invalid ALLOWED_IPS configuration`,
			);
		}
		if (!hasWildcard && !allowedIps.has(requesterIp)) {
			return sendNagiosUnknownError(
				res,
				HttpStatusCodes.FORBIDDEN,
				`Forbidden: IP ${requesterIp} is not allowed`,
			);
		}

		next();
	};
};
