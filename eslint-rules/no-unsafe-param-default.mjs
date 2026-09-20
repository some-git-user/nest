/**
 * Custom ESLint rule to reject parameter `default`s that cannot be saved as presets
 *
 * Plugin `meta.params[].default` is used in two places:
 *
 * 1. The overview page run form, which builds a URL query. A space works there
 *    because it is percent-encoded to `%20`.
 * 2. The admin editor, which prefills every parameter field with the declared
 *    default. Saving runs `validatePresetEntry()`, whose grammar forbids a
 *    newline or `#` in a value (`INVALID_VALUE_CHARACTERS` in
 *    `src/lib/local-config-store.ts`).
 *
 * A space is fine: `buildConfigLine()` wraps such a value in double quotes and
 * `tokenizeConfigLine()` strips them again, so `vdsl status` round-trips
 * through the config file intact. A newline or `#` cannot be quoted away - the
 * file is read line by line and `#` marks a comment - so a default containing
 * one would prefill the editor with a value that can never be saved.
 *
 * The rule is deliberately not fixable: the right replacement depends on the
 * parameter semantics, so the author has to pick it.
 */

const INVALID_VALUE_CHARACTERS = /[\r\n#]/;

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Forbid a newline or # in plugin param default, which the admin editor cannot save as a preset',
			recommended: true,
		},
		schema: [],
		messages: {
			unsafeDefault:
				'Param `default` {{value}} contains {{chars}}, which the local-preset config grammar cannot represent. The admin editor prefills this value and then rejects it on Test/Save. Spaces are fine (they are quoted automatically); a newline or # is not.',
		},
	},
	create(context) {
		return {
			Property(node) {
				if (node.key.type !== 'Identifier' || node.key.name !== 'default') {
					return;
				}

				const value = node.value;
				if (value.type !== 'Literal' || typeof value.value !== 'string') {
					return;
				}

				if (!INVALID_VALUE_CHARACTERS.test(value.value)) {
					return;
				}

				const found = [...new Set(value.value.match(/[\r\n#]/g))].map((char) =>
					char === '\n'
						? 'a newline'
						: char === '\r'
							? 'a carriage return'
							: char,
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
