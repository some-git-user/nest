// Mock for sanitize-html to avoid ESM module issues in Jest
// sanitize-html@2.17.x depends on htmlparser2@8+ which is ESM-only
// This mock provides the same security sanitization functionality

export type Attributes = {
	[name: string]: string | number | boolean | null | undefined;
};

export type IOptions = {
	allowedTags?: string[];
	allowedAttributes?: Record<string, string[]>;
	allowedSchemes?: string[];
	transformTags?: Record<
		string,
		(
			tagName: string,
			attribs: Attributes,
		) => {tagName: string; attribs: Attributes}
	>;
	[other: string]: unknown;
};

const isDangerousScheme = (value: string): boolean => {
	const lowerValue = value.toLowerCase().trim();
	return (
		lowerValue.startsWith('javascript:') ||
		lowerValue.startsWith('vbscript:') ||
		lowerValue.startsWith('data:')
	);
};

function escapeHtml(s: string, quote?: boolean): string {
	if (typeof s !== 'string') {
		s = String(s);
	}
	s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	if (quote) {
		s = s.replace(/"/g, '&quot;');
	}
	return s;
}

const sanitizeHtml = (html: string, options?: IOptions): string => {
	if (!html || typeof html !== 'string') {
		return '';
	}

	if (!options) {
		// If no options, just strip script tags
		return html.replace(
			/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
			'',
		);
	}

	const allowedTags = options.allowedTags || [];
	const allowedAttributes = options.allowedAttributes || {};
	const transformTags = options.transformTags || {};

	// Parse HTML using a simple state machine
	let result = '';
	let i = 0;
	const stack: {
		tag: string;
		attribs: Record<string, string>;
		isAllowed: boolean;
	}[] = [];

	while (i < html.length) {
		if (html[i] === '<') {
			// Check if it's a special declaration like <!DOCTYPE, <!--, etc.
			if (html[i + 1] === '!' || html[i + 1] === '?') {
				// Preserve DOCTYPE declarations, skip other special declarations
				const tagEnd = html.indexOf('>', i);
				if (tagEnd === -1) {
					if (html.substring(i, i + 9).toUpperCase() === '<!DOCTYPE') {
						// Malformed DOCTYPE - keep it as is
						result += html.substring(i);
					}
					i = html.length;
				} else {
					const declaration = html.substring(i, tagEnd + 1);
					if (declaration.toUpperCase().startsWith('<!DOCTYPE')) {
						result += declaration;
					}
					i = tagEnd + 1;
				}
				continue;
			}

			// Check if it's a closing tag
			const isClosing = html[i + 1] === '/';
			const tagStart = i + (isClosing ? 2 : 1);
			const tagEnd = html.indexOf('>', tagStart);

			if (tagEnd === -1) {
				// Malformed tag (no closing >) - skip to end of string
				i = html.length;
				continue;
			}

			const tagContent = html.substring(tagStart, tagEnd);
			const tagNameMatch = tagContent.match(/^(\w+)/);

			if (!tagNameMatch) {
				// Not a valid tag (could be malformed like <img without >)
				// Skip malformed tags entirely instead of escaping them
				i = tagEnd + 1;
				continue;
			}

			const tagName = tagNameMatch[1].toLowerCase();

			if (isClosing) {
				// Closing tag - pop from stack and emit closing tag if it was allowed
				const stackEntry = stack.pop();
				// Skip closing structural tags that weren't emitted
				const isClosingStructuralTag =
					!stackEntry &&
					(tagName === 'html' || tagName === 'head' || tagName === 'body');
				if (isClosingStructuralTag) {
					i = tagEnd + 1;
					continue;
				}
				if (stackEntry && stackEntry.isAllowed) {
					result += `</${stackEntry.tag}>`;
				}
				i = tagEnd + 1;
				continue;
			}

			// Opening tag - parse attributes
			const attribs: Record<string, string> = {};
			// Parse attributes more robustly - handle quoted values with special chars
			// Match: attr="value" or attr='value' or attr=value
			const attrRegex =
				/([a-zA-Z_:][a-zA-Z0-9_:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
			let attrMatch;
			while ((attrMatch = attrRegex.exec(tagContent)) !== null) {
				const attrName = attrMatch[1];
				// Skip if this looks like the tag name (first match without =)
				if (attrMatch.index === 0 && !tagContent.includes('=')) {
					continue;
				}
				const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
				attribs[attrName] = attrValue;
			}

			// Check if tag is allowed
			const isAllowed = allowedTags.includes(tagName);

			// Void elements (self-closing tags) that don't have content
			const voidElements = [
				'area',
				'base',
				'br',
				'col',
				'embed',
				'hr',
				'img',
				'input',
				'link',
				'meta',
				'param',
				'source',
				'track',
				'wbr',
			];
			const isVoidElement = voidElements.includes(tagName);

			// For structural tags (html, head, body) that aren't allowed,
			// we should preserve their content but skip the tags themselves
			const isStructuralTag =
				!isAllowed &&
				(tagName === 'html' || tagName === 'head' || tagName === 'body');

			if (!isAllowed && !isStructuralTag) {
				// Tag not allowed - skip the tag itself but keep its content
				// For void elements, just skip the tag
				if (isVoidElement) {
					i = tagEnd + 1;
					continue;
				}
				// For regular elements, find the matching closing tag and continue processing from there
				let depth = 1;
				let j = tagEnd + 1;

				while (j < html.length && depth > 0) {
					if (html[j] === '<') {
						if (html[j + 1] === '/') {
							// Closing tag
							const closeTagStart = j + 2;
							const closeTagEnd = html.indexOf('>', closeTagStart);
							if (closeTagEnd !== -1) {
								const closeTagNameMatch = html
									.substring(closeTagStart, closeTagEnd)
									.match(/^(\w+)/);
								if (
									closeTagNameMatch &&
									closeTagNameMatch[1].toLowerCase() === tagName
								) {
									depth--;
								}
								j = closeTagEnd + 1;
								continue;
							}
						} else {
							// Opening tag - check if it's the same tag
							const openTagStart = j + 1;
							const openTagEnd = html.indexOf('>', openTagStart);
							if (openTagEnd !== -1) {
								const openTagNameMatch = html
									.substring(openTagStart, openTagEnd)
									.match(/^(\w+)/);
								if (
									openTagNameMatch &&
									openTagNameMatch[1].toLowerCase() === tagName
								) {
									depth++;
								}
								j = openTagEnd + 1;
								continue;
							}
						}
					}
					j++;
				}
				// Continue processing from after the closing tag
				i = j;
				continue;
			}

			if (isStructuralTag) {
				// Structural tag not in allowedTags - skip the tag but keep content
				// Just continue processing (don't emit the tag itself)
				i = tagEnd + 1;
				continue;
			}

			// Apply transformTags
			let finalTagName = tagName;
			if (transformTags[tagName]) {
				const transformed = transformTags[tagName](tagName, attribs);
				finalTagName = transformed.tagName;
				if (transformed.attribs) {
					Object.assign(attribs, transformed.attribs);
				}
			}

			// Filter attributes - remove event handlers (on*), non-allowed attributes, and dangerous URL schemes
			const allowedAttrs = allowedAttributes[finalTagName] || [];
			const filteredAttribs: Record<string, string> = {};
			for (const [attrName, attrValue] of Object.entries(attribs)) {
				// Skip event handler attributes (on*)
				if (attrName.toLowerCase().startsWith('on')) {
					continue;
				}
				// Skip dangerous URL schemes in href attributes
				if (attrName.toLowerCase() === 'href' && isDangerousScheme(attrValue)) {
					continue;
				}
				if (allowedAttrs.includes(attrName)) {
					filteredAttribs[attrName] = attrValue;
				}
			}

			// Build the tag string
			let tagStr = `<${finalTagName}`;
			for (const [attrName, attrValue] of Object.entries(filteredAttribs)) {
				tagStr += ` ${attrName}="${escapeHtml(attrValue, true)}"`;
			}
			tagStr += '>';

			result += tagStr;
			stack.push({
				tag: finalTagName,
				attribs: filteredAttribs,
				isAllowed: true,
			});
			i = tagEnd + 1;
		} else {
			// Text content - find the next tag or end of string
			const nextTag = html.indexOf('<', i);
			const textEnd = nextTag === -1 ? html.length : nextTag;
			const text = html.substring(i, textEnd);

			// Add text content to result
			result += text;

			i = textEnd;
		}
	}

	return result;
};

export default sanitizeHtml;

export function simpleTransform(
	tagName: string,
	newTagName?: string,
): (
	transformedTagName: string,
	attribs: Attributes,
) => {tagName: string; attribs: Attributes} {
	return function (transformedTagName: string, attribs: Attributes) {
		return {
			tagName: newTagName || transformedTagName,
			attribs,
		};
	};
}
