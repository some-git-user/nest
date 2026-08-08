/**
 * Custom ESLint rule to prevent plugins from importing values from src/ implementation folders
 *
 * This rule ensures plugins remain self-contained and don't depend on
 * internal src/ implementation components, which causes runtime issues when plugins are
 * deployed separately from the main application.
 *
 * WHITELISTED imports (allowed):
 *   - Type imports (erased at runtime): import type {Something} from '../src/...'
 *   - Imports from src/types/: import {NagiosReturnCodes} from '../src/types/nagios'
 *   - Local imports: import {something} from './local-file'
 *   - Node modules: import {something} from 'node-module'
 *
 * ALL OTHER src/ imports are DISALLOWED (cause runtime errors):
 *   - src/lib/, src/components/, src/routes/, src/controllers/, src/integration/, etc.
 */

// Whitelist of src/ subfolders that plugins are allowed to import from
const ALLOWED_SRC_SUBFOLDERS = new Set(['types']);

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Prevent plugins from importing values from src/lib/, src/components/, and other implementation folders. Type imports and src/types/ imports are allowed.',
			recommended: true,
		},
		fixable: null,
		schema: [],
		messages: {
			noSrcImport:
				'Plugins cannot import values from {{folder}}. Import: {{importPath}}. Move shared utilities to a location accessible by plugins or inline the functionality. Only src/types/ imports are allowed.',
		},
	},
	create(context) {
		return {
			ImportDeclaration(node) {
				// Skip type-only imports - they are erased at runtime
				if (node.importKind === 'type') {
					return;
				}

				const importSource = node.source.value;

				// Check for relative or absolute imports from src/
				if (typeof importSource === 'string') {
					// Extract the src subfolder from the import path
					// Matches: ../src/folder/... or @src/folder/...
					const srcFolderMatch = importSource.match(/^..\/src\/([^/]+)\//);
					const absoluteSrcMatch = importSource.match(/^@src\/([^/]+)\//);

					const matchedSrcFolder =
						srcFolderMatch || absoluteSrcMatch
							? srcFolderMatch?.[1] || absoluteSrcMatch?.[1]
							: null;

					// If this is an import from src/, check if it's whitelisted
					if (matchedSrcFolder) {
						if (!ALLOWED_SRC_SUBFOLDERS.has(matchedSrcFolder)) {
							context.report({
								node: node.source,
								messageId: 'noSrcImport',
								data: {
									folder: `src/${matchedSrcFolder}/`,
									importPath: importSource,
								},
							});
						}
						// If whitelisted (e.g., 'types'), allow the import
						return;
					}
				}
			},
		};
	},
};
