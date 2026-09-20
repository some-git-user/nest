import {defineConfig, devices} from '@playwright/test';
import {API_KEY, UI_TEST_BASE_URL} from './workspace.mjs';

/**
 * Playwright configuration for the Nest UI suite.
 *
 * The server is started by `global-setup.ts`, not by Playwright's `webServer`
 * option, because the fixture workspace (plugin dir, whitelist, TLS material)
 * is created at runtime and `webServer.env` is resolved when this file is
 * loaded. The port is fixed so `baseURL` can be a constant.
 *
 * Chromium only: the client scripts are plain DOM with no engine-specific
 * behaviour, so WebKit and Firefox would triple the browser download for no
 * additional signal.
 */
export default defineConfig({
	testDir: '.',
	testMatch: '**/*.spec.mts',
	timeout: 30_000,
	expect: {timeout: 5_000},

	// The suite shares one server, and the admin editor mutates a single config
	// file on disk. Parallel workers would fight over that file, so the suite
	// runs serially. Fully parallelised specs need per-worker config files.
	workers: 1,
	fullyParallel: false,

	globalSetup: './global-setup.mts',
	globalTeardown: './global-teardown.mts',

	use: {
		baseURL: UI_TEST_BASE_URL,
		// The suite sets API_KEY so the access-control path is exercised rather
		// than skipped. Nest accepts the key as an HTTP Basic *password*
		// (parseBasicAuthPassword), which is exactly how a browser authenticates
		// after the credentials dialog, so Playwright supplies it the same way
		// and no test has to handle a modal. The username is ignored.
		httpCredentials: {
			username: 'nest',
			password: API_KEY,
		},
		// The certificate is generated per run and self-signed.
		ignoreHTTPSErrors: true,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off',
	},

	projects: [
		{
			name: 'chromium',
			use: {...devices['Desktop Chrome']},
		},
	],

	outputDir: '../../test-results/ui',
	reporter: [
		['list'],
		[
			'html',
			{outputFolder: '../../test-results/playwright-report', open: 'never'},
		],
	],
});
