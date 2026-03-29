import {
	EXTERNAL_LINK_GUARD_SCRIPT_PATH,
	EXTERNAL_LINK_WARNING_MESSAGE,
	appendExternalLinkGuard,
	applyHelpPageSecurityHeaders,
	getExternalLinkGuardScriptContent,
	sanitizeHelpHtml,
	wrapFullHelpDocumentInSandbox,
} from './help-page';

describe('appendExternalLinkGuard', () => {
	test('injects warning script before closing body tag when present', () => {
		const html =
			'<html><body><a href="https://example.com">link</a></body></html>';
		const result = appendExternalLinkGuard(html);

		expect(result).toContain(
			`<script src="${EXTERNAL_LINK_GUARD_SCRIPT_PATH}" defer></script>`,
		);
		expect(result).toContain('</script></body>');
		expect(result).toContain('<a href="https://example.com">link</a>');
	});

	test('appends warning script when no closing body tag is present', () => {
		const html = '<div>fragment-only help</div>';
		const result = appendExternalLinkGuard(html);

		expect(result).toContain('fragment-only help');
		expect(result).toContain(
			`<script src="${EXTERNAL_LINK_GUARD_SCRIPT_PATH}" defer></script>`,
		);
	});

	test('exports guard script content including warning text', () => {
		const script = getExternalLinkGuardScriptContent();
		expect(script).toContain('window.confirm');
		expect(script).toContain(EXTERNAL_LINK_WARNING_MESSAGE);
	});

	test('sanitizes unsafe HTML and hardens external anchors', () => {
		const unsafeHtml =
			'<p>hello</p><script>alert(1)</script><a href="https://example.com">go</a><a href="/docs/internal">internal</a><a>nohref</a><a href="javascript:alert(1)">bad</a>';
		const sanitized = sanitizeHelpHtml(unsafeHtml);

		expect(sanitized).toContain('<p>hello</p>');
		expect(sanitized).not.toContain('<script');
		expect(sanitized).toContain('target="_blank"');
		expect(sanitized).toContain('rel="noopener noreferrer"');
		expect(sanitized).toContain('<a href="/docs/internal">internal</a>');
		expect(sanitized).toContain('<a>nohref</a>');
		expect(sanitized).not.toContain('javascript:');
	});

	// ──────────────── Event-handler injection ────────────────

	test('strips inline event handlers (onerror, onclick) from allowed tags', () => {
		const html = '<p onclick="alert(1)">click me</p><p onerror="bad()">x</p>';
		const sanitized = sanitizeHelpHtml(html);

		expect(sanitized).not.toContain('onclick');
		expect(sanitized).not.toContain('onerror');
		expect(sanitized).toContain('click me');
	});

	test('strips img tag with onerror XSS payload', () => {
		const html = '<img src="x" onerror="alert(document.cookie)">';
		const sanitized = sanitizeHelpHtml(html);

		expect(sanitized).not.toContain('<img');
		expect(sanitized).not.toContain('onerror');
	});

	test('strips svg elements entirely (not in allowedTags)', () => {
		const html =
			'<svg onload="alert(1)"><use href="data:image/svg+xml,&lt;svg&gt;"/></svg>';
		const sanitized = sanitizeHelpHtml(html);

		expect(sanitized).not.toContain('<svg');
		expect(sanitized).not.toContain('onload');
	});

	test('strips math elements (not in allowedTags)', () => {
		const html = '<math href="javascript:alert(1)"><mi>x</mi></math>';
		const sanitized = sanitizeHelpHtml(html);

		expect(sanitized).not.toContain('<math');
		expect(sanitized).not.toContain('javascript:');
	});

	// ──────────────── Dangerous URI schemes ────────────────

	test('strips javascript: href from anchor tags', () => {
		const html = '<a href="javascript:void(0)">click</a>';
		const sanitized = sanitizeHelpHtml(html);

		expect(sanitized).not.toContain('javascript:');
	});

	test('does not allow data: URI on anchor href (not in allowedSchemes)', () => {
		const html = '<a href="data:text/html,<script>alert(1)</script>">x</a>';
		const sanitized = sanitizeHelpHtml(html);

		// sanitize-html should strip the href when scheme is not in allowedSchemes
		expect(sanitized).not.toContain('data:');
	});

	test('does not allow vbscript: href', () => {
		const html = '<a href="vbscript:MsgBox(1)">x</a>';
		const sanitized = sanitizeHelpHtml(html);

		expect(sanitized).not.toContain('vbscript:');
	});

	// ──────────────── Style attribute injection ────────────────

	test('strips style attributes containing javascript expressions', () => {
		const html = '<div style="background:url(\'javascript:alert(1)\')">x</div>';
		const sanitized = sanitizeHelpHtml(html);

		// style attribute is not in allowedAttributes → stripped
		expect(sanitized).not.toContain('style=');
		expect(sanitized).toContain('x');
	});

	// ──────────────── wrapFullHelpDocumentInSandbox escaping ────────────────

	test('wraps full help docs into a sandboxed iframe container', () => {
		const wrapped = wrapFullHelpDocumentInSandbox(
			'Plugin Help',
			'<p>hello</p>',
		);
		expect(wrapped).toContain('<iframe');
		expect(wrapped).toContain('sandbox="allow-popups"');
		expect(wrapped).toContain('srcdoc="&lt;p&gt;hello&lt;/p&gt;"');
	});

	test('escapes double quotes in srcdoc attribute of sandbox wrapper', () => {
		const wrapped = wrapFullHelpDocumentInSandbox(
			'My Plugin',
			'<a href="https://example.com">link</a>',
		);

		expect(wrapped).toContain('&quot;https://example.com&quot;');
		expect(wrapped).not.toContain('"https://example.com"');
	});

	test('escapes angle brackets and ampersands in sandbox wrapper title', () => {
		const wrapped = wrapFullHelpDocumentInSandbox(
			'<script>alert(1)</script>',
			'<p>content</p>',
		);

		expect(wrapped).toContain('&lt;script&gt;');
		expect(wrapped).not.toContain('<script>');
	});

	test('escapes ampersand in sandbox wrapper content', () => {
		const wrapped = wrapFullHelpDocumentInSandbox('Title', '<p>A &amp; B</p>');

		// & inside srcdoc must be escaped as &amp; so the attribute is valid
		expect(wrapped).toContain('&amp;amp;');
	});

	// ──────────────── applies strict security headers ────────────────

	test('applies strict security headers to help responses', () => {
		const headers = new Map<string, string>();
		const res = {
			setHeader: (name: string, value: string) => {
				headers.set(name, value);
				return res;
			},
		};

		applyHelpPageSecurityHeaders(res as never);

		expect(headers.get('Content-Security-Policy')).toContain(
			"default-src 'none'",
		);
		expect(headers.get('X-Frame-Options')).toBe('DENY');
		expect(headers.get('Referrer-Policy')).toBe('same-origin');
	});
});
