import {type Page, expect, test} from '@playwright/test';
import {ADMIN_PASSWORD} from './workspace.mts';

/**
 * Admin config editor tests.
 *
 * This is the highest-value file in the suite. The editor's client script
 * (`ADMIN_CONFIG_SCRIPT`) is a template literal that Jest can only match
 * against as a string, and two pre-existing, data-destroying bugs shipped
 * because nothing ever clicked it:
 *
 *   1. `fieldsByCommand[entry.command].forEach(...)` on a blank entry threw a
 *      TypeError, aborting render() so "Add preset" silently did nothing.
 *   2. `commandOptions()` emitted no `selected` attribute, so every re-render
 *      silently switched each entry to the FIRST plugin — corrupting data on
 *      save.
 *
 * Both are guarded here by driving the real DOM.
 *
 * Isolation: the editor writes one shared config file on disk, so the suite
 * runs with a single worker. The draft-manipulation tests below never save, so
 * they stay order-independent; the save/revert flow runs last and ends by
 * reverting, restoring the seed file.
 */

const loginToEditor = async (page: Page): Promise<void> => {
	await page.goto('/admin');
	await page
		.locator('form.login input[name="adminPassword"]')
		.fill(ADMIN_PASSWORD);
	await page.getByRole('button', {name: 'Sign in'}).click();
	await expect(page).toHaveURL(/\/admin\/local-config$/);
	await expect(page.locator('#entries .entry').first()).toBeVisible();
};

const entryByIndex = (page: Page, index: number) =>
	page.locator(`#entries .entry[data-index="${String(index)}"]`);

const entryIndexForKey = (page: Page, key: string): Promise<number> =>
	page.$$eval(
		'#entries .entry',
		(entries, wanted) =>
			entries.findIndex(
				(entry) =>
					entry.querySelector('[data-role="key"]')?.getAttribute('value') ===
						wanted ||
					(entry.querySelector('[data-role="key"]') as HTMLInputElement)
						?.value === wanted,
			),
		key,
	);

test.describe('admin editor — rendering', () => {
	test.beforeEach(async ({page}) => {
		await loginToEditor(page);
	});

	test('loads the seed presets as stored entries', async ({page}) => {
		await expect(page.locator('#entries .entry')).toHaveCount(3);

		// A stored entry shows the "Run from Nagios" command line; a fresh draft
		// does not. Its presence proves these came from disk, not from a draft.
		await expect(page.locator('.entry-command-line').first()).toContainText(
			'./check_nest.sh --local-config',
		);
	});

	/**
	 * Regression guard for bug #1. A newly added preset must render a working
	 * card with a populated command select — not throw and silently no-op.
	 */
	test('Add preset creates a card with a populated command select', async ({
		page,
	}) => {
		const before = await page.locator('#entries .entry').count();

		await page.locator('#addEntryButton').click();

		await expect(page.locator('#entries .entry')).toHaveCount(before + 1);

		const added = entryByIndex(page, before);
		await expect(added).toBeVisible();

		const commandSelect = added.locator('[data-role="command"]');
		await expect(commandSelect).toBeVisible();
		// The bug was an empty/blank command making the card useless. The new
		// entry must start on a real, loaded plugin.
		const selectedValue = await commandSelect.inputValue();
		expect(selectedValue).not.toBe('');
		const optionCount = await commandSelect.locator('option').count();
		expect(optionCount).toBeGreaterThan(1);
	});

	/**
	 * Regression guard for bug #2 — the data-destroying one.
	 *
	 * Changing an entry's command triggers a full re-render. Clicking "Add
	 * preset" triggers another. Without the `selected` attribute, the second
	 * render would silently reset entry 0 to the first plugin in the list.
	 */
	test('a chosen command survives a later re-render', async ({page}) => {
		const select = entryByIndex(page, 0).locator('[data-role="command"]');
		const options = await select
			.locator('option')
			.evaluateAll((nodes) =>
				nodes
					.map((node) => (node as HTMLOptionElement).value)
					.filter((value) => value.length > 0),
			);
		const current = await select.inputValue();
		const other = options.find((value) => value !== current);
		expect(other, 'a second plugin command exists to switch to').toBeDefined();

		await select.selectOption(other as string);
		await expect(
			entryByIndex(page, 0).locator('[data-role="command"]'),
		).toHaveValue(other as string);

		// Force a second render via Add preset.
		await page.locator('#addEntryButton').click();
		await expect(page.locator('#entries .entry')).toHaveCount(4);

		// Entry 0 must still show the command we chose, not the first option.
		await expect(
			entryByIndex(page, 0).locator('[data-role="command"]'),
		).toHaveValue(other as string);
	});

	test('a secret parameter is masked and never sent to the browser', async ({
		page,
	}) => {
		const secretIndex = await entryIndexForKey(page, 'ui_secret');
		expect(secretIndex).toBeGreaterThanOrEqual(0);

		const tokenInput = entryByIndex(page, secretIndex).locator(
			'[data-param="token"]',
		);
		await expect(tokenInput).toHaveAttribute('type', 'password');
		// The stored value is replaced by an empty field with a "keep" hint.
		await expect(tokenInput).toHaveValue('');
		await expect(tokenInput).toHaveAttribute('placeholder', /stored/i);

		// The real secret must not appear anywhere in the served DOM.
		const html = await page.content();
		expect(html).not.toContain('s3cr3t-seed-value');
	});

	test('an undeclared parameter is shown, not dropped', async ({page}) => {
		const index = await entryIndexForKey(page, 'ui_undeclared');
		expect(index).toBeGreaterThanOrEqual(0);

		const mystery = entryByIndex(page, index).locator('[data-param="mystery"]');
		await expect(mystery).toBeVisible();
		await expect(mystery).toHaveValue('kept');

		// The field is labelled as undeclared so the operator knows the plugin
		// does not declare it but it will still be saved.
		const field = mystery.locator('xpath=ancestor::label');
		await expect(field).toContainText('undeclared');
	});
});

