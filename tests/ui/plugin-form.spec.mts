import {type Page, expect, test} from '@playwright/test';

/**
 * Tests for the plugin run forms on the overview page.
 *
 * The real target here is `PLUGIN_EXAMPLE_FORM_SCRIPT`
 * (`src/lib/client-scripts.ts`), which until now could only be asserted as a
 * substring of a template literal. Its whole purpose is client-side behaviour —
 * filtering empty parameters and rewriting the submit — so it is only really
 * testable in a browser.
 *
 * The form does a full navigation (`window.location.assign`), not XHR, so the
 * response is captured with `waitForResponse` rather than by reading the page:
 * Chromium renders the JSON body through its own viewer, which is not a stable
 * thing to assert on.
 */

type NagiosResponse = {
	message: string;
	code: number;
	performanceData?: string;
};

const formFor = (page: Page, route: string) =>
	page.locator(`form.plugin-example-form[action="${route}"]`);

const submitAndCapture = async (
	page: Page,
	route: string,
): Promise<NagiosResponse> => {
	const [response] = await Promise.all([
		page.waitForResponse((candidate) => candidate.url().includes(route)),
		formFor(page, route).getByRole('button', {name: 'Run'}).click(),
	]);
	return (await response.json()) as NagiosResponse;
};

test.describe('plugin run form', () => {
	test.beforeEach(async ({page}) => {
		await page.goto('/');
	});

	test('renders one form per plugin with its declared parameters', async ({
		page,
	}) => {
		const form = formFor(page, '/plugins/check-ui-echo');
		await expect(form).toBeVisible();

		await expect(form.locator('input[name="message"]')).toBeVisible();
		await expect(form.locator('input[name="message"]')).toHaveAttribute(
			'required',
		);
		// Defaults declared in meta.params are prefilled into the inputs.
		await expect(form.locator('input[name="code"]')).toHaveValue('0');
		await expect(form.locator('input[name="repeat"]')).toHaveValue('1');
		await expect(form.locator('input[name="flag"]')).toHaveValue('false');
	});

	test('a plugin with no parameters renders no run form', async ({page}) => {
		const section = page.locator('.route-section', {hasText: 'Plugin Routes'});
		const item = section
			.locator('li')
			.filter({hasText: '/plugins/check-ui-minimal'});

		await expect(item.locator('.route-path')).toBeVisible();
		await expect(item.locator('form')).toHaveCount(0);
	});

	/**
	 * The empty-value filter is the single most important thing this script does:
	 * a blank field must not appear in the query string at all, so the plugin
	 * sees "parameter absent" rather than "parameter empty string".
	 */
	test('omits fields left empty from the query string', async ({page}) => {
		const form = formFor(page, '/plugins/check-ui-echo');
		await form.locator('input[name="message"]').fill('only this one');
		await form.locator('input[name="code"]').clear();
		await form.locator('input[name="repeat"]').clear();
		await form.locator('input[name="flag"]').clear();

		const result = await submitAndCapture(page, '/plugins/check-ui-echo');

		const url = new URL(page.url());
		expect(url.pathname).toBe('/plugins/check-ui-echo');
		expect([...url.searchParams.keys()]).toEqual(['message']);
		expect(url.searchParams.get('message')).toBe('only this one');
		expect(result.message).toContain('only this one');
	});

	test('sends every non-empty field and honours the Nagios code', async ({
		page,
	}) => {
		const form = formFor(page, '/plugins/check-ui-echo');
		await form.locator('input[name="message"]').fill('disk almost full');
		await form.locator('input[name="code"]').fill('2');
		await form.locator('input[name="repeat"]').fill('3');

		const result = await submitAndCapture(page, '/plugins/check-ui-echo');

		expect(result.code).toBe(2);
		// repeat=3 means the message is echoed three times.
		expect(result.message).toBe(
			'disk almost full disk almost full disk almost full',
		);
	});

	test('performance data reaches the response when the flag is set', async ({
		page,
	}) => {
		const form = formFor(page, '/plugins/check-ui-echo');
		await form.locator('input[name="message"]').fill('with perfdata');
		await form.locator('input[name="flag"]').fill('true');

		const result = await submitAndCapture(page, '/plugins/check-ui-echo');

		expect(result.code).toBe(0);
		expect(result.performanceData).toContain('ui_echo_messages');
	});

	test('no performance data when the flag is false', async ({page}) => {
		const form = formFor(page, '/plugins/check-ui-echo');
		await form.locator('input[name="message"]').fill('no perfdata');
		await form.locator('input[name="flag"]').fill('false');

		const result = await submitAndCapture(page, '/plugins/check-ui-echo');

		expect(
			result.performanceData === undefined ||
				result.performanceData.length === 0,
		).toBe(true);
	});

	/**
	 * The `required` attribute on `message` is enforced by the browser, not the
	 * server: the submit event never fires, so no request is made. This pins
	 * that the client script's `preventDefault` does not accidentally bypass
	 * native validation.
	 */
	test('a required field blocks submission with no request sent', async ({
		page,
	}) => {
		const form = formFor(page, '/plugins/check-ui-echo');
		await form.locator('input[name="message"]').clear();

		let requestMade = false;
		page.on('request', (request) => {
			if (request.url().includes('/plugins/check-ui-echo')) {
				requestMade = true;
			}
		});

		await form.getByRole('button', {name: 'Run'}).click();
		await page.waitForTimeout(300);

		expect(requestMade).toBe(false);
		// Still on the overview page.
		expect(new URL(page.url()).pathname).toBe('/');
	});

	test('the help link renders HTML rather than Nagios JSON', async ({page}) => {
		const response = await page.goto('/plugins/check-ui-echo?help');
		expect(response?.status()).toBe(200);
		expect(response?.headers()['content-type']).toContain('text/html');
		await expect(page.locator('h1')).toContainText('check-ui-echo');
	});
});
