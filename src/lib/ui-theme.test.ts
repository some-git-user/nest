import {APP_STYLESHEET, DESIGN_TOKENS_CSS} from './ui-theme';

describe('DESIGN_TOKENS_CSS', () => {
	it('declares every palette token as a CSS custom property', () => {
		for (const token of [
			'--bg:',
			'--surface:',
			'--surface-subtle:',
			'--surface-hover:',
			'--border:',
			'--border-strong:',
			'--text:',
			'--text-muted:',
			'--accent:',
			'--accent-hover:',
			'--danger:',
			'--danger-text:',
			'--danger-bg:',
			'--ok:',
			'--ok-text:',
			'--ok-bg:',
			'--warn:',
			'--warn-text:',
			'--warn-bg:',
			'--info:',
			'--radius:',
			'--radius-sm:',
			'--radius-pill:',
			'--mono:',
		]) {
			expect(DESIGN_TOKENS_CSS).toContain(token);
		}
	});
});

describe('APP_STYLESHEET', () => {
	it('scopes the tokens to :root so every page inherits them', () => {
		expect(APP_STYLESHEET.startsWith(`:root{${DESIGN_TOKENS_CSS}}`)).toBe(true);
	});

	it('has exactly one body rule so pages cannot override the theme', () => {
		expect(APP_STYLESHEET.match(/(^|[}\n])body\{/g)).toHaveLength(1);
	});

	it('sizes the page through the overridable measure token', () => {
		expect(APP_STYLESHEET).toContain('max-width:var(--page-max-width,60rem)');
	});

	it('styles the components the shared markup emits', () => {
		for (const selector of [
			'.page-header{',
			'.page-meta{',
			'.crumbs{',
			'.muted{',
			'.card{',
			'.field input',
			'.field .hint{',
			'.required{',
			'button.primary{',
			'button.danger{',
			'.toolbar{',
			'.banner.ok{',
			'.banner.warn{',
			'.status.show{',
			'.entry{',
			'.entry-head{',
			'.params{',
			'.entry-actions{',
			'.test-result.show{',
			'.login{',
			'.route-list{',
			'.route-header{',
			'.route-help{',
			'.plugin-example-form{',
			'.plugin-example-method{',
			'.plugin-example-link{',
			'.warnings{',
			'.startup-warning-whitelist-entry{',
			'.shell-auth-hint{',
			'.sandbox-frame{',
		]) {
			expect(APP_STYLESHEET).toContain(selector);
		}
	});

	it('never sets a min-width on inputs, which breaks the responsive grids', () => {
		expect(APP_STYLESHEET).not.toContain('min-width:1');
	});

	it('marks invalid fields through aria-invalid rather than :invalid', () => {
		expect(APP_STYLESHEET).toContain(".field input[aria-invalid='true']{");
		expect(APP_STYLESHEET).not.toContain(':invalid');
	});

	it('bottom-aligns the input of a field stretched by a tall neighbour', () => {
		// A field sitting next to one whose label wraps is stretched to the same
		// height. The label row has to absorb that slack: two `auto` rows would
		// split it, inflating the input and lifting it off the row's baseline.
		expect(APP_STYLESHEET).toContain(
			'.field{display:grid;grid-template-columns:1fr;grid-template-rows:1fr auto;',
		);
	});
});
