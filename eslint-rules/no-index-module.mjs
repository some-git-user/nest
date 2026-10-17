/**
 * Custom ESLint rule to forbid `index.*` module files and index imports.
 *
 * An `index.ts` is an invisible, ambiguous name: every directory ends up with a
 * file called `index`, so the name carries zero information about what the
 * module contains. It also enables barrel imports (`from './cli'`) that hide
 * which concrete file a symbol lives in — the same "where is this defined?"
 * problem this project already bans for re-exports (`custom/no-re-export`).
 *
 * This project bans index module files outright. Give every module a name that
 * describes what it exports, and import that name explicitly.
 *
 * FLAGGED:
 *   - A file whose own basename is `index` (index.ts, index.tsx, index.js, ...).
 *   - An import/export/require whose source resolves to an index module:
 *       import {x} from './cli'          // implicit index
 *       import {x} from './cli/index'    // explicit index
 *       import {x} from './cli/index.js'
 *
 * ALLOWED:
 *   import {runCli} from './cli/dispatch'
 */
import fs from 'fs';
import path from 'path';

// Last path segment is `index` with no extension, or with a JS/TS extension.
const INDEX_SOURCE = /(?:^|\/)index(?:\.[cm]?[jt]sx?)?$/;

// Basenames Node/TS resolve for a bare directory import, in resolution order.
const INDEX_FILENAMES = [
	'index.ts',
	'index.tsx',
	'index.mts',
	'index.cts',
	'index.js',
	'index.jsx',
	'index.mjs',
	'index.cjs',
];

const isIndexBasename = (filePath) => {
	// Normalise separators, then take the basename without its extension.
	const base = filePath.split(/[/\\]/).pop() ?? '';
	const withoutExt = base.replace(/\.[cm]?[jt]sx?$/, '');
	return withoutExt === 'index';
};

/**
 * True when `importPath`, resolved from the importing `filename`, points at an
 * index module — either explicitly (`.../index`), or implicitly because the
 * resolved target is a directory that contains an `index.*` file.
 */
const resolvesToIndex = (importPath, filename) => {
	if (INDEX_SOURCE.test(importPath)) {
		return true;
	}

	// Implicit directory imports only apply to relative specifiers.
	if (!importPath.startsWith('.')) {
		return false;
	}

	const baseDir = path.dirname(filename);
	if (baseDir === filename) {
		// No directory component (e.g. filename is a bare name in tests).
		return false;
	}

	const resolved = path.resolve(baseDir, importPath);

	// `./x/index` already matched above; this catches a resolved basename of index.
	if (isIndexBasename(resolved)) {
		return true;
	}

	// `./cli` -> flag only if a real ./cli/index.* exists on disk.
	try {
		if (!fs.statSync(resolved).isDirectory()) {
			return false;
		}
	} catch {
		return false;
	}

	return INDEX_FILENAMES.some((name) =>
		fs.existsSync(path.join(resolved, name)),
	);
};

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Forbid index.* module files and imports that resolve to an index module.',
			recommended: true,
		},
		fixable: null,
		schema: [],
		messages: {
			noIndexFile:
				'Do not create an index module ({{name}}). Give the file a name that describes what it exports, and import that name explicitly.',
			noIndexImport:
				'Do not import from an index module ({{importPath}}). Import from the concrete module that defines the symbol.',
		},
	},
	create(context) {
		const filename = context.physicalFilename || context.filename || '';

		const checkSource = (node, importPath) => {
			if (
				typeof importPath === 'string' &&
				resolvesToIndex(importPath, filename)
			) {
				context.report({
					node,
					messageId: 'noIndexImport',
					data: {importPath},
				});
			}
		};

		return {
			Program(node) {
				if (isIndexBasename(filename)) {
					const base = filename.split(/[/\\]/).pop() ?? 'index';
					context.report({
						node,
						loc: {start: {line: 1, column: 0}},
						messageId: 'noIndexFile',
						data: {name: base},
					});
				}
			},
			'ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration'(node) {
				checkSource(node.source, node.source?.value);
			},
			CallExpression(node) {
				if (
					node.callee.type !== 'Identifier' ||
					node.callee.name !== 'require'
				) {
					return;
				}

				const arg = node.arguments[0];
				if (arg && arg.type === 'Literal') {
					checkSource(arg, arg.value);
				}
			},
		};
	},
};
