/**
 * Custom ESLint rule to enforce explicit PluginMeta type annotation on exported `meta` variables
 *
 * This rule ensures that plugin files have:
 *   export const meta: PluginMeta = { ... }
 *
 * Instead of:
 *   export const meta = { ... }
 *   const meta: PluginMeta = { ... }
 *   const meta = { ... }
 */

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require explicit PluginMeta type annotation on exported meta variables',
			recommended: true,
		},
		fixable: 'code',
		schema: [],
		messages: {
			missingTypeAnnotation:
				'Exported `meta` variable must have explicit `PluginMeta` type annotation. Use: `export const meta: PluginMeta = { ... }`',
			missingExport:
				'`meta` variable must be exported. Use: `export const meta: PluginMeta = { ... }`',
		},
	},
	create(context) {
		return {
			VariableDeclaration(node) {
				// Only check declarations with meta
				if (!node.declarations.length) return;

				const declarator = node.declarations[0];

				// Check if this is a variable named 'meta'
				if (declarator.type !== 'VariableDeclarator') return;
				if (
					declarator.id.type !== 'Identifier' ||
					declarator.id.name !== 'meta'
				) {
					return;
				}

				// Check if it's exported
				const isExported = context.sourceCode
					.getAncestors(declarator)
					.some((parent) => parent.type === 'ExportNamedDeclaration');

				// Check if it already has a type annotation
				const hasTypeAnnotation = declarator.id.typeAnnotation !== undefined;

				if (isExported) {
					// Exported meta must have type annotation
					if (!hasTypeAnnotation) {
						context.report({
							node: declarator,
							messageId: 'missingTypeAnnotation',
							fix: (fixer) => {
								// Add `: PluginMeta` after the identifier name
								const range = declarator.id.range;
								return fixer.insertTextAfterRange(
									[range[0], range[1] - 1],
									': PluginMeta',
								);
							},
						});
					}
				} else if (node.declarations.some((decl) => decl.id.name === 'meta')) {
					// Non-exported meta is an error
					context.report({
						node: declarator,
						messageId: 'missingExport',
					});
				}
			},
		};
	},
};
