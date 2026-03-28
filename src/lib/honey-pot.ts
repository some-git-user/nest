import {Request} from 'express';

export type HoneypotSignalReason =
	| 'unknown-route'
	| 'honeypot-route'
	| 'tls-client-error'
	| 'http-client-error';

type HoneypotSignal = {
	timestamp: number;
	path: string;
	ip: string;
	userAgent: string;
	reason: HoneypotSignalReason;
	suspicious: boolean;
};

type HoneypotStats = {
	totalHits: number;
	suspiciousHits: number;
	protocolErrorHits: number;
	uniqueIps: number;
	uniquePaths: number;
	probableScanIps: number;
	probablePortScanIps: number;
	maxUniquePathsFromSingleIp: number;
	mostActiveIp?: string;
	latestPath?: string;
	latestIp?: string;
	latestReason?: HoneypotSignalReason;
};

const SIGNAL_WINDOW_MS = 5 * 60 * 1000;
const MAX_SIGNALS = 1000;
const PROBABLE_SCAN_UNIQUE_PATHS_PER_IP = 6;
const PROBABLE_PORT_SCAN_PROTOCOL_ERRORS_PER_IP = 3;

const suspiciousPathPatterns: RegExp[] = [
	/^\/\.env/i,
	/^\/\.git/i,
	/^\/wp-admin/i,
	/^\/wp-login\.php/i,
	/^\/phpmyadmin/i,
	/^\/cgi-bin/i,
	/^\/boaform/i,
	/^\/manager\/html/i,
	/^\/HNAP1/i,
	/^\/admin/i,
];

const signals: HoneypotSignal[] = [];

const normalizePath = (url: string): string => {
	const [pathOnly] = url.split('?');
	return pathOnly || '/';
};

const getClientIp = (req: Request): string => {
	const forwardedFor = req.headers['x-forwarded-for'];
	if (typeof forwardedFor === 'string') {
		const [first] = forwardedFor.split(',');
		if (first && first.trim()) {
			return first.trim();
		}
	}

	if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
		return forwardedFor[0];
	}

	return req.ip || req.socket.remoteAddress || 'unknown';
};

const pruneSignals = (now: number): void => {
	while (signals.length > 0 && now - signals[0].timestamp > SIGNAL_WINDOW_MS) {
		signals.shift();
	}
	if (signals.length > MAX_SIGNALS) {
		signals.splice(0, signals.length - MAX_SIGNALS);
	}
};

const isSuspiciousPath = (path: string): boolean =>
	suspiciousPathPatterns.some((pattern) => pattern.test(path));

export const recordHoneypotSignal = (
	req: Request,
	reason: HoneypotSignalReason,
): void => {
	const timestamp = Date.now();
	const path = normalizePath(req.originalUrl || req.url || '/');
	const userAgent = String(req.headers['user-agent'] ?? 'unknown');
	const ip = getClientIp(req);

	signals.push({
		timestamp,
		path,
		ip,
		userAgent,
		reason,
		suspicious:
			reason === 'honeypot-route' ||
			reason === 'tls-client-error' ||
			reason === 'http-client-error' ||
			isSuspiciousPath(path),
	});

	pruneSignals(timestamp);
};

export const recordNetworkProbeSignal = (
	ip: string,
	reason: Extract<
		HoneypotSignalReason,
		'tls-client-error' | 'http-client-error'
	>,
): void => {
	const timestamp = Date.now();
	signals.push({
		timestamp,
		path: '/_network_probe',
		ip: ip || 'unknown',
		userAgent: 'network-probe',
		reason,
		suspicious: true,
	});

	pruneSignals(timestamp);
};

export const getHoneypotStats = (now: number = Date.now()): HoneypotStats => {
	pruneSignals(now);

	const suspiciousHits = signals.filter((signal) => signal.suspicious).length;
	const protocolErrorHits = signals.filter(
		(signal) =>
			signal.reason === 'tls-client-error' ||
			signal.reason === 'http-client-error',
	).length;
	const latestSignal = signals[signals.length - 1];
	const pathsByIp = new Map<string, Set<string>>();
	const protocolErrorsByIp = new Map<string, number>();

	for (const signal of signals) {
		const existingPaths = pathsByIp.get(signal.ip) ?? new Set<string>();
		existingPaths.add(signal.path);
		pathsByIp.set(signal.ip, existingPaths);

		if (
			signal.reason === 'tls-client-error' ||
			signal.reason === 'http-client-error'
		) {
			const existingCount = protocolErrorsByIp.get(signal.ip) ?? 0;
			protocolErrorsByIp.set(signal.ip, existingCount + 1);
		}
	}

	let probableScanIps = 0;
	let probablePortScanIps = 0;
	let maxUniquePathsFromSingleIp = 0;
	let mostActiveIp: string | undefined;
	for (const [ip, ipPaths] of pathsByIp.entries()) {
		if (ipPaths.size >= PROBABLE_SCAN_UNIQUE_PATHS_PER_IP) {
			probableScanIps += 1;
		}

		if (
			(protocolErrorsByIp.get(ip) ?? 0) >=
			PROBABLE_PORT_SCAN_PROTOCOL_ERRORS_PER_IP
		) {
			probablePortScanIps += 1;
		}

		if (ipPaths.size > maxUniquePathsFromSingleIp) {
			maxUniquePathsFromSingleIp = ipPaths.size;
			mostActiveIp = ip;
		}
	}

	return {
		totalHits: signals.length,
		suspiciousHits,
		protocolErrorHits,
		uniqueIps: new Set(signals.map((signal) => signal.ip)).size,
		uniquePaths: new Set(signals.map((signal) => signal.path)).size,
		probableScanIps,
		probablePortScanIps,
		maxUniquePathsFromSingleIp,
		mostActiveIp,
		latestPath: latestSignal?.path,
		latestIp: latestSignal?.ip,
		latestReason: latestSignal?.reason,
	};
};

export const resetHoneypotSignals = (): void => {
	signals.splice(0, signals.length);
};