test.describe('admin editor — live validation', () => {
	test.beforeEach(async ({page}) => {
		await loginToEditor(page);
	});

	/**
	 * The duplicate-key warning is computed client-side on every keystroke, and
	 * deliberately without a re-render so the operator keeps focus while typing.
	 */
	test('a duplicate key warns live and keeps focus', async ({page}) => {
		const firstKey = entryByIndex(page, 0).locator('[data-role="key"]');
		const existingKey = await firstKey.inputValue();
		expect(existingKey).toBe('ui_basic');

		const secondKey = entryByIndex(page, 1).locator('[data-role="key"]');
		await secondKey.click();
		await secondKey.fill(existingKey);

		const warning = entryByIndex(page, 1).locator('[data-role="keyWarning"]');
		await expect(warning).toHaveClass(/show/);
		await expect(warning).toContainText('Duplicate key');

		// Focus must remain on the field being typed in — a re-render would
		// have stolen it.
		const focusedIsSecondKey = await page.evaluate(() => {
			const active = document.activeElement;
			return (
				active?.getAttribute('data-role') === 'key' &&
				active?.closest('.entry')?.getAttribute('data-index') === '1'
			);
		});
		expect(focusedIsSecondKey).toBe(true);
	});

	test('clearing the duplicate removes the warning', async ({page}) => {
		const firstKey = entryByIndex(page, 0).locator('[data-role="key"]');
		const existingKey = await firstKey.inputValue();

		const secondKey = entryByIndex(page, 1).locator('[data-role="key"]');
		await secondKey.fill(existingKey);
		await expect(
			entryByIndex(page, 1).locator('[data-role="keyWarning"]'),
		).toHaveClass(/show/);

		await secondKey.fill('a-unique-key');
		await expect(
			entryByIndex(page, 1).locator('[data-role="keyWarning"]'),
		).not.toHaveClass(/show/);
	});
});

