// Standalone RuleTester sanity check for no-re-export (eslint-rules/ is not in
// the jest roots). Run from the project root so `eslint` resolves:
//   node eslint-rules/no-re-export.ruletester.mjs
import tsParser from '@typescript-eslint/parser';
import {RuleTester} from 'eslint';
import rule from './no-re-export.mjs';

const t = new RuleTester({
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
		parser: tsParser,
	},
});

t.run('no-re-export', rule, {
	valid: [
		// A plain import is fine.
		`import {foo} from './b';`,
		// A local named export (no `from`) is a definition, not a re-export.
		`const foo = 1; export {foo};`,
		// Exporting a declaration is fine.
		`export const foo = 1;`,
		`export function foo() {}`,
		// Default-exporting a local binding is fine.
		`const foo = 1; export default foo;`,
	],
	invalid: [
		// Named re-export.
		{
			code: `export {foo} from './b';`,
			errors: [{messageId: 'noReExport'}],
		},
		// Renamed re-export.
		{
			code: `export {foo as bar} from './b';`,
			errors: [{messageId: 'noReExport'}],
		},
		// Multiple names in one re-export is a single report.
		{
			code: `export {foo, bar} from './b';`,
			errors: [{messageId: 'noReExport'}],
		},
		// Star re-export.
		{
			code: `export * from './b';`,
			errors: [{messageId: 'noReExport'}],
		},
		// Namespaced star re-export.
		{
			code: `export * as ns from './b';`,
			errors: [{messageId: 'noReExport'}],
		},
		// Type re-export is still a re-export.
		{
			code: `export type {Foo} from './b';`,
			errors: [{messageId: 'noReExport'}],
		},
	],
});

console.log('no-re-export RuleTester: all cases passed');
