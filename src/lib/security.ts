import {NextFunction, Request, Response} from 'express';
import {NagiosReturnValuesEnum} from '../types/nagios';
import {createNagiosReturnMessage} from './nagios';

export type AccessControlConfig = {
	apiKey?: string;
	apiKeyHeader?: string;
	allowedIps?: string;
};

const normalizeIp = (value: string): string => {
	const trimmed = value.trim();
	if (trimmed.startsWith('::ffff:')) {
		return trimmed.slice('::ffff:'.length);
	}
	return trimmed;
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

const getRequesterIp = (req: Request): string => {
	const forwardedFor = req.headers['x-forwarded-for'];
	if (typeof forwardedFor === 'string') {
		const [first] = forwardedFor.split(',');
		if (first && first.trim()) {
			return normalizeIp(first);
		}
	}

	if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
		const first = forwardedFor[0];
		if (first && first.trim()) {
			return normalizeIp(first);
		}
	}

	const requestIp = req.ip || req.socket.remoteAddress || 'unknown';
	return normalizeIp(requestIp);
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
				return res
					.status(401)
					.send(
						createNagiosReturnMessage(
							'Unauthorized: invalid API key',
							NagiosReturnValuesEnum.UNKNOWN,
						),
					);
			}
		}

		if (allowedIps.size > 0) {
			const requesterIp = getRequesterIp(req);
			if (!allowedIps.has(requesterIp)) {
				return res
					.status(403)
					.send(
						createNagiosReturnMessage(
							`Forbidden: IP ${requesterIp} is not allowed`,
							NagiosReturnValuesEnum.UNKNOWN,
						),
					);
			}
		}

		next();
	};
};
