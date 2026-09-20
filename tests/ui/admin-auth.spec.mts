import {expect, test} from '@playwright/test';
import {
	ADMIN_PASSWORD,
	API_KEY,
	UI_TEST_SECONDARY_BASE_URL,
	UI_TEST_SECONDARY_PORT,
	type UiTestWorkspace,
	startUiTestServer,
} from './workspace.mts';

/**
 * Admin authentication flows.
 *
 * The browser already carries the API key as HTTP Basic credentials, which
 * satisfies access control but deliberately NOT admin auth — `hasValidAdminPassword`
 * reads the `x-nest-admin-password` header, not `Authorization`. So the login
 * flow below is genuinely exercised rather than short-circuited by the shared
 * credentials.
 */
test.describe('admin authentication', () => {
	test('an unauthenticated visit renders the sign-in form', async ({page}) => {
		const response = await page.goto('/admin');
		expect(response?.status()).toBe(401);

		await expect(page).toHaveTitle('Nest Admin - Sign in');
		await expect(
			page.locator('form.login input[name="adminPassword"]'),
		).toBeVisible();
		await expect(page.getByRole('button', {name: 'Sign in'})).toBeVisible();
	});

	test('a wrong password re-renders the form with an error', async ({page}) => {
		await page.goto('/admin');

		await page
			.locator('form.login input[name="adminPassword"]')
			.fill('wrong-password');
		await page.getByRole('button', {name: 'Sign in'}).click();

		await expect(page).toHaveTitle('Nest Admin - Sign in');
		await expect(page.locator('.status.error')).toBeVisible();
		await expect(page.locator('.status.error')).toContainText(
			'Invalid admin password',
		);

		// The submitted password must never be echoed back into the page.
		const html = await page.content();
		expect(html).not.toContain('wrong-password');
	});

	test('the correct password reaches the editor', async ({page}) => {
		await page.goto('/admin');
		await page
			.locator('form.login input[name="adminPassword"]')
			.fill(ADMIN_PASSWORD);
		await page.getByRole('button', {name: 'Sign in'}).click();

		await expect(page).toHaveURL(/\/admin\/local-config$/);
		await expect(page).toHaveTitle('Local Config Presets');
		await expect(page.locator('#entries')).toBeVisible();
		await expect(page.locator('#saveButton')).toBeVisible();
	});

	test('the session cookie is set with hardening flags', async ({browser}) => {
		const context = await browser.newContext({
			httpCredentials: {username: 'nest', password: API_KEY},
			ignoreHTTPSErrors: true,
		});
		const page = await context.newPage();
		await page.goto('/admin');
		await page
			.locator('form.login input[name="adminPassword"]')
			.fill(ADMIN_PASSWORD);
		await page.getByRole('button', {name: 'Sign in'}).click();
		await expect(page).toHaveURL(/\/admin\/local-config$/);

		const cookie = (await context.cookies()).find((candidate) =>
			candidate.name.toLowerCase().includes('admin'),
		);
		expect(cookie, 'an admin session cookie exists').toBeDefined();
		// HttpOnly: the client script must not be able to read the session.
		expect(cookie?.httpOnly).toBe(true);
		// Secure: never sent over plaintext HTTP.
		expect(cookie?.secure).toBe(true);
		// Path scoped to /admin, not the whole origin.
		expect(cookie?.path).toBe('/admin');
		await context.close();
	});

	test('signing out clears the session', async ({browser}) => {
		const context = await browser.newContext({
			httpCredentials: {username: 'nest', password: API_KEY},
			ignoreHTTPSErrors: true,
		});
		const page = await context.newPage();
		await page.goto('/admin');
		await page
			.locator('form.login input[name="adminPassword"]')
			.fill(ADMIN_PASSWORD);
		await page.getByRole('button', {name: 'Sign in'}).click();
		await expect(page).toHaveURL(/\/admin\/local-config$/);

		// The logout button issues its own request; capture the response so the
		// assertion is about the logout call, not the page that follows.
		const [logoutResponse] = await Promise.all([
			page.waitForResponse((candidate) =>
				candidate.url().endsWith('/admin/logout'),
			),
			page.locator('#logoutButton').click(),
		]);
		expect(logoutResponse.status()).toBe(200);

		// After logout the editor is no longer reachable.
		await page.goto('/admin/local-config');
		expect((await page.title()).includes('Sign in')).toBe(true);
		await context.close();
	});

	/**
	 * A mutating API call without the `x-nest-admin: 1` header must be refused.
	 * The header forces a CORS preflight, which is half the CSRF story; this
	 * pins that the requirement is actually enforced.
	 */
	test('a mutating admin API call without the admin header is refused', async ({
		browser,
	}) => {
		const context = await browser.newContext({
			httpCredentials: {username: 'nest', password: API_KEY},
			ignoreHTTPSErrors: true,
		});
		const page = await context.newPage();
		await page.goto('/admin');
		await page
			.locator('form.login input[name="adminPassword"]')
			.fill(ADMIN_PASSWORD);
		await page.getByRole('button', {name: 'Sign in'}).click();
		await expect(page).toHaveURL(/\/admin\/local-config$/);

		const status = await page.evaluate(async () => {
			const response = await fetch('/admin/api/validate', {
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify({entries: []}),
			});
			return response.status;
		});
		expect(status).toBe(403);
		await context.close();
	});
});

/**
 * The "not configured" page is a state the primary suite server can never show,
 * because it boots with a password. It needs its own process: the admin password
 * is read once into module state at startup.
 */
test.describe('admin UI with no password configured', () => {
	let workspace: UiTestWorkspace;

	test.beforeAll(async () => {
		workspace = await startUiTestServer({
			port: UI_TEST_SECONDARY_PORT,
			adminPassword: '',
			recordState: false,
		});
	});

	test.afterAll(async () => {
		await workspace.stop();
	});

	test('serves the not-configured page instead of a login form', async ({
		browser,
	}) => {
		const context = await browser.newContext({
			httpCredentials: {username: 'nest', password: API_KEY},
			ignoreHTTPSErrors: true,
		});
		const page = await context.newPage();

		const response = await page.goto(`${UI_TEST_SECONDARY_BASE_URL}/admin`);
		expect(response?.status()).toBe(403);
		await expect(page).toHaveTitle('Admin UI is not configured');
		await expect(page.locator('.banner')).toContainText('ADMIN_UI_PASSWORD');
		// No login form must be offered — there is no credential that could work.
		await expect(page.locator('form.login')).toHaveCount(0);
		await context.close();
	});
});
