/**
 * Reusable markup for the server-rendered pages.
 *
 * Every page in this app is a string built on the server, so "components" here
 * are functions returning HTML fragments rather than framework components. They
 * exist so that a card, a field or a banner looks the same on the route
 * overview, on a plugin help page and in the admin UI, and so a change to one
 * of them propagates to all three.
 *
 * Conventions:
 * - Every value is escaped here; a caller never escapes what it passes in.
 * - Fragments are *not* wrapped in a document. `renderHtmlDocument()` is the
 *   only place that emits `<html>`, and it is the only place that embeds the
 *   stylesheet.
 * - `*Html` suffixed options are pre-rendered fragments from these functions,
 *   never user input.
 */
import {escapeHtml} from './html-escape';
import {APP_STYLESHEET} from './ui-theme';

export type ButtonVariant = 'default' | 'primary' | 'danger';

export type UiElementOptions = {
	/** `data-*` attributes to attach. Keys are literal, values are escaped. */
	data?: Record<string, string>;
	/** Element `id`, for scripts and labels. */
	id?: string;
};

const renderDataAttributes = (
	data: Record<string, string> | undefined,
): string => {
	if (!data) {
		return '';
	}

	return Object.entries(data)
		.map(([key, value]) => ` data-${escapeHtml(key)}="${escapeHtml(value)}"`)
		.join('');
};

const renderIdAttribute = (id: string | undefined): string =>
	id ? ` id="${escapeHtml(id)}"` : '';

export type ButtonOptions = UiElementOptions & {
	label: string;
	variant?: ButtonVariant;
	type?: 'submit' | 'button';
	disabled?: boolean;
	/** `aria-label` for icon-only or ambiguous buttons. */
	ariaLabel?: string;
};

export const renderButton = (options: ButtonOptions): string => {
	const variantClass =
		options.variant && options.variant !== 'default'
			? ` class="${options.variant}"`
			: '';
	const disabledAttr = options.disabled ? ' disabled' : '';
	const ariaLabelAttr = options.ariaLabel
		? ` aria-label="${escapeHtml(options.ariaLabel)}"`
		: '';

	return `<button type="${options.type ?? 'button'}"${variantClass}${renderIdAttribute(
		options.id,
	)}${renderDataAttributes(options.data)}${ariaLabelAttr}${disabledAttr}>${escapeHtml(
		options.label,
	)}</button>`;
};

export type FieldOptions = UiElementOptions & {
	name: string;
	label: string;
	type?: string;
	value?: string;
	required?: boolean;
	/** Explanatory line under the input. */
	hint?: string;
	placeholder?: string;
	autocomplete?: string;
};

/**
 * A labelled input.
 *
 * The label wraps the control, so no `for`/`id` pairing is needed and the whole
 * row stays clickable. `required` only marks the field visually and adds the
 * native constraint: the red `:invalid` ring is suppressed in the stylesheet and
 * replaced by `aria-invalid`, so an untouched form does not look broken.
 */
export const renderField = (options: FieldOptions): string => {
	const requiredMark = options.required
		? '<span class="required" title="Required field">*</span>'
		: '';
	const attributes = [
		`name="${escapeHtml(options.name)}"`,
		`type="${escapeHtml(options.type ?? 'text')}"`,
		options.value !== undefined ? `value="${escapeHtml(options.value)}"` : '',
		options.placeholder !== undefined
			? `placeholder="${escapeHtml(options.placeholder)}"`
			: '',
		options.autocomplete
			? `autocomplete="${escapeHtml(options.autocomplete)}"`
			: '',
		options.required ? 'required' : '',
	]
		.filter((attribute) => attribute.length > 0)
		.join(' ');
	const hintHtml = options.hint
		? `<span class="hint">${escapeHtml(options.hint)}</span>`
		: '';

	return `<label class="field"><span class="field-label">${escapeHtml(
		options.label,
	)}${requiredMark}</span><input ${attributes}>${hintHtml}</label>`;
};

