/**
 * Escape a string for safe interpolation into HTML text nodes and into
 * double-quoted attribute values.
 *
 * Shared by the server-rendered pages so that the overview page, the help
 * pages and the admin UI cannot drift apart in what they consider escaped.
 * Single-quoted attributes are not supported by design: every template here
 * uses double quotes.
 */
export const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