test.describe('admin editor — copy', () => {
	test.beforeEach(async ({page}) => {
		await loginToEditor(page);
	});

	test('Copy inserts a counter-suffixed clone below the source', async ({
		page,
	}) => {
		await entryByIndex(page, 0).locator('[data-action="copy"]').click();

		await expect(page.locator('#entries .entry')).toHaveCount(4);

		const clone = entryByIndex(page, 1).locator('[data-role="key"]');
		await expect(clone).toHaveValue('ui_basic-1');
		// The clone shares the source command.
		await expect(
			entryByIndex(page, 1).locator('[data-role="command"]'),
		).toHaveValue('check-ui-echo');
	});

	test('Copy bumps the counter past an existing collision', async ({page}) => {
		await entryByIndex(page, 0).locator('[data-action="copy"]').click();
		await expect(
			entryByIndex(page, 1).locator('[data-role="key"]'),
		).toHaveValue('ui_basic-1');

		// Copy the original again; ui_basic-1 is taken so it must bump to -2.
		await entryByIndex(page, 0).locator('[data-action="copy"]').click();

		const keys = await page.$$eval(
			'#entries .entry [data-role="key"]',
			(inputs) => inputs.map((input) => (input as HTMLInputElement).value),
		);
		expect(keys).toContain('ui_basic-2');
		expect(keys.filter((key) => key === 'ui_basic-1')).toHaveLength(1);
	});
});

test.describe('admin editor — validate / save / revert', () => {
	test('validate reports ok for the clean seed set', async ({page}) => {
		await loginToEditor(page);

		await page.locator('#validateButton').click();
		await expect(page.locator('#status')).toHaveClass(/show/);
		await expect(page.locator('#status')).toHaveClass(/ok/);
		await expect(page.locator('#status')).toContainText('valid');
	});

	test('validate surfaces duplicate-key problems', async ({page}) => {
		await loginToEditor(page);

		const firstKey = entryByIndex(page, 0).locator('[data-role="key"]');
		const existingKey = await firstKey.inputValue();
		await entryByIndex(page, 1).locator('[data-role="key"]').fill(existingKey);

		await page.locator('#validateButton').click();
		await expect(page.locator('#status')).toHaveClass(/error/);
		await expect(page.locator('#status')).toContainText('duplicate');
	});

	/**
	 * Save writes the file but does NOT self-approve: the drift banner must show
	 * the exact whitelist line the operator has to add. Reverting restores the
	 * approved bytes, which also returns the scratch file to its seed state so
	 * the suite leaves no residue.
	 */
	test('save shows the drift line, revert clears it', async ({page}) => {
		await loginToEditor(page);

		await page.locator('#saveButton').click();
		await expect(page.locator('#status')).toContainText('Saved');

		const drift = page.locator('#driftBanner');
		await expect(drift).toContainText('configs/local-presets.conf');
		await expect(drift.locator('pre')).toContainText(
			/configs\/local-presets\.conf [0-9a-f]{64}/,
		);

		// Revert asks for confirmation; accept it.
		page.once('dialog', (dialog) => dialog.accept());
		await page.locator('#revertButton').click();

		await expect(page.locator('#driftBanner')).toContainText(
			'File matches the whitelist',
		);
	});
});

test.describe('admin editor — layout regression', () => {
	/**
	 * The `.field` grid alignment fix is documented as needing measurement, not
	 * eyeballing: when one label wraps to two lines, sibling inputs must keep
	 * their natural height and share a bottom edge rather than stretching.
	 */
	test('parameter inputs keep uniform height within a row', async ({page}) => {
		await loginToEditor(page);

		const echoIndex = await entryIndexForKey(page, 'ui_basic');
		const metrics = await entryByIndex(page, echoIndex)
			.locator('.params input')
			.evaluateAll((inputs) =>
				inputs.map((input) => {
					const rect = (input as HTMLInputElement).getBoundingClientRect();
					return {height: rect.height, bottom: rect.bottom};
				}),
			);

		expect(metrics.length).toBeGreaterThan(1);
		const heights = metrics.map((metric) => metric.height);
		const heightSpread = Math.max(...heights) - Math.min(...heights);
		expect(heightSpread).toBeLessThanOrEqual(1);
	});
});
