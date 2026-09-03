import {Response} from 'express';
import sanitizeHtml, {type Attributes, type IOptions} from 'sanitize-html';
import {EXTERNAL_LINK_GUARD_SCRIPT} from './client-scripts';
import {renderHtmlDocument} from './ui-components';

export const EXTERNAL_LINK_WARNING_MESSAGE =
	'You are about to leave this Nest app and open an external website. Continue?';

export const EXTERNAL_LINK_GUARD_SCRIPT_PATH = '/help/external-link-guard.js';
export const ROUTE_OVERVIEW_PATH = '/';

const HELP_CONTENT_SECURITY_POLICY =
	"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'self'";

const buildExternalLinkGuardScriptTag = (): string => {
	return `<script src="${EXTERNAL_LINK_GUARD_SCRIPT_PATH}" defer></script>`;
};

const escapeHtmlAttribute = (value: string): string => {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
};

const isAbsoluteHttpUrl = (href: string): boolean => {
	return /^https?:\/\//i.test(href);
};

export const getExternalLinkGuardScriptContent = (): string => {
	return EXTERNAL_LINK_GUARD_SCRIPT;
};

export const applyHelpPageSecurityHeaders = (res: Response): void => {
	res.setHeader('Content-Security-Policy', HELP_CONTENT_SECURITY_POLICY);
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'same-origin');
};

export const sanitizeHelpHtml = (html: string): string => {
	const options: IOptions = {
		allowedTags: [
			'h1',
			'h2',
			'h3',
			'h4',
			'p',
			'ul',
			'ol',
			'li',
			'a',
			'code',
			'pre',
			'table',
			'thead',
			'tbody',
			'tr',
			'th',
			'td',
			'strong',
			'em',
			'br',
			'hr',
			'blockquote',
			'div',
			'span',
		],
		allowedAttributes: {
			a: ['href', 'title', 'target', 'rel'],
		},
		allowedSchemes: ['http', 'https', 'mailto', 'tel'],
		transformTags: {
			a: (_tagName: string, attribs: Attributes) => {
				const transformed: Attributes = {...attribs};
				const href = transformed.href ?? '';
				if (isAbsoluteHttpUrl(href)) {
					transformed.target = '_blank';
					transformed.rel = 'noopener noreferrer';
				}
				return {tagName: 'a', attribs: transformed};
			},
		},
	};

	return sanitizeHtml(html, options);
};

export const appendExternalLinkGuard = (html: string): string => {
	const scriptTag = buildExternalLinkGuardScriptTag();
	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, `${scriptTag}</body>`);
	}

	return `${html}${scriptTag}`;
};

export const wrapFullHelpDocumentInSandbox = (
	title: string,
	fullHtml: string,
): string => {
	return renderHtmlDocument({
		title,
		backHref: ROUTE_OVERVIEW_PATH,
		maxPageWidth: '64rem',
		subtitle: 'This plugin help document is rendered in a sandbox for safety.',
		// The document itself is untrusted plugin output, so it stays inside a
		// sandboxed frame; only the chrome around it comes from this app.
		contentHtml: `<iframe class="sandbox-frame" sandbox="allow-popups" srcdoc="${escapeHtmlAttribute(
			fullHtml,
		)}"></iframe>`,
	});
};
