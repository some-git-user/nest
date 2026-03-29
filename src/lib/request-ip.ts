import {Request} from 'express';

export const normalizeIp = (value: string): string => {
	const trimmed = value.trim();
	if (trimmed.startsWith('::ffff:')) {
		return trimmed.slice('::ffff:'.length);
	}
	return trimmed;
};

export const getClientIpFromRequest = (req: Request): string => {
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
