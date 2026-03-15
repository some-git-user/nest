import {FlatCompat} from '@eslint/eslintrc';
import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import pluginPromise from 'eslint-plugin-promise';
import path from 'path';
import {fileURLToPath} from 'url';

// Construct __dirname equivalent for ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
	baseDirectory: __dirname,
});

const tsRecommendedConfigs = compat
	.extends(
		'plugin:@typescript-eslint/recommended',
		'plugin:@typescript-eslint/recommended-type-checked',
	)
	.map((config) => ({
		...config,
		files: ['**/*.ts', '**/*.tsx'],
	}));

export default [
	{
		ignores: [
			'dist/**',
			'coverage/**',
			'node_modules/**',
			'.github/**',
			'plugins/*.js',
			'plugins/**/*.js',
		],
	},
	js.configs.recommended, // ESLint recommended config for JavaScript
	...tsRecommendedConfigs,
	...compat.extends('prettier'), // Extending the Prettier config for ESLint
	pluginPromise.configs['flat/recommended'],
	{
		files: ['**/*.{js,mjs,cjs,ts,tsx}'],
		rules: {
			'promise/prefer-await-to-then': 'error', // Enforce async/await in JS and TS
		},
	},
	{
		files: ['**/*.ts', '**/*.tsx'], // Apply to TypeScript files
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 2026,
				sourceType: 'module',
				tsconfigRootDir: __dirname, // root for resolving tsconfig.json
				project: ['./tsconfig.json', './tsconfig.plugins.json'], // enable type-aware linting for main + plugins
			},
		},
		plugins: {
			'@typescript-eslint': typescript,
		},
		rules: {
			semi: ['warn', 'always'],
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					ignoreRestSiblings: true,
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			curly: ['error', 'all'],
			'brace-style': ['error', '1tbs', {allowSingleLine: false}],
			'@typescript-eslint/no-unnecessary-type-assertion': 'error',
			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{
					assertionStyle: 'as',
					objectLiteralTypeAssertions: 'never',
				},
			],
		},
	},
];
