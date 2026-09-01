import {createHmac, randomBytes, timingSafeEqual} from 'crypto';
import {Request} from 'express';
import {env} from '../config/env';

/**
 * Session cookie issued by the admin login form.
 *
 * The admin UI cannot reuse HTTP Basic Auth for its own credential: browsers
 * cache Basic Auth credentials per origin and realm, so an `ADMIN_UI_PASSWORD`
 * dialog would either clash with the existing `API_KEY` dialog or be suppressed
 * by credentials the browser already holds. A short-lived signed cookie avoids
 * that entirely.
 */
export const ADMIN_SESSION_COOKIE_NAME = 'admin_session';

/**
 * Header carrying the admin password for non-browser callers.
 */
export const ADMIN_PASSWORD_HEADER = 'x-nest-admin-password';

/**
 * Path prefix the admin UI is mounted at.
 *
 * The session cookie is scoped to this prefix so it is never sent to any other
 * route on this origin, which is why the constant lives here.
 */
export const ADMIN_UI_MOUNT_PATH = '/admin';

/**
 * The secret used to sign admin session cookies.
 *
 * A random secret is generated once per process and held in memory only. There
 * is deliberately no configuration for this: a persistent key would have to be
 * distributed and rotated by every installation, and a shared/hardcoded key
 * would let anyone forge sessions. Signing with an ephemeral key means every
 * issued session is invalidated as soon as the service restarts, which is the
 * safe default for a short-lived admin cookie.
 */
let sessionSecret: string | undefined;

export const getAdminSessionSecret = (): string => {
	if (!sessionSecret) {
		sessionSecret = randomBytes(32).toString('hex');
	}

	return sessionSecret;
};

/**
 * Reset the cached session secret (for testing purposes).
 */
export const resetAdminSessionSecretCache = (): void => {
	sessionSecret = undefined;
};

const sign = (payload: string): string =>
	createHmac('sha256', getAdminSessionSecret()).update(payload).digest('hex');

/**
 * Build a session cookie value: `<expiresAtUnixSeconds>.<hmac>`.
 */
export const createAdminSessionCookieValue = (
	ttlSeconds: number = env.ADMIN_SESSION_TTL_SECONDS,
): string => {
	const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
	const payload = String(expiresAt);
	return `${payload}.${sign(payload)}`;
};

const toBuffer = (value: string): Buffer => Buffer.from(value, 'utf8');

const safeEqual = (a: string, b: string): boolean => {
	const bufA = toBuffer(a);
	const bufB = toBuffer(b);
	if (bufA.byteLength !== bufB.byteLength) {
		return false;
	}
	return timingSafeEqual(bufA, bufB);
};

/**
 * Verify a session cookie value: signature must match and expiry must be future.
 *
 * @returns true only for a well-formed, correctly signed, unexpired value.
 */
export const isAdminSessionCookieValid = (value: string): boolean => {
	const dotIndex = value.lastIndexOf('.');
	if (dotIndex <= 0 || dotIndex === value.length - 1) {
		return false;
	}

	const payload = value.slice(0, dotIndex);
	const signature = value.slice(dotIndex + 1);
	if (!/^\d+$/.test(payload)) {
		return false;
	}
	if (!safeEqual(signature, sign(payload))) {
		return false;
	}

	const expiresAt = Number(payload);
	// A value this large overflows a sane timestamp and would be treated as
	// "never expires", so reject it.
	if (!Number.isSafeInteger(expiresAt)) {
		return false;
	}

	return expiresAt > Math.floor(Date.now() / 1000);
};

/**
 * Read a single cookie out of a request's Cookie header.
 */
export const readCookie = (req: Request, name: string): string | undefined => {
	const header = req.headers.cookie;
	if (!header) {
		return undefined;
	}

	for (const part of header.split(';')) {
		const eqIndex = part.indexOf('=');
		if (eqIndex === -1) {
			continue;
		}
		if (part.slice(0, eqIndex).trim() !== name) {
			continue;
		}
		const raw = part.slice(eqIndex + 1).trim();
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}

	return undefined;
};

/**
 * True when the request carries a valid admin session cookie.
 */
export const hasValidAdminSession = (req: Request): boolean => {
	const cookie = readCookie(req, ADMIN_SESSION_COOKIE_NAME);
	if (!cookie) {
		return false;
	}
	return isAdminSessionCookieValid(cookie);
};

/**
 * Compare a candidate admin credential against the configured one.
 *
 * Exposed separately from `hasValidAdminPassword()` because the login form reads
 * the credential out of a request body rather than a header, and both paths must
 * use the same comparison.
 *
 * @returns false when no admin password is configured at all, so an unset
 * credential can never match anything.
 */
export const adminPasswordMatches = (provided: string): boolean => {
	if (env.ADMIN_UI_PASSWORD.length === 0 || provided.length === 0) {
		return false;
	}
	return safeEqual(provided, env.ADMIN_UI_PASSWORD);
};

/**
 * True when the request presents the admin credential in the configured header.
 *
 * This is the non-browser path, so a script can call the admin API without a
 * cookie handshake. It is deliberately a dedicated header rather than the
 * general API key header: holding the monitoring API key must not be enough to
 * rewrite the config file.
 */
export const hasValidAdminPassword = (req: Request): boolean => {
	const raw = req.headers[ADMIN_PASSWORD_HEADER];
	const provided = Array.isArray(raw)
		? String(raw[0] ?? '')
		: String(raw ?? '');
	return adminPasswordMatches(provided);
};

/**
 * Render the `Set-Cookie` value for a freshly issued admin session.
 *
 * `Path=/admin` keeps the credential out of every other route on this origin,
 * and `SameSite=Strict` means the browser never attaches it to a cross-site
 * request, which removes the CSRF surface a cookie would otherwise add.
 */
export const buildAdminSessionCookie = (cookieValue: string): string =>
	[
		`${ADMIN_SESSION_COOKIE_NAME}=${cookieValue}`,
		`Path=${ADMIN_UI_MOUNT_PATH}`,
		'HttpOnly',
		'SameSite=Strict',
		'Secure',
		`Max-Age=${Math.max(0, env.ADMIN_SESSION_TTL_SECONDS)}`,
	].join('; ');

/**
 * Render a `Set-Cookie` value that clears the admin session cookie.
 */
export const buildAdminSessionClearCookie = (): string =>
	`${ADMIN_SESSION_COOKIE_NAME}=; Path=${ADMIN_UI_MOUNT_PATH}; HttpOnly; SameSite=Strict; Secure; Max-Age=0`;
