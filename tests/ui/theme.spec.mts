import {expect, test} from '@playwright/test';

/**
 * Theme toggle tests.
 *
 * `THEME_TOGGLE_SCRIPT` is the third client script that previously had no
 * behavioural coverage. Its contract: apply the stored theme before first
 * paint, persist the choice in a `nest_theme` cookie (not localStorage, so it
 * survives across pages), fall back to the OS preference when no cookie
 * exists, and keep the button's `aria-pressed`/icon/label in sync.
 */

test.describe('theme toggle', () => {
	test('applies a theme and syncs the button on load', async ({page}) => {
		await page.goto('/');

		const theme = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme'),
		);
		expect(['light', 'dark']).toContain(theme);

		const button = page.locator('#theme-toggle');
		await expect(button).toBeVisible();
		await expect(button).toHaveAttribute(
			'aria-pressed',
			theme === 'dark' ? 'true' : 'false',
		);
	});

	test('clicking flips the theme and writes the cookie', async ({page}) => {
		await page.goto('/');
		const before = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme'),
		);

		await page.locator('#theme-toggle').click();

		const after = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme'),
		);
		expect(after).not.toBe(before);
		expect(['light', 'dark']).toContain(after);

		// Persisted in a cookie, not localStorage.
		const cookie = await page.evaluate(() => {
			const match = document.cookie
				.split(';')
				.map((part) => part.trim())
				.find((part) => part.startsWith('nest_theme='));
			return match ? decodeURIComponent(match.slice('nest_theme='.length)) : '';
		});
		expect(cookie).toBe(after);

		// The button label follows the theme.
		const label = await page
			.locator('#theme-toggle .theme-toggle-label')
			.textContent();
		expect(label).toBe(after === 'dark' ? 'Light' : 'Dark');
	});

	/**
	 * The cookie is `Path=/`, so the choice carries across pages. This is the
	 * reason it is a cookie rather than a per-page variable.
	 */
	test('the theme persists across navigation', async ({page}) => {
		await page.goto('/');
		await page.locator('#theme-toggle').click();
		const chosen = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme'),
		);

		await page.goto('/nagios?help');
		const afterNav = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme'),
		);
		expect(afterNav).toBe(chosen);
	});

	test('the theme persists across a reload', async ({page}) => {
		await page.goto('/');
		await page.locator('#theme-toggle').click();
		const chosen = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme'),
		);

		await page.reload();
		expect(
			await page.evaluate(() =>
				document.documentElement.getAttribute('data-theme'),
			),
		).toBe(chosen);
	});

	/**
	 * With no cookie, the OS `prefers-color-scheme` decides. Playwright can
	 * emulate it, which is the only way to cover the fallback branch.
	 */
	test('falls back to the OS preference when no cookie is set', async ({
		browser,
	}) => {
		for (const scheme of ['dark', 'light'] as const) {
			const context = await browser.newContext({
				colorScheme: scheme,
				httpCredentials: {username: 'nest', password: 'e2e-ui-api-key'},
				ignoreHTTPSErrors: true,
			});
			const page = await context.newPage();
			await page.goto('/');

			const theme = await page.evaluate(() =>
				document.documentElement.getAttribute('data-theme'),
			);
			expect(theme, `prefers-color-scheme: ${scheme}`).toBe(scheme);

			// No cookie should have been written just by reading the preference.
			const hasCookie = await page.evaluate(() =>
				document.cookie.includes('nest_theme='),
			);
			expect(hasCookie).toBe(false);

			await context.close();
		}
	});

	test('an explicit choice overrides the OS preference', async ({browser}) => {
		const context = await browser.newContext({
			// OS says light; the operator picks dark.
			colorScheme: 'light',
			httpCredentials: {username: 'nest', password: 'e2e-ui-api-key'},
			ignoreHTTPSErrors: true,
		});
		const page = await context.newPage();
		await page.goto('/');
		await page.locator('#theme-toggle').click();

		expect(
			await page.evaluate(() =>
				document.documentElement.getAttribute('data-theme'),
			),
		).toBe('dark');

		await page.reload();
		// Still dark after reload, despite the OS preference being light.
		expect(
			await page.evaluate(() =>
				document.documentElement.getAttribute('data-theme'),
			),
		).toBe('dark');

		await context.close();
	});
});
