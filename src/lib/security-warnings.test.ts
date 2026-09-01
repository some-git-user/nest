import {getRecommendedSecurityWarnings} from './security';

describe('getRecommendedSecurityWarnings', () => {
	test('warns when api key is missing in production', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: '',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '127.0.0.1, ::1',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([
			'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
		]);
	});

	test('warns when the admin UI password is missing in production', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: '',
				ALLOWED_IPS: '127.0.0.1, ::1',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([
			'Security recommendation: ADMIN_UI_PASSWORD is not configured; the admin UI is mounted but no credential can grant access to it.',
		]);
	});

	test('does not warn when allowed IPs are explicitly emptied in production', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([
			'Security recommendation: ALLOWED_IPS is not configured; access defaults to loopback addresses only (127.0.0.1, ::1). Add trusted monitoring source IPs for remote access.',
		]);
	});

	test('does not warn when loopback IPs are explicitly configured', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '127.0.0.1, ::1',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([]);
	});

	test('warns when rate limiting is non-positive', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '127.0.0.1,10.0.0.10',
				RATE_LIMIT_WINDOW_MS: 0,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([
			'Security recommendation: rate limiting is effectively disabled because RATE_LIMIT_WINDOW_MS or RATE_LIMIT_MAX is not set to a positive value.',
		]);
	});

	test('warns when rate limit max is non-positive while window is valid', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '127.0.0.1,10.0.0.10',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 0,
			}),
		).toEqual([
			'Security recommendation: rate limiting is effectively disabled because RATE_LIMIT_WINDOW_MS or RATE_LIMIT_MAX is not set to a positive value.',
		]);
	});

	test('warns when rate limit max is undefined while window is valid', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '127.0.0.1,10.0.0.10',
				RATE_LIMIT_WINDOW_MS: 60_000,
			}),
		).toEqual([
			'Security recommendation: rate limiting is effectively disabled because RATE_LIMIT_WINDOW_MS or RATE_LIMIT_MAX is not set to a positive value.',
		]);
	});

	test('returns no warnings when recommended production settings are configured', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '127.0.0.1,10.0.0.10',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([]);
	});

	test('warns when optional security values are undefined in production', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
			}),
		).toEqual([
			'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
			'Security recommendation: ADMIN_UI_PASSWORD is not configured; the admin UI is mounted but no credential can grant access to it.',
			'Security recommendation: ALLOWED_IPS is not configured; access defaults to loopback addresses only (127.0.0.1, ::1). Add trusted monitoring source IPs for remote access.',
			'Security recommendation: rate limiting is effectively disabled because RATE_LIMIT_WINDOW_MS or RATE_LIMIT_MAX is not set to a positive value.',
		]);
	});

	test('warns when ALLOWED_IPS contains wildcard mixed with specific IPs', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '127.0.0.1,*',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([
			'Invalid ALLOWED_IPS configuration: cannot specify both wildcard (*) and specific IP addresses',
		]);
	});

	test('warns when ALLOWED_IPS contains specific IPs mixed with wildcard', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '*,10.0.0.1',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([
			'Invalid ALLOWED_IPS configuration: cannot specify both wildcard (*) and specific IP addresses',
		]);
	});

	test('does not warn when ALLOWED_IPS is only wildcard', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: '*',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([]);
	});

	test('does not warn when ALLOWED_IPS is wildcard with whitespace', () => {
		expect(
			getRecommendedSecurityWarnings({
				NODE_ENV: 'production',
				API_KEY: 'secret',
				ADMIN_UI_PASSWORD: 'admin',
				ALLOWED_IPS: ' * ',
				RATE_LIMIT_WINDOW_MS: 60_000,
				RATE_LIMIT_MAX: 120,
			}),
		).toEqual([]);
	});
});
