import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

// vm mock: return the configured plugin module when a plugin is executed.
let currentPluginModule: unknown = undefined;
jest.mock('vm', () => ({
	createContext: (ctx: unknown) => ctx,
	runInContext: (_code: string, context: unknown) => {
		const ctx = context as {module?: {exports: Record<string, unknown>}};
		if (!ctx.module) {
			ctx.module = {exports: {}};
		}

		if (currentPluginModule && typeof currentPluginModule === 'object') {
			ctx.module.exports = currentPluginModule as Record<string, unknown>;
		}

		return ctx.module.exports;
	},
}));

type ManifestOptions = {
	fileName: string;
	manifest: unknown;
	entryExists?: boolean;
	pluginModule?: unknown;
};

const buildApp = (options: ManifestOptions) => {
	jest.resetModules();

	const logger = {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
	};

	const pluginSource = 'export const checkManifest = async () => ({})';
	const pluginsDir = `${process.cwd()}/plugins`;
	const entryPath = `${pluginsDir}/${options.fileName}`;
	const manifestPath = `${pluginsDir}/${options.fileName.replace(/\.[^.]+$/, '')}.manifest.json`;
	const entryExists = options.entryExists !== false;

	currentPluginModule = options.pluginModule ?? {
		checkManifest: () => ({message: 'manifest ok', code: 0}),
	};

	const transpileModule = jest.fn(() => ({
		outputText: 'module.exports = {}',
	}));

	const existsSync = (p: string) =>
		(options.manifest !== undefined && p === manifestPath) ||
		(entryExists && p === entryPath);
	const readFileSync = (p: string) => {
		if (p === manifestPath) {
			return typeof options.manifest === 'string'
				? options.manifest
				: JSON.stringify(options.manifest);
		}

		return pluginSource;
	};
	const statSync = () => ({
		isFile: () => true,
		mtimeMs: 0,
		uid: typeof process.getuid === 'function' ? process.getuid() : 1000,
		mode: 0o100644,
	});

	jest.doMock('fs', () => ({
		__esModule: true,
		default: {
			readdirSync: () => [options.fileName],
			existsSync,
			readFileSync,
			writeFileSync: () => undefined,
			mkdirSync: () => undefined,
			statSync,
		},
		readdirSync: () => [options.fileName],
		existsSync,
		readFileSync,
		writeFileSync: () => undefined,
		mkdirSync: () => undefined,
		statSync,
	}));

	jest.doMock('typescript', () => ({
		__esModule: true,
		default: {
			transpileModule,
			ModuleKind: {CommonJS: 1},
			ScriptTarget: {ESNext: 99},
		},
		transpileModule,
		ModuleKind: {CommonJS: 1},
		ScriptTarget: {ESNext: 99},
	}));

	jest.doMock('module', () => ({
		createRequire: () => {
			const requireFn = ((p: string) => currentPluginModule) as ((
				p: string,
			) => unknown) & {resolve: (p: string) => string};
			requireFn.resolve = (p: string) => p;
			return requireFn;
		},
	}));

	jest.doMock('../config/env', () => ({
		env: {
			NODE_ENV: 'production',
			HOST: 'localhost',
			PORT: 5000,
			PLUGINS_DIR: 'plugins',
			LOG_FILE_PATH: 'logs/nest.log',
		},
	}));

	jest.doMock('../lib/logger', () => ({logger}));

	let registeredRoutes: string[] = [];
	let router: express.Router;
	jest.isolateModules(() => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require('./dynamic-routes') as {
			default: express.Router;
			registeredPluginRoutes: string[];
		};
		registeredRoutes = mod.registeredPluginRoutes;
		router = mod.default;
	});

	const app = express();
	app.use(express.json());
	app.use('/', router!);

	return {app, registeredRoutes, logger};
};

const hashOf = (source: string): string =>
	crypto.createHash('sha256').update(source).digest('hex');

afterEach(() => {
	jest.dontMock('fs');
	jest.dontMock('typescript');
	jest.dontMock('module');
	jest.dontMock('../config/env');
	jest.dontMock('../lib/logger');
	jest.resetModules();
	jest.restoreAllMocks();
});

describe('dynamic-routes manifest plugins', () => {
	test('registers a manifest plugin whose hash matches', async () => {
		const {app, registeredRoutes} = buildApp({
			fileName: 'acme_disk.ts',
			manifest: {
				name: 'acme_disk',
				version: '1.0.0',
				entry: 'acme_disk.ts',
				hash: hashOf('export const checkManifest = async () => ({})'),
			},
		});

		expect(registeredRoutes).toContain('/plugins/acme-disk');
		const res = await request(app).get('/plugins/acme-disk');
		expect(res.body).toHaveProperty('message', 'manifest ok');
	});

	test('loads a manifest plugin with no hash (two-tier trust)', () => {
		const {registeredRoutes, logger} = buildApp({
			fileName: 'manual_plugin.ts',
			manifest: {
				name: 'manual_plugin',
				version: '1.0.0',
				entry: 'manual_plugin.ts',
			},
		});

		expect(registeredRoutes).toContain('/plugins/manual-plugin');
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('no "hash"'),
		);
	});

	test('skips a plugin with no sidecar manifest (fail-secure)', () => {
		const {registeredRoutes, logger} = buildApp({
			fileName: 'orphan.ts',
			// No manifest file exists: existsSync returns false for orphan.manifest.json
			manifest: undefined,
			entryExists: true,
		});

		// The manifest path won't exist, so loadPluginManifest returns empty.
		expect(registeredRoutes).not.toContain('/plugins/orphan');
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('no manifest'),
		);
	});

	test('skips a manifest plugin below minNestVersion', () => {
		const {registeredRoutes, logger} = buildApp({
			fileName: 'needs_new.ts',
			manifest: {
				name: 'needs_new',
				version: '1.0.0',
				entry: 'needs_new.ts',
				minNestVersion: '999.0.0',
			},
		});

		expect(registeredRoutes).not.toContain('/plugins/needs-new');
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('requires nest >='),
		);
	});

	test('skips a manifest whose entry file is missing', () => {
		const {registeredRoutes, logger} = buildApp({
			fileName: 'broken.ts',
			entryExists: false,
			manifest: {
				name: 'broken',
				version: '1.0.0',
				entry: 'broken.ts',
			},
		});

		expect(registeredRoutes).not.toContain('/plugins/broken');
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('does not exist'),
		);
	});

	test('warns on an invalid manifest and registers nothing', () => {
		const {registeredRoutes, logger} = buildApp({
			fileName: 'invalid.ts',
			manifest: '{ not json',
		});

		expect(registeredRoutes).toEqual([]);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('not valid JSON'),
		);
	});
});
