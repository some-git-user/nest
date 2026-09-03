import {Response} from 'express';
import {ADMIN_UI_MOUNT_PATH} from './admin-auth';
import {ADMIN_CONFIG_SCRIPT_PATH} from './admin-scripts';
import {escapeHtml} from './html-escape';
import {
	renderBanner,
	renderButton,
	renderField,
	renderHtmlDocument,
	renderStatus,
	renderToolbar,
} from './ui-components';

/**
 * Security headers for the admin UI.
 *
 * Deliberately *not* `applyHelpPageSecurityHeaders()`: that policy is built for
 * static help documents and sets `connect-src 'none'` and `form-action 'none'`,
 * which would block both the `fetch()` calls and the login form this page needs.
 * Everything else stays as strict, and `form-action 'self'` plus
 * `connect-src 'self'` keeps every request on this origin.
 */
export const ADMIN_CONTENT_SECURITY_POLICY =
	"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; upgrade-insecure-requests";

export const applyAdminPageSecurityHeaders = (res: Response): void => {
	res.setHeader('Content-Security-Policy', ADMIN_CONTENT_SECURITY_POLICY);
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Cache-Control', 'no-store');
};

/**
 * Rules the config editor needs on top of the shared stylesheet.
 *
 * The editor is the only page with a repeating card grid of plugin parameters,
 * so its entry cards get a subtle body to separate them from the page. Buttons,
 * fields, banners, toolbars and status lines all come from the shared sheet
 * unchanged, which is what makes this page look like the rest of the app.
 */
const ADMIN_EXTRA_STYLES = `
.entry{background:var(--surface-subtle)}
.entry .test-result{background:var(--surface)}
`;

/**
 * Embed JSON for a `<script type="application/json">` element.
 *
 * `JSON.stringify` alone is not enough: a value containing `</script>` would end
 * the element and let the value execute as markup. Escaping every `<` as a
 * unicode escape is valid JSON and removes that possibility entirely.
 */
export const embedJsonForScriptElement = (value: unknown): string =>
	JSON.stringify(value).replace(/</gu, '\\u003c');

export const renderAdminLoginPage = (errorMessage?: string): string => {
	const errorHtml = errorMessage
		? `<p class="status error show">${escapeHtml(errorMessage)}</p>`
		: '';

	return renderHtmlDocument({
		title: 'Nest Admin - Sign in',
		backHref: '/',
		subtitle:
			'Editing the local config presets file requires the admin credential.',
		contentHtml: `<form class="login card" method="post" action="${ADMIN_UI_MOUNT_PATH}/login">${renderField(
			{
				name: 'adminPassword',
				label: 'Admin password',
				type: 'password',
				required: true,
				autocomplete: 'current-password',
			},
		)}${renderButton({
			label: 'Sign in',
			variant: 'primary',
			type: 'submit',
		})}${errorHtml}</form>`,
	});
};

/**
 * Render the config editor shell.
 *
 * The page is a shell plus a JSON state block: the entry list, the plugin field
 * metadata and the drift status are all rendered by the client script from
 * `state`. Keeping the data in one JSON block means the editor and the API
 * always speak the exact same shape, and there is no second HTML renderer to
 * keep in sync.
 */
export const renderAdminConfigPage = (state: unknown): string => {
	return renderHtmlDocument({
		title: 'Local Config Presets',
		backHref: '/',
		maxPageWidth: '68rem',
		metaHtml: renderButton({
			id: 'logoutButton',
			label: 'Sign out',
			variant: 'danger',
		}),
		subtitle:
			'Edit plugins/configs/local-presets.conf. Saving writes the file only: the ' +
			'running presets stay the ones approved at startup, and the change takes ' +
			'effect after the whitelist hash is updated and the service is restarted.',
		contentHtml: `<div id="driftBanner"></div>
${renderToolbar(
	renderButton({id: 'addEntryButton', label: 'Add preset'}) +
		renderButton({id: 'validateButton', label: 'Validate'}) +
		renderButton({
			id: 'saveButton',
			label: 'Save file',
			variant: 'primary',
		}) +
		renderButton({
			id: 'revertButton',
			label: 'Revert to approved',
			variant: 'danger',
		}),
)}
${renderStatus('status')}
<div id="entries"></div>
<script type="application/json" id="admin-state">${embedJsonForScriptElement(
			state,
		)}</script>
<script src="${ADMIN_CONFIG_SCRIPT_PATH}" defer></script>`,
		extraStyles: ADMIN_EXTRA_STYLES,
	});
};

/**
 * Minimal page shown when no admin password is configured, i.e. a
 * misconfiguration rather than a wrong password. The admin UI is always mounted,
 * so without a credential there is nothing that could grant access.
 */
export const renderAdminNotConfiguredPage = (): string => {
	return renderHtmlDocument({
		title: 'Admin UI is not configured',
		backHref: '/',
		contentHtml: renderBanner({
			kind: 'warn',
			title: 'No admin credential is set',
			bodyHtml: `<p><code>ADMIN_UI_PASSWORD</code> is empty, so there is no credential that could grant
access to the editor. Set <code>ADMIN_UI_PASSWORD</code> and restart the service to
use it.</p>
<p><a href="/help/startup-warnings/admin-ui-password-missing">How to resolve this</a></p>`,
		}),
	});
};
