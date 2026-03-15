import express from 'express';
import request from 'supertest';

type PluginModule = Record<string, unknown>;

type RouterLoadOptions = {
	pluginModule?: PluginModule;
	requireError?: Error;
	resolveError?: Error;
};

const buildAppForPlugin = (options: RouterLoadOptions = {}) => {
	jest.resetModules();

	const logger = {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
	};

	const pluginModule = options.pluginModule ?? {
		checkFake: async () => ({message: 'ok', code: 0}),
	};

	const requireFn = ((modulePath: string) => {
		if (options.requireError) {
			throw options.requireError;
		}
		if (!modulePath.endsWith('.js')) {
			throw new Error(`Unexpected module path: ${modulePath}`);
		}
		return pluginModule;
	}) as ((modulePath: string) => unknown) & {
		resolve: (modulePath: string) => string;
	};

	requireFn.resolve = (modulePath: string) => {
		if (options.resolveError) {
			throw options.resolveError;
		}
		return modulePath;
	};

	jest.doMock('fs', () => ({
		__esModule: true,
		default: {
			readdirSync: () => ['check_fake.ts'],
			readFileSync: () => 'export const checkFake = async () => ({})',
			writeFileSync: () => undefined,
			statSync: () => ({isFile: () => true}),
		},
		readdirSync: () => ['check_fake.ts'],
		readFileSync: () => 'export const checkFake = async () => ({})',
		writeFileSync: () => undefined,
		statSync: () => ({isFile: () => true}),
	}));

	jest.doMock('typescript', () => ({
		__esModule: true,
		default: {
			transpileModule: () => ({outputText: 'module.exports = {}'}),
			ModuleKind: {CommonJS: 1},
			ScriptTarget: {ESNext: 99},
		},
		transpileModule: () => ({outputText: 'module.exports = {}'}),
		ModuleKind: {CommonJS: 1},
		ScriptTarget: {ESNext: 99},
	}));

	jest.doMock('module', () => ({
		createRequire: () => requireFn,
	}));

	jest.doMock('../config/env', () => ({
		env: {
			HOST: 'localhost',
			PORT: 5000,
			PLUGINS_DIR: 'plugins',
		},
	}));

	jest.doMock('../lib/logger', () => ({
		logger,
	}));

	let router: express.Router;
	jest.isolateModules(() => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		router = require('./dynamic-routes').default as express.Router;
	});

	const app = express();
	app.use(express.json());
	app.use('/', router!);

	return {app, logger};
};

describe('dynamic routes (branch coverage)', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.resetModules();
	});

	test('returns 500 when plugin returns a non-object result', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: {
				checkFake: async () => 'not-an-object',
			},
		});

		const res = await request(app).get('/check-fake');
		expect(res.status).toBe(500);
		expect(res.body).toHaveProperty('code', 3);
		expect(String(res.body.message)).toContain('did not return a valid object');
	});

	test('returns 500 when plugin execution throws', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: {
				checkFake: async () => {
					throw new Error('boom');
				},
			},
		});

		const res = await request(app).get('/check-fake');
		expect(res.status).toBe(500);
		expect(res.body).toHaveProperty('code', 3);
		expect(String(res.body.message)).toContain('failed: boom');
	});

	test('uses fallback message when plugin does not return message', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: {
				checkFake: async () => ({code: 0}),
			},
		});

		const res = await request(app).get('/check-fake');
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('code', 0);
		expect(String(res.body.message)).toContain('did not return a message');
	});

	test('ignores invalid performanceData and logs warning', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginModule: {
				checkFake: async () => ({
					message: 'ok',
					code: 0,
					performanceData: {bad: true},
				}),
			},
		});

		const res = await request(app).get('/check-fake');
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('message', 'ok');
		expect(res.body).toHaveProperty('code', 0);
		expect(res.body).not.toHaveProperty('performanceData');
		expect(logger.warn).toHaveBeenCalled();
	});

	test('returns 500 when plugin cannot be loaded', async () => {
		const {app} = buildAppForPlugin({
			requireError: new Error('load failure'),
		});

		const res = await request(app).get('/check-fake');
		expect(res.status).toBe(500);
		expect(res.body).toHaveProperty('code', 3);
		expect(String(res.body.message)).toContain('Error loading plugin');
	});

	test('continues when cache resolve fails and logs warning', async () => {
		const {app, logger} = buildAppForPlugin({
			resolveError: new Error('resolve failure'),
			pluginModule: {
				checkFake: async () => ({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/check-fake');
		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('message', 'ok');
		expect(res.body).toHaveProperty('code', 0);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining(
				'Could not resolve plugin path for cache clearing',
			),
		);
	});
});
