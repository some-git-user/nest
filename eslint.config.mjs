import {FlatCompat} from '@eslint/eslintrc';
import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import pluginPromise from 'eslint-plugin-promise';
import globals from 'globals';
import path from 'path';
import {fileURLToPath} from 'url';

// Construct __dirname equivalent for ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
	baseDirectory: __dirname,
});

// Load custom ESLint rules
const enforcePluginMetaType = (
	await import(
		path.join(__dirname, 'eslint-rules/enforce-plugin-meta-type.mjs')
	)
).default;

const enforceGetErrorMessage = (
	await import(
		path.join(__dirname, 'eslint-rules/enforce-get-error-message.mjs')
	)
).default;

const noSrcImports = (
	await import(path.join(__dirname, 'eslint-rules/no-src-imports.mjs'))
).default;

const noShellExec = (
	await import(path.join(__dirname, 'eslint-rules/no-shell-exec.mjs'))
).default;

const noUnsafeExampleDefault = (
	await import(
		path.join(__dirname, 'eslint-rules/no-unsafe-example-default.mjs')
	)
).default;

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
			'src/types/*.d.ts',
			'**/*.test.ts',
			'**/*.test.tsx',
			'**/*.spec.ts',
			'**/*.spec.tsx',
			'__mocks__/**',
			'standalone/*.js',
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
		files: ['**/*.mjs'], // JavaScript modules (ESM)
		languageOptions: {
			globals: {
				...globals.node, // Add Node.js globals (process, console, etc.)
			},
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
					argsIgnorePattern: '^_?',
					varsIgnorePattern: '^_?',
					caughtErrorsIgnorePattern: '^_?',
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
			'@typescript-eslint/no-unsafe-assignment': 'warn',
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unsafe-member-access': 'warn',
			'@typescript-eslint/no-unsafe-call': 'warn',
			'@typescript-eslint/no-unsafe-return': 'warn',
			'@typescript-eslint/no-unsafe-argument': 'warn',
		},
	},
	{
		files: ['src/**/*.ts', 'src/**/*.tsx'], // Apply only to src folder
		plugins: {
			custom: {
				rules: {
					'enforce-get-error-message': enforceGetErrorMessage,
					'no-shell-exec': noShellExec,
				},
			},
		},
		rules: {
			// Enforce use of shared getErrorMessage() function (src only)
			'custom/enforce-get-error-message': 'error',
			// Forbid shell-based child_process execution (command injection)
			'custom/no-shell-exec': 'error',
			// Only require explicit return types on exported functions (module boundaries)
			// This allows internal helper functions to use type inference
			'@typescript-eslint/explicit-module-boundary-types': [
				'error',
				{
					// Allow functions with explicit return type annotations
					allowTypedFunctionExpressions: true,
					// Allow higher order functions (functions returning functions)
					allowHigherOrderFunctions: true,
				},
			],
			// Disable the overly strict explicit-function-return-type rule
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/typedef': 'warn',
		},
	},
	{
		files: ['plugins/**/*.ts'],
		plugins: {
			custom: {
				rules: {
					'enforce-plugin-meta-type': enforcePluginMetaType,
					'no-src-imports': noSrcImports,
					'no-shell-exec': noShellExec,
					'no-unsafe-example-default': noUnsafeExampleDefault,
				},
			},
		},
		rules: {
			// Custom rule to enforce explicit PluginMeta type on exported meta variables
			'custom/enforce-plugin-meta-type': 'error',
			// Prevent plugins from importing from src folder
			'custom/no-src-imports': 'error',
			// Forbid shell-based child_process execution (command injection)
			'custom/no-shell-exec': 'error',
			// Example defaultValues must be saveable as local presets (no space/#)
			'custom/no-unsafe-example-default': 'error',
		},
	},
];
