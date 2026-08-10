// External link guard script
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
				const ok = window.confirm(message + '\n\n' + destination.href);
				if (!ok) {
					event.preventDefault();
				}
			}
		},
		true,
	);
})();
