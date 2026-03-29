import {Response} from 'express';
import sanitizeHtml, {type Attributes, type IOptions} from 'sanitize-html';

export const EXTERNAL_LINK_WARNING_MESSAGE =
	'You are about to leave this Nest app and open an external website. Continue?';

export const EXTERNAL_LINK_GUARD_SCRIPT_PATH = '/help/external-link-guard.js';

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
	const messageLiteral = JSON.stringify(EXTERNAL_LINK_WARNING_MESSAGE);

	return `(function(){const msg=${messageLiteral};document.addEventListener('click',function(event){const rawTarget=event.target;if(!(rawTarget instanceof Element)){return;}const anchor=rawTarget.closest('a');if(!(anchor instanceof HTMLAnchorElement)){return;}const rawHref=anchor.getAttribute('href');if(!rawHref||rawHref.startsWith('#')){return;}if(/^(mailto:|tel:|javascript:)/i.test(rawHref)){return;}let destination;try{destination=new URL(anchor.href,window.location.href);}catch{return;}if(destination.origin!==window.location.origin){const ok=window.confirm(msg+'\\n\\n'+destination.href);if(!ok){event.preventDefault();}}},true);})();`;
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
	const safeTitle = escapeHtmlAttribute(title);
	const safeSrcdoc = escapeHtmlAttribute(fullHtml);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
body{font-family:sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;line-height:1.5}
iframe{width:100%;min-height:70vh;border:1px solid #dcdcdc;border-radius:6px;background:#fff}
</style>
</head>
<body>
<h1>${safeTitle}</h1>
<p>This plugin help document is rendered in a sandbox for safety.</p>
<iframe sandbox="allow-popups" srcdoc="${safeSrcdoc}"></iframe>
</body>
</html>`;
};
