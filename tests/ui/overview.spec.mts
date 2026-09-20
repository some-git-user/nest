import {expect, test} from '@playwright/test';
import {API_KEY, UI_TEST_BASE_URL} from './workspace.mts';

/**
 * Smoke test for the UI harness itself.
 *
 * Written first on purpose: it exercises the entire chain — scratch workspace,
 * generated whitelist, spawned server, TLS, browser, baseURL — so any
 * plumbing mistake surfaces here rather than inside a feature spec.
 */
test.describe('route overview', () => {
	test('serves the page with the app version', async ({page}) => {
		const response = await page.goto('/');
		expect(response?.status()).toBe(200);
		expect(response?.headers()['content-type']).toContain('text/html');

		await expect(page).toHaveTitle('Nest Route Overview');

		// The meta strip is a .page-meta div of <span>label <code>value</code></span>
		// items rendered by renderMetaList().
		const meta = page.locator('.page-meta');
		await expect(meta).toContainText('Version');
		await expect(meta.locator('code').first()).toHaveText(/\d+\.\d+\.\d+/);
	});

	test('lists the built-in routes', async ({page}) => {
		await page.goto('/');

		const builtIn = page.locator('.route-section', {
			hasText: 'Built-in Routes',
		});
		await expect(
			builtIn.locator('.route-path:text-is("/nagios")'),
		).toBeVisible();
		await expect(
			builtIn.locator('.route-path:text-is("/nagios/honey-pot")'),
		).toBeVisible();
		await expect(
			builtIn.locator('.route-path:text-is("/admin")'),
		).toBeVisible();
	});

	/**
	 * Proves the fixture whitelist worked. A plugin whose hash does not match is
	 * skipped silently — no route, no error — so without this assertion a
	 * whitelist mistake would look like a missing feature rather than a broken
	 * test setup.
	 */
	test('lists every whitelisted fixture plugin as a route', async ({page}) => {
		await page.goto('/');

		const pluginSection = page.locator('.route-section', {
			hasText: 'Plugin Routes',
		});
		await expect(pluginSection).toBeVisible();

		for (const route of [
			'/plugins/check-ui-echo',
			'/plugins/check-ui-minimal',
			'/plugins/check-ui-secret',
		]) {
			await expect(
				pluginSection.locator(`.route-path:text-is("${route}")`),
			).toBeVisible();
		}

		await expect(pluginSection).not.toContainText('No plugins found');
	});

	/**
	 * The presets only appear when the copied config file is both whitelisted
	 * and passes the Unix permission check. This is the assertion that catches a
	 * group-writable copy: the section silently disappears rather than erroring.
	 */
	test('shows the local config presets from the seed file', async ({page}) => {
		await page.goto('/');

		const presetSection = page.locator('.route-section', {
			hasText: 'Local Config Presets',
		});
		await expect(presetSection).toBeVisible();
		await expect(presetSection).toContainText('ui_basic');
		await expect(presetSection).toContainText('ui_secret');
		await expect(presetSection).toContainText('ui_undeclared');
	});

	test('serves the client scripts the pages depend on', async ({request}) => {
		for (const script of [
			'/help/plugin-example-form.js',
			'/theme-toggle.js',
			'/admin/local-config.js',
		]) {
			const response = await request.get(script, {
				headers: {'x-api-key': API_KEY},
			});
			expect(response.status(), `${script} status`).toBe(200);
			expect(response.headers()['content-type'], `${script} type`).toContain(
				'javascript',
			);
		}
	});

	/**
	 * The API key is enforced on static assets too, so a missing key must not
	 * quietly succeed. Guards against a future refactor accidentally exempting
	 * the scripts.
	 *
	 * Uses a deliberately wrong key rather than omitting one, so the assertion
	 * cannot be satisfied by credentials inherited from the shared context.
	 */
	test('rejects a request with a wrong API key', async ({playwright}) => {
		const context = await playwright.request.newContext({
			baseURL: UI_TEST_BASE_URL,
			ignoreHTTPSErrors: true,
			extraHTTPHeaders: {'x-api-key': 'definitely-not-the-key'},
		});
		const response = await context.get('/theme-toggle.js');
		expect(response.status()).toBe(401);
		await context.dispose();
	});
});
