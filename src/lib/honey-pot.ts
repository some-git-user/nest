import {Request} from 'express';
import {logger} from './logger';
import {getClientIpFromRequest, normalizeIp} from './request-ip';

export type HoneypotSignalReason =
	| 'unknown-route'
	| 'honeypot-route'
	| 'tls-client-error'
	| 'http-client-error'
	| 'ip-denied'
	| 'rate-limited';

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
	mostActiveIp: string;
	latest?: {
		path: string;
		ip: string;
		reason: HoneypotSignalReason;
	};
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
	// `admin` is a common scanner guess, but `/admin` itself is a legitimate
	// mount path here, so only the well-known scanner variants count.
	/^\/admin\/(?:login|console|manager|index\.php|wp-login\.php)/i,
	/^\/administrator\//i,
];

const signals: HoneypotSignal[] = [];

// Placeholder for a probe whose source address could not be determined. It is
// deliberately kept out of every per-IP aggregate: folding all unattributed
// probes into one bucket would invent an attacker that trips the scan
// thresholds on its own and inflate `unique_ips`.
export const UNKNOWN_IP = 'unknown';

// Reasons that are an attack indicator regardless of which path was requested.
// `unknown-route` is the only reason that needs a path signature to count.
const alwaysSuspiciousReasons: HoneypotSignalReason[] = [
	'honeypot-route',
	'tls-client-error',
	'http-client-error',
	'ip-denied',
	'rate-limited',
];

/**
 * Shape of the sockets Node hands to `connection`, `clientError` and
 * `tlsClientError`. `remoteAddress` is the only public member; `_parent` is read
 * to recover the address of an already destroyed socket, see `resolveSocketIp`.
 */
type SocketLike = {
	remoteAddress?: unknown;
	_parent?: SocketLike | null;
	__nestRemoteIp?: unknown;
};

// `clientError` and `tlsClientError` both fire for the same failed connection,
// so without this a single probe would be recorded - and alerted on - twice.
const countedSockets = new WeakSet<object>();

const hasAddress = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0;

/**
 * Remember the peer address while it is still guaranteed to be readable.
 *
 * Node fires `connection` for the raw socket *before* the TLS handshake. When a
 * probe fails immediately - the `nmap -sT` pattern of connect-then-close - the
 * socket handed to `clientError`/`tlsClientError` is a *different*, already
 * destroyed `TLSSocket` whose own `remoteAddress` is `undefined`. Stashing the
 * address here is what makes those probes attributable.
 */
export const stashSocketIp = (socket: unknown): void => {
	if (typeof socket !== 'object' || socket === null) {
		return;
	}

	const candidate = socket as SocketLike;
	if (hasAddress(candidate.remoteAddress)) {
		candidate.__nestRemoteIp = candidate.remoteAddress;
	}
};

/**
 * Best-effort peer address for a socket that may already be destroyed.
 *
 * Tries the socket's own address, then the address stashed by
 * {@link stashSocketIp}, then the raw socket Node keeps as `_parent` of a failed
 * `TLSSocket` - which still carries the address after the wrapper lost it.
 */
export const resolveSocketIp = (socket: unknown): string => {
	let current: SocketLike | null | undefined =
		typeof socket === 'object' && socket !== null
			? (socket as SocketLike)
			: undefined;
	const seen = new Set<object>();

	while (current !== null && current !== undefined && !seen.has(current)) {
		seen.add(current);

		if (hasAddress(current.__nestRemoteIp)) {
			return normalizeIp(current.__nestRemoteIp);
		}
		if (hasAddress(current.remoteAddress)) {
			return normalizeIp(current.remoteAddress);
		}
		current = current._parent;
	}

	return UNKNOWN_IP;
};

const normalizePath = (url: string): string => {
	const [pathOnly] = url.split('?');
	return pathOnly || '/';
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

const pushSignal = (signal: HoneypotSignal): void => {
	signals.push(signal);
	pruneSignals(signal.timestamp);

	// Persist every probe. The in-memory window is only five minutes, so without
	// this the evidence of an attack disappears before a slower monitoring
	// interval - or a service restart - ever gets a chance to report it.
	logger.warn(
		`Honeypot signal: reason=${signal.reason} ip=${signal.ip} path=${signal.path} suspicious=${signal.suspicious} user_agent=${signal.userAgent}`,
	);
};

export const recordHoneypotSignal = (
	req: Request,
	reason: HoneypotSignalReason,
): void => {
	const path = normalizePath(req.originalUrl || req.url || '/');

	pushSignal({
		timestamp: Date.now(),
		path,
		ip: getClientIpFromRequest(req),
		userAgent: String(req.headers['user-agent'] ?? 'unknown'),
		reason,
		suspicious:
			alwaysSuspiciousReasons.includes(reason) || isSuspiciousPath(path),
	});
};

/**
 * Record a probe that never produced a valid HTTP request.
 *
 * Returns `false` when the socket was already counted, because Node raises both
 * `clientError` and `tlsClientError` for one failed connection.
 */
export const recordNetworkProbeSignal = (
	socket: unknown,
	reason: Extract<
		HoneypotSignalReason,
		'tls-client-error' | 'http-client-error'
	>,
): boolean => {
	if (typeof socket === 'object' && socket !== null) {
		if (countedSockets.has(socket)) {
			return false;
		}
		countedSockets.add(socket);
	}

	pushSignal({
		timestamp: Date.now(),
		path: '/_network_probe',
		ip: resolveSocketIp(socket),
		userAgent: 'network-probe',
		reason,
		suspicious: true,
	});

	return true;
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
		// Probes whose address could not be resolved stay in the totals above but
		// are never attributed to an IP here, so they cannot fabricate a scanner.
		if (signal.ip === UNKNOWN_IP) {
			continue;
		}

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
		uniqueIps: pathsByIp.size,
		uniquePaths: new Set(signals.map((signal) => signal.path)).size,
		probableScanIps,
		probablePortScanIps,
		maxUniquePathsFromSingleIp,
		mostActiveIp: mostActiveIp ?? 'unknown',
		latest: latestSignal
			? {
					path: latestSignal.path,
					ip: latestSignal.ip,
					reason: latestSignal.reason,
				}
			: undefined,
	};
};

export const resetHoneypotSignals = (): void => {
	signals.splice(0, signals.length);
};
