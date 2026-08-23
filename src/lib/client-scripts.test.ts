import {
	EXTERNAL_LINK_GUARD_SCRIPT,
	PLUGIN_EXAMPLE_FORM_SCRIPT,
} from './client-scripts';

describe('client-scripts', () => {
	describe('EXTERNAL_LINK_GUARD_SCRIPT', () => {
		it('should be a non-empty string', () => {
			expect(typeof EXTERNAL_LINK_GUARD_SCRIPT).toBe('string');
			expect(EXTERNAL_LINK_GUARD_SCRIPT.length).toBeGreaterThan(0);
		});

		it('should contain the external link guard IIFE', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('(function () {');
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('})();');
		});

		it('should contain click event listener', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain(
				'document.addEventListener',
			);
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain("'click'");
		});

		it('should contain confirmation message', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain(
				'You are about to leave this Nest app and open an external website',
			);
		});

		it('should check for anchor elements', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('closest(\'a\')');
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('HTMLAnchorElement');
		});

		it('should skip special link types', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('mailto:');
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('tel:');
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('javascript:');
		});

		it('should use URL constructor for validation', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('new URL(');
		});

		it('should guard cross-origin links only', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain(
				'destination.origin !== window.location.origin',
			);
		});

		it('should use window.confirm for user confirmation', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('window.confirm(');
		});

		it('should prevent default navigation when cancelled', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('event.preventDefault()');
		});

		it('should use capture phase for event listener', () => {
			expect(EXTERNAL_LINK_GUARD_SCRIPT).toContain('true,');
		});
	});

	describe('PLUGIN_EXAMPLE_FORM_SCRIPT', () => {
		it('should be a non-empty string', () => {
			expect(typeof PLUGIN_EXAMPLE_FORM_SCRIPT).toBe('string');
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT.length).toBeGreaterThan(0);
		});

		it('should contain the form handler IIFE', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('(function () {');
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('})();');
		});

		it('should contain submit event listener', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain(
				'document.addEventListener',
			);
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain("'submit'");
		});

		it('should check for form elements', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('HTMLFormElement');
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain(
				'classList.contains(\'plugin-example-form\')',
			);
		});

		it('should prevent default form submission', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('event.preventDefault()');
		});

		it('should handle GET method', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain("method === 'get'");
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('searchParams.append');
		});

		it('should handle POST method', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('else {');
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('handling POST form');
		});

		it('should filter empty form values', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('value !== \'\'');
		});

		it('should use FormData for form data extraction', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('new FormData(');
		});

		it('should hide submit button for POST forms', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain(
				'element.type === \'submit\'',
			);
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain(
				'element.style.display = \'none\'',
			);
		});

		it('should create a new form for POST submission', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain(
				'document.createElement(\'form\')',
			);
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('submitForm.submit()');
		});

		it('should use capture phase for event listener', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain('true,');
		});

		it('should log form processing steps', () => {
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain(
				'[nest-form-filter] intercepting form submit',
			);
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain(
				'[nest-form-filter] method:',
			);
			expect(PLUGIN_EXAMPLE_FORM_SCRIPT).toContain(
				'[nest-form-filter] action:',
			);
		});
	});
});
