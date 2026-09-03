/**
 * External link guard client script
 * Warns users before navigating to external websites
 */
export const EXTERNAL_LINK_GUARD_SCRIPT = `// External link guard script
// Warns users before navigating to external websites
/* global document, Element, HTMLAnchorElement, window, URL */

(function () {
	const message =
		'You are about to leave this Nest app and open an external website. Continue?';

	document.addEventListener(
		'click',
		function (event) {
			const rawTarget = event.target;
			if (!(rawTarget instanceof Element)) {
				return;
			}

			const anchor = rawTarget.closest('a');
			if (!(anchor instanceof HTMLAnchorElement)) {
				return;
			}

			const rawHref = anchor.getAttribute('href');
			if (!rawHref || rawHref.startsWith('#')) {
				return;
			}

			// Skip mailto:, tel:, javascript: links
			if (/^(mailto:|tel:|javascript:)/i.test(rawHref)) {
				return;
			}

			let destination;
			try {
				destination = new URL(anchor.href, window.location.href);
			} catch {
				return;
			}

			// Only guard cross-origin links
			if (destination.origin !== window.location.origin) {
				const ok = window.confirm(message + '\\n\\n' + destination.href);
				if (!ok) {
					event.preventDefault();
				}
			}
		},
		true,
	);
})();
`;

/**
 * Plugin example form handler client script
 * Filters empty parameters and handles GET/POST submissions
 */
export const PLUGIN_EXAMPLE_FORM_SCRIPT = `// Form submission handler for plugin example forms
// Filters empty parameters and handles GET/POST submissions
/* global document, HTMLFormElement, window, URL, FormData, HTMLInputElement */

(function () {
	document.addEventListener(
		'submit',
		function (event) {
			const target = event.target;
			if (!(target instanceof HTMLFormElement)) {
				return;
			}
			if (!target.classList.contains('plugin-example-form')) {
				return;
			}

			event.preventDefault();

			const method = (target.getAttribute('method') || 'get').toLowerCase();
			const action = target.getAttribute('action') || window.location.pathname;
			const destination = new URL(action, window.location.href);

			if (method === 'get') {
				// GET: Build query string and navigate
				const formData = new FormData(target);

				destination.search = '';
				for (const [name, value] of formData.entries()) {
					if (typeof value === 'string' && value !== '') {
						destination.searchParams.append(name, value);
					}
				}

				window.location.assign(destination.toString());
			} else {
				// POST: Prepare form with filtered data and submit
				const formData = new FormData(target);
				const filtered = new FormData();

				// Filter out empty values
				for (const [name, value] of formData.entries()) {
					if (typeof value === 'string' && value !== '') {
						filtered.append(name, value);
					}
				}

				// Update existing input fields with filtered values
				for (const element of target.elements) {
					if (element instanceof HTMLInputElement) {
						if (element.type === 'submit') {
							// Hide submit button to prevent resubmission on back navigation
							element.style.display = 'none';
						} else {
							// Update input value if it has a filtered value
							const filteredValue = filtered.get(element.name);
							if (typeof filteredValue === 'string' && filteredValue !== '') {
								element.value = filteredValue;
							}
						}
					}
				}

				// Create a new form for actual submission
				const submitForm = document.createElement('form');
				submitForm.method = 'POST';
				submitForm.action = action;
				submitForm.style.display = 'none';

				for (const [name, value] of filtered.entries()) {
					const input = document.createElement('input');
					input.type = 'hidden';
					input.name = name;
					input.value = value;
					submitForm.appendChild(input);
				}

				document.body.appendChild(submitForm);
				submitForm.submit();
			}
		},
		true,
	);
})();
`;

/**
 * Theme toggle client script.
 *
 * Served as a static string rather than inlined, because every page's CSP is
 * `script-src 'self'` and an inline script would be blocked. It is loaded in
 * `<head>` *without* `defer` so the stored theme is applied to the root element
 * before first paint, which avoids a flash of the wrong theme.
 *
 * The chosen theme is persisted in a `nest_theme` cookie (not localStorage) so
 * it survives across pages and reloads; the value is read back on every load.
 * With no cookie yet, the OS `prefers-color-scheme` decides the initial theme.
 */
export const THEME_TOGGLE_SCRIPT_PATH = '/theme-toggle.js';

export const THEME_TOGGLE_SCRIPT = `// Theme toggle client script
// Applies the cookie-stored theme before paint and wires the toggle control.
/* global document, window, Element, HTMLElement, HTMLButtonElement */

(function () {
	var COOKIE_NAME = 'nest_theme';
	var COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

	function readThemeCookie() {
		var parts = document.cookie ? document.cookie.split(';') : [];
		for (var i = 0; i < parts.length; i++) {
			var pair = parts[i].trim();
			if (pair.indexOf(COOKIE_NAME + '=') === 0) {
				return decodeURIComponent(pair.slice(COOKIE_NAME.length + 1));
			}
		}
		return '';
	}

	function writeThemeCookie(theme) {
		document.cookie =
			COOKIE_NAME +
			'=' +
			encodeURIComponent(theme) +
			'; Max-Age=' +
			COOKIE_MAX_AGE +
			'; Path=/; SameSite=Lax';
	}

	function systemTheme() {
		if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
			return 'dark';
		}
		return 'light';
	}

	function currentTheme() {
		var stored = readThemeCookie();
		return stored === 'dark' || stored === 'light' ? stored : systemTheme();
	}

	function applyTheme(theme) {
		document.documentElement.setAttribute('data-theme', theme);
	}

	// Apply immediately, before the body exists, so there is no flash.
	applyTheme(currentTheme());

	function syncButton(button, theme) {
		var dark = theme === 'dark';
		button.setAttribute('aria-pressed', dark ? 'true' : 'false');
		button.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
		var icon = button.querySelector('.theme-toggle-icon');
		if (icon instanceof Element) {
			icon.textContent = dark ? '\\u2600' : '\\u263D';
		}
		var label = button.querySelector('.theme-toggle-label');
		if (label instanceof Element) {
			label.textContent = dark ? 'Light' : 'Dark';
		}
	}

	function init() {
		var button = document.getElementById('theme-toggle');
		if (!(button instanceof HTMLButtonElement)) {
			return;
		}
		syncButton(button, currentTheme());
		button.addEventListener('click', function () {
			var next =
				document.documentElement.getAttribute('data-theme') === 'dark'
					? 'light'
					: 'dark';
			applyTheme(next);
			writeThemeCookie(next);
			syncButton(button, next);
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
`;
