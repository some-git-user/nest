/**
 * Custom ESLint rule to forbid re-exports (`export ... from '...'`).
 *
 * A re-export makes one module pretend to own a symbol that actually lives in
 * another. That hides the real dependency: a caller imports `./a` while the code
 * it runs comes from `./b`, so import graphs, test mocks, and "where is this
 * defined?" all point at the wrong file. It is also the lazy fix for duplicated
 * logic — instead of one implementation, you get a forwarding stub.
 *
 * This project bans the pattern outright. Import the symbol from the module that
 * defines it. If two modules need the same helper, keep the single implementation
 * in one place and import it directly from there at each call site.
 *
 * FLAGGED:
 *   export {foo} from './b'
 *   export {foo as bar} from './b'
 *   export * from './b'
 *   export * as ns from './b'
 *   export type {Foo} from './b'   (type re-exports are re-exports too)
 *
 * ALLOWED (these are definitions, not re-exports):
 *   export const foo = ...
 *   export {foo}            // local binding, no `from`
 *   import {foo} from './b' // imports are fine
 */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Forbid re-exports (export ... from). Import symbols from the module that defines them.',
			recommended: true,
		},
		fixable: null,
		schema: [],
		messages: {
			noReExport:
				'Re-export is not allowed ({{snippet}}). Import "{{symbol}}" from the module that defines it ({{importPath}}) instead of forwarding it through this file.',
		},
	},
	create(context) {
		const report = (node, symbol) => {
			const importPath = node.source?.value ?? '';
			const snippet = context
				.getSourceCode()
				.getText(node)
				.replace(/\s+/g, ' ')
				.trim();
			context.report({
				node: node.source ?? node,
				messageId: 'noReExport',
				data: {symbol, importPath, snippet},
			});
		};

		return {
			// export * from './b'  and  export * as ns from './b'
			ExportAllDeclaration(node) {
				const namespace = node.exported ? `* as ${node.exported.name}` : '*';
				report(node, namespace);
			},
			// export {foo} from './b'  (a named export with a source is a re-export)
			ExportNamedDeclaration(node) {
				if (!node.source) {
					return;
				}

				const names = node.specifiers
					.map((specifier) => {
						const imported =
							specifier.imported?.name ?? specifier.local?.name ?? '?';
						const exported = specifier.local?.name ?? imported;
						return imported === exported
							? imported
							: `${imported} as ${exported}`;
					})
					.join(', ');

				report(node, names.length > 0 ? names : '{}');
			},
		};
	},
};
