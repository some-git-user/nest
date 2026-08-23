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
/* global document, HTMLFormElement, console, window, URL, FormData, HTMLInputElement */

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

			console.log('[nest-form-filter] intercepting form submit');
			event.preventDefault();

			const method = (target.getAttribute('method') || 'get').toLowerCase();
			console.log('[nest-form-filter] method:', method);

			const action = target.getAttribute('action') || window.location.pathname;
			console.log('[nest-form-filter] action:', action);

			const destination = new URL(action, window.location.href);

			if (method === 'get') {
				// GET: Build query string and navigate
				const formData = new FormData(target);
				const entries = Array.from(formData.entries());
				console.log('[nest-form-filter] form fields before filter:', entries);

				destination.search = '';
				for (const [name, value] of formData.entries()) {
					if (typeof value === 'string' && value !== '') {
						destination.searchParams.append(name, value);
					}
				}

				const finalUrl = destination.toString();
				console.log('[nest-form-filter] navigating to:', finalUrl);
				window.location.assign(finalUrl);
			} else {
				// POST: Prepare form with filtered data and submit
				console.log('[nest-form-filter] handling POST form');

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
