// Standalone RuleTester sanity check for no-index-module (eslint-rules/ is not in
// the jest roots). Run from the project root so `eslint` resolves:
//   node eslint-rules/no-index-module.ruletester.mjs
import tsParser from '@typescript-eslint/parser';
import {RuleTester} from 'eslint';
import fs from 'fs';
import os from 'os';
import path from 'path';
import rule from './no-index-module.mjs';

// The implicit directory-import check (`from './cli'`) is filesystem-dependent:
// it flags only when a real ./cli/index.* exists. Create a throwaway fixture so
// the ruletester is self-contained and does not rely on src/cli/ having an index.
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'no-index-fixture-'));
const fixtureDir = path.join(fixtureRoot, 'cli');
fs.mkdirSync(fixtureDir, {recursive: true});
fs.writeFileSync(path.join(fixtureDir, 'index.ts'), 'export const x = 1;\n');
const importerFile = path.join(fixtureRoot, 'importer.ts');

const t = new RuleTester({
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
		parser: tsParser,
	},
});

t.run('no-index-module', rule, {
	valid: [
		// A named module file importing a named module.
		{
			code: `import {runCli} from './dispatch';`,
			filename: 'src/cli/dispatch.ts',
		},
		// Explicit non-index path with extension.
		{
			code: `import {runCli} from './cli/dispatch.js';`,
			filename: 'src/server-preload.ts',
		},
		// A file named index-ish but not exactly "index".
		{
			code: `export const x = 1;`,
			filename: 'src/indexer.ts',
		},
		// require of a named module.
		{
			code: `const m = require('./dispatch');`,
			filename: 'src/foo.ts',
		},
	],
	invalid: [
		// The file itself is an index module.
		{
			code: `export const runCli = () => {};`,
			filename: 'src/cli/index.ts',
			errors: [{messageId: 'noIndexFile'}],
		},
		// Implicit index import (directory) — resolves to the fixture ./cli/index.ts.
		{
			code: `import {runCli} from './cli';`,
			filename: importerFile,
			errors: [{messageId: 'noIndexImport'}],
		},
		// Explicit index import.
		{
			code: `import {runCli} from './cli/index';`,
			filename: 'src/server-preload.ts',
			errors: [{messageId: 'noIndexImport'}],
		},
		// Explicit index import with extension.
		{
			code: `import {runCli} from './cli/index.js';`,
			filename: 'src/server-preload.ts',
			errors: [{messageId: 'noIndexImport'}],
		},
		// Type-only index import.
		{
			code: `import type {Foo} from './cli/index';`,
			filename: 'src/server-preload.ts',
			errors: [{messageId: 'noIndexImport'}],
		},
		// require of an index module.
		{
			code: `const m = require('./cli/index.js');`,
			filename: 'src/server-preload.ts',
			errors: [{messageId: 'noIndexImport'}],
		},
		// Both: an index file that also imports an index.
		{
			code: `import {x} from './other/index';`,
			filename: 'src/cli/index.ts',
			errors: [{messageId: 'noIndexFile'}, {messageId: 'noIndexImport'}],
		},
	],
});

console.log('no-index-module RuleTester: all cases passed');
fs.rmSync(fixtureRoot, {recursive: true, force: true});
