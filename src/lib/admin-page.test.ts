import {Response} from 'express';
import {
	ADMIN_CONTENT_SECURITY_POLICY,
	applyAdminPageSecurityHeaders,
	embedJsonForScriptElement,
	renderAdminConfigPage,
	renderAdminLoginPage,
	renderAdminNotConfiguredPage,
} from './admin-page';
import {ADMIN_CONFIG_SCRIPT_PATH} from './admin-scripts';

describe('admin-page', () => {
	describe('applyAdminPageSecurityHeaders', () => {
		it('sets the CSP, frame options, referrer policy and cache control', () => {
			const setHeader = jest.fn();
			const res = {setHeader} as unknown as Response;

			applyAdminPageSecurityHeaders(res);

			expect(setHeader).toHaveBeenCalledWith(
				'Content-Security-Policy',
				ADMIN_CONTENT_SECURITY_POLICY,
			);
			expect(setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
			expect(setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
			expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
			expect(setHeader).toHaveBeenCalledTimes(4);
		});
	});

	describe('ADMIN_CONTENT_SECURITY_POLICY', () => {
		it('allows self scripts, connects and form actions', () => {
			expect(ADMIN_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
			expect(ADMIN_CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
			expect(ADMIN_CONTENT_SECURITY_POLICY).toContain("form-action 'self'");
		});
	});

	describe('embedJsonForScriptElement', () => {
		it('serialises a value to JSON', () => {
			expect(embedJsonForScriptElement({a: 1})).toBe('{"a":1}');
		});

		it('escapes every < so a value cannot close the script element', () => {
			expect(embedJsonForScriptElement({a: '</script>'})).toBe(
				'{"a":"\\u003c/script>"}',
			);
		});

		it('produces JSON that parses back identically', () => {
			const value = {nested: {list: ['<b>', 'ok']}};
			expect(JSON.parse(embedJsonForScriptElement(value))).toEqual(value);
		});
	});

	describe('renderAdminLoginPage', () => {
		it('renders a login form posting to the admin login path', () => {
			const html = renderAdminLoginPage();
			expect(html).toContain('<!DOCTYPE html>');
			expect(html).toContain('method="post"');
			expect(html).toContain('action="/admin/login"');
			expect(html).toContain('name="adminPassword"');
		});

		it('omits the error block when no message is given', () => {
			expect(renderAdminLoginPage()).not.toContain('status error show');
		});

		it('renders an escaped error message when provided', () => {
			const html = renderAdminLoginPage('Bad <script>alert(1)</script>');
			expect(html).toContain('status error show');
			expect(html).toContain('Bad &lt;script&gt;alert(1)&lt;/script&gt;');
			expect(html).not.toContain('<script>alert(1)</script>');
		});
	});

	describe('renderAdminConfigPage', () => {
		it('renders the editor shell with all controls', () => {
			const html = renderAdminConfigPage({entries: []});
			for (const id of [
				'id="driftBanner"',
				'id="addEntryButton"',
				'id="validateButton"',
				'id="saveButton"',
				'id="revertButton"',
				'id="logoutButton"',
				'id="status"',
				'id="entries"',
			]) {
				expect(html).toContain(id);
			}
		});

		it('embeds the state as JSON and loads the client script', () => {
			const html = renderAdminConfigPage({contentHash: 'abc'});
			expect(html).toContain(
				'<script type="application/json" id="admin-state">',
			);
			expect(html).toContain('"contentHash":"abc"');
			expect(html).toContain(
				`<script src="${ADMIN_CONFIG_SCRIPT_PATH}" defer></script>`,
			);
		});

		it('escapes a < inside the embedded state', () => {
			const html = renderAdminConfigPage({value: '</script>'});
			expect(html).not.toContain('</script>"');
			expect(html).toContain('\\u003c/script>');
		});
	});

	describe('renderAdminNotConfiguredPage', () => {
		it('explains the missing credential', () => {
			const html = renderAdminNotConfiguredPage();
			expect(html).toContain('ADMIN_UI_PASSWORD');
			expect(html).not.toContain('ADMIN_UI_ENABLED');
			expect(html).toContain('not configured');
			expect(html).toContain(
				'/help/startup-warnings/admin-ui-password-missing',
			);
		});
	});
});
