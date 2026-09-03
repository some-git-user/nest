import {
	renderBanner,
	renderButton,
	renderField,
	renderHtmlDocument,
	renderMetaList,
	renderStatus,
	renderToolbar,
} from './ui-components';
import {APP_STYLESHEET} from './ui-theme';

describe('renderButton', () => {
	it('renders a plain button by default', () => {
		expect(renderButton({label: 'Run'})).toBe(
			'<button type="button">Run</button>',
		);
	});

	it('maps the variants onto their class names', () => {
		expect(renderButton({label: 'Save', variant: 'primary'})).toBe(
			'<button type="button" class="primary">Save</button>',
		);
		expect(renderButton({label: 'Revert', variant: 'danger'})).toBe(
			'<button type="button" class="danger">Revert</button>',
		);
		expect(renderButton({label: 'Test', variant: 'default'})).toBe(
			'<button type="button">Test</button>',
		);
	});

	it('supports submit buttons, ids, data attributes, labels and disabled state', () => {
		expect(
			renderButton({
				label: 'Sign in',
				variant: 'primary',
				type: 'submit',
				id: 'loginButton',
				data: {action: 'login', index: '2'},
				ariaLabel: 'Sign in to the admin UI',
				disabled: true,
			}),
		).toBe(
			'<button type="submit" class="primary" id="loginButton" data-action="login" data-index="2" aria-label="Sign in to the admin UI" disabled>Sign in</button>',
		);
	});

	it('escapes the label', () => {
		expect(renderButton({label: '<b>go</b>'})).toBe(
			'<button type="button">&lt;b&gt;go&lt;/b&gt;</button>',
		);
	});
});

describe('renderField', () => {
	it('renders a minimal labelled input', () => {
		expect(renderField({name: 'key', label: 'Key'})).toBe(
			'<label class="field"><span class="field-label">Key</span><input name="key" type="text"></label>',
		);
	});

	it('renders every optional attribute', () => {
		expect(
			renderField({
				name: 'adminPassword',
				label: 'Admin password',
				type: 'password',
				value: 'a"b',
				required: true,
				hint: 'Stored locally',
				placeholder: 'e.g. secret',
				autocomplete: 'current-password',
			}),
		).toBe(
			'<label class="field"><span class="field-label">Admin password<span class="required" title="Required field">*</span></span><input name="adminPassword" type="password" value="a&quot;b" placeholder="e.g. secret" autocomplete="current-password" required><span class="hint">Stored locally</span></label>',
		);
	});

	it('keeps an empty value or placeholder rather than dropping it', () => {
		const html = renderField({
			name: 'n',
			label: 'N',
			value: '',
			placeholder: '',
		});

		expect(html).toContain('value=""');
		expect(html).toContain('placeholder=""');
	});

	it('escapes the label', () => {
		expect(renderField({name: 'n', label: '<b>N</b>'})).toContain(
			'<span class="field-label">&lt;b&gt;N&lt;/b&gt;</span>',
		);
	});
});

describe('renderToolbar', () => {
	it('wraps pre-rendered buttons', () => {
		expect(renderToolbar('<button>a</button>')).toBe(
			'<div class="toolbar"><button>a</button></div>',
		);
	});
});

describe('renderBanner', () => {
	it('renders an error banner by default', () => {
		expect(renderBanner({title: 'Broken'})).toBe(
			'<section class="banner"><h2>Broken</h2></section>',
		);
	});

	it('maps the non-error kinds onto a modifier class', () => {
		expect(renderBanner({kind: 'error', title: 'Broken'})).toBe(
			'<section class="banner"><h2>Broken</h2></section>',
		);
		expect(
			renderBanner({kind: 'ok', title: 'In sync', bodyHtml: '<p>Yes</p>'}),
		).toBe('<section class="banner ok"><h2>In sync</h2><p>Yes</p></section>');
		expect(renderBanner({kind: 'warn', title: 'Drift'})).toBe(
			'<section class="banner warn"><h2>Drift</h2></section>',
		);
	});

	it('escapes the title', () => {
		expect(renderBanner({title: '<i>x</i>'})).toContain(
			'<h2>&lt;i&gt;x&lt;/i&gt;</h2>',
		);
	});
});

