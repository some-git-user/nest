/**
 * Custom ESLint rule to reject example `defaultValue`s that cannot be saved as presets
 *
 * Plugin `meta.examples[].fields[].defaultValue` is used in two places:
 *
 * 1. The overview page example form, which builds a URL query. A space works
 *    there because it is percent-encoded to `%20`.
 * 2. The admin editor, which prefills every parameter field with the declared
 *    default. Saving runs `validatePresetEntry()`, whose grammar forbids
 *    whitespace and `#` in a value (`INVALID_VALUE_CHARACTERS` in
 *    `src/lib/local-config-store.ts`) because `parseConfigLine()` splits on
 *    whitespace with no quoting support.
 *
 * A default containing a space therefore prefills the editor with a value that
 * can never be saved: the Test/Save buttons fail with "may not contain
 * whitespace or #". Replacing the space with `+` is NOT a fix either - nothing
 * decodes `+` back to a space, and `makeInternalRequest()` percent-encodes it
 * to `%2B`, so the plugin receives a literal `+`.
 *
 * The rule is deliberately not fixable: the right replacement depends on the
 * parameter semantics (a regex can use `.`, a plain string needs a different
 * wording), so the author has to pick it.
 */

const INVALID_VALUE_CHARACTERS = /[\s#]/;

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Forbid whitespace or # in plugin example defaultValue, which the admin editor cannot save as a preset',
			recommended: true,
		},
		schema: [],
		messages: {
			unsafeDefault:
				'Example `defaultValue` {{value}} contains {{chars}}, which the local-preset config grammar forbids. The admin editor prefills this value and then rejects it on Test/Save. Use a value without whitespace or # (a regex can use "." to match a space; "+" is NOT decoded back to a space).',
		},
	},
	create(context) {
		return {
			Property(node) {
				if (
					node.key.type !== 'Identifier' ||
					node.key.name !== 'defaultValue'
				) {
					return;
				}

				const value = node.value;
				if (value.type !== 'Literal' || typeof value.value !== 'string') {
					return;
				}

				if (!INVALID_VALUE_CHARACTERS.test(value.value)) {
					return;
				}

				const found = [...new Set(value.value.match(/[\s#]/g))].map((char) =>
					char === ' ' ? 'a space' : char === '\n' ? 'a newline' : char,
				);

				context.report({
					node: value,
					messageId: 'unsafeDefault',
					data: {
						value: JSON.stringify(value.value),
						chars: found.join(', '),
					},
				});
			},
		};
	},
};