/**
 * A row of actions. `renderButton()` output belongs in here.
 */
export const renderToolbar = (buttonsHtml: string): string =>
	`<div class="toolbar">${buttonsHtml}</div>`;

export type BannerKind = 'error' | 'ok' | 'warn';

export type BannerOptions = {
	kind?: BannerKind;
	title: string;
	/** Pre-rendered fragment shown under the title. */
	bodyHtml?: string;
};

/**
 * A full-width callout for state the operator has to notice: config drift,
 * startup warnings, a saved file awaiting approval.
 */
export const renderBanner = (options: BannerOptions): string => {
	const kindClass =
		options.kind && options.kind !== 'error' ? ` ${options.kind}` : '';

	return `<section class="banner${kindClass}"><h2>${escapeHtml(
		options.title,
	)}</h2>${options.bodyHtml ?? ''}</section>`;
};

/**
 * The inline result line used by the admin editor. Hidden until the client
 * script adds `show`, which is why it needs a stable `id`.
 */
export const renderStatus = (id: string): string =>
	`<div id="${escapeHtml(id)}" class="status"></div>`;

export type PageOptions = {
	title: string;
	/** Pre-rendered page body. */
	contentHtml: string;
	/**
	 * Skip the header band. For content that brings its own `<h1>`, such as a
	 * plugin help fragment: two headings stacked is one too many.
	 */
	hideHeader?: boolean;
	/**
	 * Short muted line under the title, e.g. what a page is for.
	 */
	subtitle?: string;
	/** Pre-rendered fragment for the right side of the header band. */
	metaHtml?: string;
	/** Renders a "back" link above the header. Omit on the route overview. */
	backHref?: string;
	backLabel?: string;
	/**
	 * CSS length overriding the default measure. Only the wide editors need it;
	 * everything else shares one width so the pages feel like one app.
	 */
	maxPageWidth?: string;
	/**
	 * Page-specific rules appended after the shared stylesheet. Use it only for
	 * a rule that genuinely has no shared equivalent - a page that redefines a
	 * shared selector is drift by another name.
	 */
	extraStyles?: string;
	/** Additional pre-rendered `<head>` children, e.g. a `<script src>` tag. */
	headHtml?: string;
};

/**
 * The document shell shared by every page: doctype, meta, title and the one
 * copy of the stylesheet.
 */
export const renderHtmlDocument = (options: PageOptions): string => {
	const styleOverride = options.maxPageWidth
		? `<style>:root{--page-max-width:${escapeHtml(options.maxPageWidth)}}</style>`
		: '';
	const backHtml = options.backHref
		? `<p class="crumbs"><a href="${escapeHtml(options.backHref)}">${escapeHtml(
				options.backLabel ?? 'Back to route overview',
			)}</a></p>`
		: '';
	const subtitleHtml = options.subtitle
		? `<p class="muted">${escapeHtml(options.subtitle)}</p>`
		: '';
	const headerHtml = options.hideHeader
		? ''
		: `<header class="page-header"><h1>${escapeHtml(
				options.title,
			)}</h1>${options.metaHtml ?? ''}</header>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<style>${APP_STYLESHEET}${
		options.extraStyles ?? ''
	}</style>${styleOverride}${options.headHtml ?? ''}
</head>
<body>
${backHtml}${headerHtml}
${subtitleHtml}${options.contentHtml}
</body>
</html>`;
};

/**
 * The key/value band on the right side of a page header: where a page states
 * the facts a reader scans first (version, origin, target URL).
 *
 * `valueHtml` is a pre-rendered fragment rather than a plain string because the
 * values are usually links or `<code>`, not bare text.
 */
export const renderMetaList = (
	items: {label: string; valueHtml: string}[],
): string => {
	return `<div class="page-meta">${items
		.map((item) => `<span>${escapeHtml(item.label)} ${item.valueHtml}</span>`)
		.join('')}</div>`;
};
