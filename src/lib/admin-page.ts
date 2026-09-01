import {Response} from 'express';
import {ADMIN_UI_MOUNT_PATH} from './admin-auth';
import {ADMIN_CONFIG_SCRIPT_PATH} from './admin-scripts';
import {escapeHtml} from './html-escape';

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

const ADMIN_STYLES = `
body{font-family:system-ui,sans-serif;max-width:1080px;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1c1c1c}
h1{margin-bottom:.3rem}
h2{margin-top:1.6rem}
a{color:#0b57d0}
code{background:#f2f2f2;padding:.15rem .35rem;border-radius:4px}
.banner{border-left:4px solid #b3261e;background:#fdecea;padding:.7rem 1rem;margin:1rem 0}
.banner h2{margin:.1rem 0 .4rem;color:#8c1d18;font-size:1.05rem}
.banner.ok{border-left-color:#1e8e3e;background:#e6f4ea}
.banner.ok h2{color:#12612a}
.banner pre{background:#fff;border:1px solid #dadce0;border-radius:4px;padding:.5rem .6rem;overflow-x:auto;white-space:pre;margin:.5rem 0}
.toolbar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin:1rem 0}
.toolbar .spacer{flex:1}
button{padding:.35rem .8rem;border:1px solid #bdc1c6;border-radius:6px;background:#fff;cursor:pointer}
button.primary{background:#0b57d0;border-color:#0b57d0;color:#fff}
button.danger{background:#fff;border-color:#b3261e;color:#8c1d18}
button:disabled{opacity:.55;cursor:default}
.entry{border:1px solid #dadce0;border-radius:8px;padding:.7rem .8rem;margin:.6rem 0;background:#fafafa}
.entry-head{display:flex;gap:.6rem;align-items:flex-end;flex-wrap:wrap}
.field{display:grid;grid-template-columns:1fr;gap:.2rem}
.field label{font-size:.86rem;color:#444}
.field input,.field select{padding:.32rem .42rem;border:1px solid #bdc1c6;border-radius:5px;box-sizing:border-box;min-width:12rem}
.field .hint{font-size:.78rem;color:#666}
.params{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.5rem .8rem;margin-top:.6rem}
.entry-actions{display:flex;gap:.4rem;margin-top:.6rem}
.problems{margin:.5rem 0 .2rem;padding-left:1.2rem;color:#8c1d1e;font-size:.9rem}
.status{margin:.8rem 0;padding:.5rem .7rem;border-radius:6px;display:none}
.status.show{display:block}
.status.ok{background:#e6f4ea;border:1px solid #a5d6a7}
.status.error{background:#fdecea;border:1px solid #f0b3ad}
.test-result{margin-top:.5rem;font-size:.9rem;background:#fff;border:1px solid #dadce0;border-radius:6px;padding:.5rem .6rem;white-space:pre-wrap;display:none}
.test-result.show{display:block}
.login{max-width:24rem;border:1px solid #dadce0;border-radius:8px;padding:1rem 1.2rem;margin-top:1.5rem}
.login .field{margin-bottom:.8rem}
.muted{color:#5f6368;font-size:.9rem}
table.preview{border-collapse:collapse;width:100%;margin-top:.5rem}
table.preview td{border-top:1px solid #e0e0e0;padding:.3rem .4rem;font-family:monospace;font-size:.85rem;word-break:break-all}
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

const pageHead = (title: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${ADMIN_STYLES}</style>
</head>`;

export const renderAdminLoginPage = (errorMessage?: string): string => {
	const errorHtml = errorMessage
		? `<p class="status error show">${escapeHtml(errorMessage)}</p>`
		: '';

	return `${pageHead('Nest Admin - Sign in')}
<body>
<h1>Nest Admin</h1>
<p class="muted">Editing the local config presets file requires the admin credential.</p>
<form class="login" method="post" action="${ADMIN_UI_MOUNT_PATH}/login">
<div class="field"><label for="adminPassword">Admin password</label><input id="adminPassword" name="adminPassword" type="password" autocomplete="current-password" required></div>
<button class="primary" type="submit">Sign in</button>
${errorHtml}
</form>
<p><a href="/">Back to route overview</a></p>
</body>
</html>`;
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
	return `${pageHead('Nest Admin - Local Config Presets')}
<body>
<h1>Local Config Presets</h1>
<p class="muted">
Edit <code>plugins/configs/local-presets.conf</code>. Saving writes the file only:
the running presets stay the ones approved at startup, and the change takes effect
after the whitelist hash is updated and the service is restarted.
<a href="/">Route overview</a>
<button id="logoutButton" type="button" class="danger">Sign out</button>
</p>
<div id="driftBanner"></div>
<div class="toolbar">
<button id="addEntryButton" type="button">Add preset</button>
<button id="validateButton" type="button">Validate</button>
<button id="saveButton" type="button" class="primary">Save file</button>
<button id="revertButton" type="button" class="danger">Revert to approved</button>
</div>
<div id="status" class="status"></div>
<div id="entries"></div>
<script type="application/json" id="admin-state">${embedJsonForScriptElement(state)}</script>
<script src="${ADMIN_CONFIG_SCRIPT_PATH}" defer></script>
</body>
</html>`;
};

/**
 * Minimal page shown when no admin password is configured, i.e. a
 * misconfiguration rather than a wrong password. The admin UI is always mounted,
 * so without a credential there is nothing that could grant access.
 */
export const renderAdminNotConfiguredPage = (): string => {
	return `${pageHead('Nest Admin - Not Configured')}
<body>
<h1>Admin UI is not configured</h1>
<p>
<code>ADMIN_UI_PASSWORD</code> is empty, so there is no credential that could grant
access to the editor. Set <code>ADMIN_UI_PASSWORD</code> and restart the service to
use it.
</p>
<p><a href="/help/startup-warnings/admin-ui-password-missing">How to resolve this</a></p>
<p><a href="/">Back to route overview</a></p>
</body>
</html>`;
};
