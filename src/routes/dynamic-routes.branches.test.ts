import express from 'express';
import request from 'supertest';

type PluginModule = unknown;

type RouterLoadOptions = {
	pluginModule?: PluginModule;
	requireError?: Error;
	resolveError?: Error;
	pluginFiles?: string[];
};

type NagiosBody = {
	message: string;
	code: number;
	performanceData?: string;
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
		checkFake: () => Promise.resolve({message: 'ok', code: 0}),
	};
	const pluginFiles = options.pluginFiles ?? ['check_fake.ts'];

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
			readdirSync: () => pluginFiles,
			readFileSync: () => 'export const checkFake = async () => ({})',
			writeFileSync: () => undefined,
			mkdirSync: () => undefined,
			statSync: () => ({isFile: () => true}),
		},
		readdirSync: () => pluginFiles,
		readFileSync: () => 'export const checkFake = async () => ({})',
		writeFileSync: () => undefined,
		mkdirSync: () => undefined,
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
			LOG_FILE_PATH: 'logs/nest.log',
		},
	}));

	jest.doMock('../lib/logger', () => ({
		logger,
	}));

	let router: express.Router;
	jest.isolateModules(() => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const routesModule = require('./dynamic-routes') as {
			default: express.Router;
		};
		router = routesModule.default;
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
				checkFake: () => Promise.resolve('not-an-object'),
			},
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(500);
		expect(body).toHaveProperty('code', 3);
		expect(String(body.message)).toContain('did not return a valid object');
	});

	test('returns 500 when plugin execution throws', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: {
				checkFake: () => Promise.reject(new Error('boom')),
			},
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(500);
		expect(body).toHaveProperty('code', 3);
		expect(String(body.message)).toContain('failed: boom');
	});

	test('uses fallback message when plugin does not return message', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: {
				checkFake: () => Promise.resolve({code: 0}),
			},
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(String(body.message)).toContain('did not return a message');
	});

	test('ignores invalid performanceData and logs warning', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginModule: {
				checkFake: () =>
					Promise.resolve({
						message: 'ok',
						code: 0,
						performanceData: {bad: true},
					}),
			},
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('message', 'ok');
		expect(body).toHaveProperty('code', 0);
		expect(body).not.toHaveProperty('performanceData');
		expect(logger.warn).toHaveBeenCalled();
	});

	test('returns 500 when plugin cannot be loaded', async () => {
		const {app} = buildAppForPlugin({
			requireError: new Error('load failure'),
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(500);
		expect(body).toHaveProperty('code', 3);
		expect(String(body.message)).toContain('Error loading plugin');
	});

	test('continues when cache resolve fails and logs warning', async () => {
		const {app, logger} = buildAppForPlugin({
			resolveError: new Error('resolve failure'),
			pluginModule: {
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('message', 'ok');
		expect(body).toHaveProperty('code', 0);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining(
				'Could not resolve plugin path for cache clearing',
			),
		);
	});

	test('logs plugin usage when metadata usage is a string', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginModule: {
				meta: {
					usage: '/check-fake?foo=<value>',
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Usage for plugin'),
		);
	});

	test('ignores metadata when usage shape is invalid', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginModule: {
				meta: {
					usage: 42,
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(logger.info).not.toHaveBeenCalledWith(
			expect.stringContaining('Usage for plugin'),
		);
	});

	test('handles non-object plugin module values', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: 123,
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(500);
		expect(body).toHaveProperty('code', 3);
		expect(String(body.message)).toContain('must export a function');
	});

	test('loads JS plugins without transpilation', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.js'],
			pluginModule: {
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Loaded JS plugin without transpilation'),
		);
	});

	test('skips JS plugin when matching TS plugin exists', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts', 'check_fake.js'],
			pluginModule: {
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(logger.debug).toHaveBeenCalledWith(
			expect.stringContaining(
				'Skipping JS plugin because matching TS plugin exists',
			),
		);
	});
});