describe('renderStatus', () => {
	it('renders a hidden status host with the given id', () => {
		expect(renderStatus('status')).toBe(
			'<div id="status" class="status"></div>',
		);
	});
});

describe('renderMetaList', () => {
	it('renders nothing for an empty list', () => {
		expect(renderMetaList([])).toBe('<div class="page-meta"></div>');
	});

	it('pairs each label with a pre-rendered value', () => {
		expect(
			renderMetaList([
				{label: 'Version', valueHtml: '<code>1.2.3</code>'},
				{label: 'Origin', valueHtml: '<a href="x">x</a>'},
			]),
		).toBe(
			'<div class="page-meta"><span>Version <code>1.2.3</code></span><span>Origin <a href="x">x</a></span></div>',
		);
	});

	it('escapes the label', () => {
		expect(renderMetaList([{label: '<b>a</b>', valueHtml: ''}])).toContain(
			'<span>&lt;b&gt;a&lt;/b&gt; </span>',
		);
	});
});

describe('renderHtmlDocument', () => {
	it('emits the shared shell with the stylesheet embedded once', () => {
		const html = renderHtmlDocument({
			title: 'Overview',
			contentHtml: '<p>Body</p>',
		});

		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('<html lang="en">');
		expect(html).toContain(
			'<meta name="viewport" content="width=device-width, initial-scale=1">',
		);
		expect(html).toContain('<title>Overview</title>');
		expect(html.match(/<style>/g)).toHaveLength(1);
		expect(html).toContain(APP_STYLESHEET);
		expect(html).toContain(
			'<header class="page-header"><h1>Overview</h1></header>',
		);
		expect(html).toContain('<p>Body</p>');
		expect(html.endsWith('</body>\n</html>')).toBe(true);
	});

	it('omits the header for content that brings its own h1', () => {
		const html = renderHtmlDocument({
			title: 'Plugin help',
			hideHeader: true,
			contentHtml: '<h1>Setup Guide</h1>',
		});

		expect(html).not.toContain('<header');
		expect(html).toContain('<h1>Setup Guide</h1>');
	});

	it('renders a back link with a default label', () => {
		const html = renderHtmlDocument({
			title: 'Help',
			backHref: '/',
			contentHtml: '',
		});

		expect(html).toContain(
			'<p class="crumbs"><a href="/">Back to route overview</a></p>',
		);
	});

	it('accepts a custom back label', () => {
		const html = renderHtmlDocument({
			title: 'Help',
			backHref: '/plugins',
			backLabel: 'Back to plugins',
			contentHtml: '',
		});

		expect(html).toContain(
			'<p class="crumbs"><a href="/plugins">Back to plugins</a></p>',
		);
	});

	it('renders a subtitle and header meta', () => {
		const html = renderHtmlDocument({
			title: 'Admin',
			subtitle: 'Edit the presets file.',
			metaHtml: '<button>Sign out</button>',
			contentHtml: '',
		});

		expect(html).toContain('<p class="muted">Edit the presets file.</p>');
		expect(html).toContain('<h1>Admin</h1><button>Sign out</button></header>');
	});

	it('overrides the measure and appends page specific styles', () => {
		const html = renderHtmlDocument({
			title: 'Admin',
			contentHtml: '',
			maxPageWidth: '68rem',
			extraStyles: '\n.entry{background:red}',
			headHtml: '\n<script src="/admin/local-config.js" defer></script>',
		});

		expect(html).toContain(
			'</style><style>:root{--page-max-width:68rem}</style>',
		);
		expect(html).toContain('.entry{background:red}');
		expect(html).toContain(
			'<script src="/admin/local-config.js" defer></script>',
		);
	});

	it('escapes the title', () => {
		const html = renderHtmlDocument({
			title: '<script>x</script>',
			contentHtml: '',
		});

		expect(html).toContain('<title>&lt;script&gt;x&lt;/script&gt;</title>');
		expect(html).not.toContain('<title><script>');
	});
});
