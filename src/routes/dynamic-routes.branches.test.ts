import express from 'express';
import request from 'supertest';

type PluginModule = unknown;

type RouterLoadOptions = {
	pluginModule?: PluginModule;
	requireError?: unknown;
	resolveError?: Error;
	pluginFiles?: string[];
	pluginFileIsFile?: boolean;
	pluginFileUid?: number;
	pluginFileMode?: number;
	processUid?: number;
	sourceMtimeMs?: number;
	cacheMtimeMs?: number;
	transpileError?: unknown;
	sourceStatSecondCallError?: unknown;
	sourceMtimeMsRaw?: unknown;
	cacheMtimeMsRaw?: unknown;
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
	const pluginFileIsFile = options.pluginFileIsFile ?? true;
	const pluginFileUid = options.pluginFileUid ?? 1000;
	const pluginFileMode = options.pluginFileMode ?? 0o100600;
	const processUid = options.processUid ?? 1000;
	const sourceMtimeMs = options.sourceMtimeMs ?? 0;
	const cacheMtimeMs = options.cacheMtimeMs ?? -1;
	const sourceMtimeMsRaw = options.sourceMtimeMsRaw ?? sourceMtimeMs;
	const cacheMtimeMsRaw = options.cacheMtimeMsRaw ?? cacheMtimeMs;
	let pluginFileStatCalls = 0;
	const transpileSpy = jest.fn().mockImplementation(() => {
		if (options.transpileError) {
			throw options.transpileError as Error;
		}

		return {outputText: 'module.exports = {}'};
	});
	const pluginFiles = options.pluginFiles ?? ['check_fake.ts'];
	const statSyncMock = (fsPath: string) => {
		if (fsPath.includes('check_fake.ts')) {
			pluginFileStatCalls += 1;
			if (options.sourceStatSecondCallError && pluginFileStatCalls >= 2) {
				throw options.sourceStatSecondCallError as Error;
			}
		}

		if (fsPath.includes('plugin-cache')) {
			if (cacheMtimeMs < 0) {
				throw new Error('cache not found');
			}

			return {
				isFile: () => true,
				mtimeMs: cacheMtimeMsRaw,
				uid: pluginFileUid,
				mode: pluginFileMode,
			};
		}

		return {
			isFile: () => pluginFileIsFile,
			mtimeMs: sourceMtimeMsRaw,
			uid: pluginFileUid,
			mode: pluginFileMode,
		};
	};

	if (typeof process.getuid === 'function') {
		jest.spyOn(process, 'getuid').mockReturnValue(processUid);
	}

	const requireFn = ((modulePath: string) => {
		if (options.requireError) {
			throw options.requireError as Error;
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
			statSync: statSyncMock,
		},
		readdirSync: () => pluginFiles,
		readFileSync: () => 'export const checkFake = async () => ({})',
		writeFileSync: () => undefined,
		mkdirSync: () => undefined,
		statSync: statSyncMock,
	}));

	jest.doMock('typescript', () => ({
		__esModule: true,
		default: {
			transpileModule: transpileSpy,
			ModuleKind: {CommonJS: 1},
			ScriptTarget: {ESNext: 99},
		},
		transpileModule: transpileSpy,
		ModuleKind: {CommonJS: 1},
		ScriptTarget: {ESNext: 99},
	}));

	jest.doMock('module', () => ({
		createRequire: () => requireFn,
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

		const res = await request(app).get('/plugins/check-fake');
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

		const res = await request(app).get('/plugins/check-fake');
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

		const res = await request(app).get('/plugins/check-fake');
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

		const res = await request(app).get('/plugins/check-fake');
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

		const res = await request(app).get('/plugins/check-fake');
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

		const res = await request(app).get('/plugins/check-fake');
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
					usage: '/plugins/check-fake?foo=<value>',
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
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

		const res = await request(app).get('/plugins/check-fake');
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

		const res = await request(app).get('/plugins/check-fake');
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

		const res = await request(app).get('/plugins/check-fake');
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

		const res = await request(app).get('/plugins/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(logger.debug).toHaveBeenCalledWith(
			expect.stringContaining(
				'Skipping JS plugin because matching TS plugin exists',
			),
		);
	});

	test('skips plugin when filename normalization collides with an existing route', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts', 'check-fake.ts'],
			pluginModule: {
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining(
				'Keep plugin filenames unique after kebab-case normalization',
			),
		);
	});

	test('skips non-file plugin entries', async () => {
		const {app} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			pluginFileIsFile: false,
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(404);
	});

	test('skips plugin when ownership does not match process uid', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			processUid: 0,
			pluginFileUid: 1000,
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(404);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('insecure ownership'),
		);
	});

	test('skips plugin when file is group or world writable', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			processUid: 0,
			pluginFileUid: 0,
			pluginFileMode: 0o100666,
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(404);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('insecure permissions'),
		);
	});

	test('uses cached transpiled plugin when cache is newer', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			sourceMtimeMs: 10,
			cacheMtimeMs: 20,
			pluginModule: {
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(logger.debug).toHaveBeenCalledWith(
			expect.stringContaining('Using cached transpiled plugin'),
		);
	});

	test('skips plugin registration when transpilation fails', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			transpileError: new Error('transpile failed'),
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(404);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Could not transpile plugin'),
		);
	});

	test('skips plugin registration when source plugin stat fails in resolver', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			sourceStatSecondCallError: new Error('stat failed in resolver'),
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(404);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Could not stat plugin file'),
		);
	});

	test('falls back to source mtime 0 when mtime is not numeric', async () => {
		const {app} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			sourceMtimeMsRaw: 'invalid-mtime',
			pluginModule: {
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
	});

	test('falls back to cache mtime -1 when mtime is not numeric', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			sourceMtimeMs: 10,
			cacheMtimeMs: 1,
			cacheMtimeMsRaw: 'invalid-cache-mtime',
			pluginModule: {
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(200);
		expect(body).toHaveProperty('code', 0);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Transpiled TS plugin to cache'),
		);
	});

	test('stringifies non-Error transpile failures', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			transpileError: 'transpile-string-error',
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(404);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Error: transpile-string-error'),
		);
	});

	test('stringifies non-Error metadata load failures', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.js'],
			requireError: 'metadata-string-error',
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(500);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Error: metadata-string-error'),
		);
	});

	test('logs only HTTP usage when shell usage is missing', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginModule: {
				meta: {
					usage: {
						http: '/plugins/check-fake?x=1',
					},
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(200);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('HTTP usage for plugin'),
		);
		expect(logger.info).not.toHaveBeenCalledWith(
			expect.stringContaining('Shell usage for plugin'),
		);
	});

	test('logs only shell usage when HTTP usage is missing', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginModule: {
				meta: {
					usage: {
						shell: './check_nest.sh check-fake x=1',
					},
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(200);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Shell usage for plugin'),
		);
		expect(logger.info).not.toHaveBeenCalledWith(
			expect.stringContaining('HTTP usage for plugin'),
		);
	});

	test('stringifies non-Error source stat failures in resolver', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			sourceStatSecondCallError: 'stat-string-error',
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(404);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Error: stat-string-error'),
		);
	});
});
