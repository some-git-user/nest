import {createHmac} from 'crypto';
import {Request} from 'express';
import {env} from '../config/env';
import {
	ADMIN_PASSWORD_HEADER,
	ADMIN_SESSION_COOKIE_NAME,
	ADMIN_UI_MOUNT_PATH,
	adminPasswordMatches,
	buildAdminSessionClearCookie,
	buildAdminSessionCookie,
	createAdminSessionCookieValue,
	getAdminSessionSecret,
	hasValidAdminPassword,
	hasValidAdminSession,
	isAdminSessionCookieValid,
	readCookie,
	resetAdminSessionSecretCache,
} from './admin-auth';

jest.mock('../config/env');

const mockedEnv = jest.mocked(env);

const futureCookie = (ttlSeconds = 60): string =>
	createAdminSessionCookieValue(ttlSeconds);

const requestWithHeaders = (headers: Partial<Request['headers']>): Request =>
	({headers}) as Request;

describe('admin-auth', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedEnv.ADMIN_SESSION_TTL_SECONDS = 900;
		mockedEnv.ADMIN_UI_PASSWORD = 'super-secret-admin-key';
		resetAdminSessionSecretCache();
	});

	describe('constants', () => {
		it('exposes the cookie name, header and mount path', () => {
			expect(ADMIN_SESSION_COOKIE_NAME).toBe('admin_session');
			expect(ADMIN_PASSWORD_HEADER).toBe('x-nest-admin-password');
			expect(ADMIN_UI_MOUNT_PATH).toBe('/admin');
		});
	});

	describe('getAdminSessionSecret', () => {
		it('generates a random hex secret', () => {
			expect(getAdminSessionSecret()).toMatch(/^[0-9a-f]{64}$/);
		});

		it('caches the secret across calls within the process', () => {
			const first = getAdminSessionSecret();
			const second = getAdminSessionSecret();

			expect(second).toBe(first);
		});

		it('generates a fresh secret after the cache is reset', () => {
			const first = getAdminSessionSecret();
			resetAdminSessionSecretCache();
			const second = getAdminSessionSecret();

			expect(second).not.toBe(first);
		});
	});

	describe('createAdminSessionCookieValue / isAdminSessionCookieValid', () => {
		it('round-trips a freshly created cookie', () => {
			expect(isAdminSessionCookieValid(futureCookie())).toBe(true);
		});

		it('uses the configured TTL when none is passed', () => {
			mockedEnv.ADMIN_SESSION_TTL_SECONDS = 3600;
			const cookie = createAdminSessionCookieValue();
			const [payload] = cookie.split('.');
			const nowSeconds = Math.floor(Date.now() / 1000);
			expect(Number(payload)).toBeGreaterThanOrEqual(nowSeconds + 3599);
			expect(isAdminSessionCookieValid(cookie)).toBe(true);
		});

		it('rejects a tampered signature', () => {
			const cookie = futureCookie();
			const [payload] = cookie.split('.');
			expect(isAdminSessionCookieValid(`${payload}.deadbeef`)).toBe(false);
		});

		it('rejects an expired cookie', () => {
			expect(isAdminSessionCookieValid(futureCookie(-10))).toBe(false);
		});

		it('rejects a value with no dot', () => {
			expect(isAdminSessionCookieValid('nodothere')).toBe(false);
		});

		it('rejects a value starting with a dot', () => {
			expect(isAdminSessionCookieValid('.signature')).toBe(false);
		});

		it('rejects a value ending with a dot', () => {
			expect(isAdminSessionCookieValid('1234567890.')).toBe(false);
		});

		it('rejects a non-numeric payload', () => {
			expect(isAdminSessionCookieValid('abc.deadbeef')).toBe(false);
		});

		it('rejects an unsafe integer expiry', () => {
			const payload = String(Number.MAX_SAFE_INTEGER + 10);
			// Sign it ourselves so only the safe-integer check can reject it.
			const secret = getAdminSessionSecret();
			const signature = createHmac('sha256', secret)
				.update(payload)
				.digest('hex');
			expect(isAdminSessionCookieValid(`${payload}.${signature}`)).toBe(false);
		});
	});

	describe('readCookie', () => {
		it('returns undefined when no Cookie header is present', () => {
			expect(readCookie(requestWithHeaders({}), 'foo')).toBeUndefined();
		});

		it('reads a matching cookie', () => {
			const req = requestWithHeaders({cookie: 'foo=bar; baz=qux'});
			expect(readCookie(req, 'baz')).toBe('qux');
		});

		it('skips parts without =', () => {
			const req = requestWithHeaders({cookie: 'novalue; foo=bar'});
			expect(readCookie(req, 'foo')).toBe('bar');
		});

		it('returns undefined when the cookie is absent', () => {
			const req = requestWithHeaders({cookie: 'foo=bar'});
			expect(readCookie(req, 'missing')).toBeUndefined();
		});

		it('decodes percent-encoded values', () => {
			const req = requestWithHeaders({cookie: 'foo=a%20b'});
			expect(readCookie(req, 'foo')).toBe('a b');
		});

		it('returns the raw value when decoding fails', () => {
			const req = requestWithHeaders({cookie: 'foo=%E0%A4%A'});
			expect(readCookie(req, 'foo')).toBe('%E0%A4%A');
		});
	});

	describe('hasValidAdminSession', () => {
		it('returns false when the cookie is absent', () => {
			expect(hasValidAdminSession(requestWithHeaders({}))).toBe(false);
		});

		it('returns false for an invalid cookie value', () => {
			const req = requestWithHeaders({
				cookie: `${ADMIN_SESSION_COOKIE_NAME}=garbage`,
			});
			expect(hasValidAdminSession(req)).toBe(false);
		});

		it('returns true for a valid cookie value', () => {
			const req = requestWithHeaders({
				cookie: `${ADMIN_SESSION_COOKIE_NAME}=${futureCookie()}`,
			});
			expect(hasValidAdminSession(req)).toBe(true);
		});
	});

	describe('adminPasswordMatches', () => {
		it('returns false when no admin password is configured', () => {
			mockedEnv.ADMIN_UI_PASSWORD = '';
			expect(adminPasswordMatches('anything')).toBe(false);
		});

		it('returns false when nothing is provided', () => {
			expect(adminPasswordMatches('')).toBe(false);
		});

		it('returns true for a matching password', () => {
			expect(adminPasswordMatches('super-secret-admin-key')).toBe(true);
		});

		it('returns false for a mismatching password', () => {
			expect(adminPasswordMatches('wrong')).toBe(false);
		});
	});

	describe('hasValidAdminPassword', () => {
		it('returns true when the header matches', () => {
			const req = requestWithHeaders({
				[ADMIN_PASSWORD_HEADER]: 'super-secret-admin-key',
			});
			expect(hasValidAdminPassword(req)).toBe(true);
		});

		it('uses the first value when the header is an array', () => {
			const req = requestWithHeaders({
				[ADMIN_PASSWORD_HEADER]: ['super-secret-admin-key', 'other'],
			});
			expect(hasValidAdminPassword(req)).toBe(true);
		});

		it('returns false when the header is missing', () => {
			expect(hasValidAdminPassword(requestWithHeaders({}))).toBe(false);
		});

		it('returns false when the header array is empty', () => {
			const req = requestWithHeaders({[ADMIN_PASSWORD_HEADER]: []});
			expect(hasValidAdminPassword(req)).toBe(false);
		});
	});

	describe('buildAdminSessionCookie', () => {
		it('renders a scoped cookie with the configured TTL', () => {
			const cookie = buildAdminSessionCookie('payload.signature');
			expect(cookie).toBe(
				'admin_session=payload.signature; Path=/admin; HttpOnly; SameSite=Strict; Secure; Max-Age=900',
			);
		});

		it('clamps a negative TTL to zero', () => {
			mockedEnv.ADMIN_SESSION_TTL_SECONDS = -5;
			const cookie = buildAdminSessionCookie('x.y');
			expect(cookie).toContain('Max-Age=0');
		});
	});

	describe('buildAdminSessionClearCookie', () => {
		it('renders a clearing cookie', () => {
			expect(buildAdminSessionClearCookie()).toBe(
				'admin_session=; Path=/admin; HttpOnly; SameSite=Strict; Secure; Max-Age=0',
			);
		});
	});
});
