import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import {HttpStatusCodes} from '../lib/http-status-codes';

// Mock vm module with inline factory - manual mock in __mocks__/ not being loaded
let currentPluginModule: unknown = undefined;
let currentRequireError: unknown = undefined;
const mockSetPluginModule = jest.fn((pluginModule: unknown) => {
	currentPluginModule = pluginModule;
});
const mockResetPluginModule = jest.fn(() => {
	currentPluginModule = undefined;
	currentRequireError = undefined;
});
const mockCreateContext = jest.fn((contextObject?: unknown) => contextObject);
const mockRunInContext = jest.fn((code: string, context: unknown) => {
	// Simplified mock - will be overridden in test setup if needed
	if (!context) return;
	const ctx = context as {
		module?: {exports: Record<string, unknown>};
		exports: Record<string, unknown>;
	};
	if (!ctx.module) {
		ctx.module = {exports: {}};
		ctx.exports = ctx.module.exports;
	}
	// Throw requireError if set (for testing error handling)
	if (currentRequireError) {
		throw currentRequireError;
	}
	// Return the current plugin module if available
	if (currentPluginModule && typeof currentPluginModule === 'object') {
		ctx.module.exports = currentPluginModule as Record<string, unknown>;
		ctx.exports = currentPluginModule as Record<string, unknown>;
		return currentPluginModule;
	}
	return ctx.module.exports;
});

jest.mock('vm', () => ({
	createContext: mockCreateContext,
	runInContext: mockRunInContext,
	setPluginModule: mockSetPluginModule,
	resetPluginModule: mockResetPluginModule,
}));

type PluginModule = unknown;

let router: express.Router | undefined;

type RouterLoadOptions = {
	pluginModule?: PluginModule;
	requireError?: unknown;
	resolveError?: Error;
	pluginFiles?: string[];
	pluginFileIsFile?: boolean;
	pluginFileUid?: number;
	pluginFileMode?: number;
	processUid?: number;
	omitProcessGetuid?: boolean;
	whitelistContent?: string;
	whitelistExists?: boolean;
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
	// Set the require error in the vm mock before loading the module
	if (options.requireError) {
		currentRequireError = options.requireError;
	}
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
	const pluginSource = 'export const checkFake = async () => ({})';
	const approvedHash = crypto
		.createHash('sha256')
		.update(pluginSource)
		.digest('hex');
	const whitelistPath = `${process.cwd()}/plugins/plugin-whitelist.txt`;
	const whitelistExists = options.whitelistExists ?? true;
	const whitelistContent =
		options.whitelistContent ??
		pluginFiles
			.filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
			.map((file) => `${file} ${approvedHash}`)
			.join('\n');
	const statSyncMock = (fsPath: string) => {
		if (fsPath === whitelistPath) {
			return {
				isFile: () => true,
				mtimeMs: sourceMtimeMsRaw,
				uid: processUid,
				mode: 0o100600,
			};
		}

		if (fsPath.includes('check_fake.ts')) {
			pluginFileStatCalls += 1;
			if (options.sourceStatSecondCallError && pluginFileStatCalls >= 2) {
				throw options.sourceStatSecondCallError as Error;
			}
		}

		return {
			isFile: () => pluginFileIsFile,
			mtimeMs: sourceMtimeMsRaw,
			uid: pluginFileUid,
			mode: pluginFileMode,
		};
	};

	const originalGetUid = process.getuid;
	if (options.omitProcessGetuid) {
		Object.defineProperty(process, 'getuid', {
			value: undefined,
			writable: true,
			configurable: true,
		});
	} else if (typeof process.getuid === 'function') {
		jest.spyOn(process, 'getuid').mockReturnValue(processUid);
	}

	const requireError = options.requireError;

	const requireFn = ((modulePath: string) => {
		// Throw requireError if set (for testing error handling)
		if (requireError) {
			throw requireError;
		}
		// Handle memory:// virtual paths used by vm execution
		if (modulePath.startsWith('memory://')) {
			return pluginModule;
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
			existsSync: (fsPath: string) => {
				if (fsPath === whitelistPath) {
					return whitelistExists;
				}
				if (pluginFiles.some((file) => fsPath.endsWith(file))) {
					return true;
				}
				return false;
			},
			readdirSync: (fsPath: string) => {
				return pluginFiles;
			},
			readFileSync: (fsPath: string) => {
				if (fsPath === whitelistPath) {
					return whitelistContent;
				}
				if (fsPath.endsWith('.ts') || fsPath.endsWith('.js')) {
					return pluginSource;
				}
				return '';
			},
			writeFileSync: () => undefined,
			mkdirSync: () => undefined,
			statSync: statSyncMock,
		},
		existsSync: (fsPath: string) => {
			if (fsPath === whitelistPath) {
				return whitelistExists;
			}
			if (pluginFiles.some((file) => fsPath.endsWith(file))) {
				return true;
			}
			return false;
		},
		readdirSync: (fsPath: string) => {
			return pluginFiles;
		},
		readFileSync: (fsPath: string) => {
			if (fsPath === whitelistPath) {
				return whitelistContent;
			}
			if (fsPath.endsWith('.ts') || fsPath.endsWith('.js')) {
				return pluginSource;
			}
			return '';
		},
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

	// Configure vm mock with plugin module for this test
	const vm = require('vm');
	vm.setPluginModule(pluginModule);

	// Override runInContext to handle requireError - must be done BEFORE require('./dynamic-routes')
	const originalRunInContext = vm.runInContextMock;
	const runInContextWithRequireError = (code: string, context: unknown) => {
		if (requireError) {
			throw requireError as Error;
		}
		return originalRunInContext(code, context);
	};

	// Replace the runInContext implementation
	vm.runInContextMock = runInContextWithRequireError;

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

	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const routesModule = require('./dynamic-routes') as {
		default: express.Router;
		ensurePluginRoutesInitialized: () => void;
	};
	router = routesModule.default as express.Router;
	const ensurePluginRoutesInitialized =
		routesModule.ensurePluginRoutesInitialized;

	if (options.omitProcessGetuid) {
		Object.defineProperty(process, 'getuid', {
			value: originalGetUid,
			writable: true,
			configurable: true,
		});
	}

	const app = express();
	app.use(express.json());
	app.use('/', router!);

	return {app, logger, ensurePluginRoutesInitialized};
};

describe('dynamic routes (branch coverage)', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.resetModules();
		currentRequireError = undefined;
	});

	test('returns 500 when plugin returns a non-object result', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: {
				checkFake: () => Promise.resolve('not-an-object'),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(HttpStatusCodes.INTERNAL_SERVER_ERROR);
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
		expect(res.status).toBe(HttpStatusCodes.INTERNAL_SERVER_ERROR);
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
		expect(res.status).toBe(HttpStatusCodes.OK);
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
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(body).toHaveProperty('message', 'ok');
		expect(body).toHaveProperty('code', 0);
		expect(body).not.toHaveProperty('performanceData');
		expect(logger.warn).toHaveBeenCalled();
	});

	test('returns 200 with Nagios code 3 when plugin cannot be loaded', async () => {
		const {app} = buildAppForPlugin({
			requireError: new Error('load failure'),
		});

		const res = await request(app).get('/plugins/check-fake');
		const body = res.body as NagiosBody;
		// Plugin load errors return HTTP 200 with Nagios UNKNOWN (code 3)
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(body).toHaveProperty('code', 3);
		expect(String(body.message)).toContain('Error loading plugin');
	});

	test('logs plugin usage when metadata usage is a string', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginModule: {
				meta: {
					usage: {
						http: '/plugins/check-fake?foo=<value>',
					},
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(body).toHaveProperty('code', 0);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('HTTP usage for plugin'),
		);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('/plugins/check-fake?foo='),
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
		expect(res.status).toBe(HttpStatusCodes.OK);
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
		expect(res.status).toBe(HttpStatusCodes.INTERNAL_SERVER_ERROR);
		expect(body).toHaveProperty('code', 3);
		expect(String(body.message)).toContain('must export a function');
	});

	test('loads JS plugins without transpilation', async () => {
		const {app} = buildAppForPlugin({
			pluginFiles: ['check_fake.js'],
			pluginModule: {
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		const body = res.body as NagiosBody;
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(body).toHaveProperty('code', 0);
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
		expect(res.status).toBe(HttpStatusCodes.OK);
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
		expect(res.status).toBe(HttpStatusCodes.OK);
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
		expect(res.status).toBe(HttpStatusCodes.NOT_FOUND);
	});

	test('skips plugin when ownership does not match process uid', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			processUid: 0,
			pluginFileUid: 1000,
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(HttpStatusCodes.NOT_FOUND);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('insecure ownership'),
		);
	});

	test('skips plugin when it is not present in the whitelist file', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			whitelistContent: '',
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(HttpStatusCodes.NOT_FOUND);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('is new or not whitelisted'),
		);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('plugin-whitelist.txt'),
		);
	});

	test('skips plugin when its whitelist hash changed', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			whitelistContent:
				'check_fake.ts deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(HttpStatusCodes.NOT_FOUND);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('hash changed'),
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
		expect(res.status).toBe(HttpStatusCodes.NOT_FOUND);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('insecure permissions'),
		);
	});

	test('loads plugin when process.getuid is unavailable in production', async () => {
		const {app} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			omitProcessGetuid: true,
			pluginModule: {
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.body).toHaveProperty('code', 0);
	});

	test('skips plugin registration when transpilation fails', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			transpileError: new Error('transpile failed'),
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(HttpStatusCodes.NOT_FOUND);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Could not transpile plugin'),
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
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(body).toHaveProperty('code', 0);
	});

	test('falls back to cache mtime -1 when mtime is not numeric', async () => {
		const {app} = buildAppForPlugin({
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
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(body).toHaveProperty('code', 0);
	});

	test('stringifies non-Error transpile failures', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginFiles: ['check_fake.ts'],
			transpileError: 'transpile-string-error',
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(HttpStatusCodes.NOT_FOUND);
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
		const body = res.body as NagiosBody;
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(body).toHaveProperty('code', 3);
		expect(String(body.message)).toContain('Error loading plugin');
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
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('HTTP usage for plugin'),
		);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('/plugins/check-fake?help'),
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
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Shell usage for plugin'),
		);
		expect(logger.info).not.toHaveBeenCalledWith(
			expect.stringContaining('HTTP usage for plugin'),
		);
	});

	test('logs both HTTP and shell usage when both are defined', async () => {
		const {app, logger} = buildAppForPlugin({
			pluginModule: {
				meta: {
					usage: {
						http: '/plugins/check-fake?x=1',
						shell: './check_nest.sh check-fake x=1',
					},
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('HTTP usage for plugin'),
		);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Shell usage for plugin'),
		);
	});

	test('serves plugin help page from ?help when meta.help is defined', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: {
				meta: {
					help: '<h1>Fake Plugin Help</h1><p>No real functionality.</p>',
					usage: {
						http: '/plugins/check-fake?x=1',
						shell: './check_nest.sh check-fake x=1',
					},
					examples: [],
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake?help');
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.headers['content-type']).toMatch(/text\/html/);
		expect(res.text).toContain('<h1>Fake Plugin Help</h1>');
		expect(res.text).toContain('No real functionality.');
	});

	test('serves auto-generated help page from ?help when no meta.help is defined', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: {
				meta: {
					usage: {
						http: '/plugins/check-fake?x=<val>',
					},
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake?help');
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.headers['content-type']).toMatch(/text\/html/);
		expect(res.text).toContain('check_fake');
		expect(res.text).toContain('/plugins/check-fake?x=&lt;val&gt;');
		expect(res.text).toContain(
			'No extended help is available for this plugin.',
		);
	});

	test('serves fallback help page when meta.help is a non-string value', async () => {
		const {app} = buildAppForPlugin({
			pluginModule: {
				meta: {
					help: 42,
				},
				checkFake: () => Promise.resolve({message: 'ok', code: 0}),
			},
		});

		const res = await request(app).get('/plugins/check-fake?help');
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.headers['content-type']).toMatch(/text\/html/);
		expect(res.text).toContain(
			'No extended help is available for this plugin.',
		);
	});

	test('handles NagiosReturnCodes regex replacement with unknown code', async () => {
		jest.resetModules();

		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const pluginFiles = ['check_fake.ts'];
		const pluginSource = 'export const checkFake = async () => ({})';
		const approvedHash = crypto
			.createHash('sha256')
			.update(pluginSource)
			.digest('hex');
		const whitelistPath = `${process.cwd()}/plugins/plugin-whitelist.txt`;
		const whitelistContent = `check_fake.ts ${approvedHash}`;

		const transpileSpy = jest.fn().mockImplementation(() => {
			// Return output with an invalid NagiosReturnCodes reference to trigger fallback
			return {
				outputText:
					'module.exports = { checkFake: async () => ({ code: nagios_1.NagiosReturnCodes.UNKNOWN_CODE }) };',
			};
		});

		const pluginModule = {
			checkFake: () => ({code: 3}),
		};

		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: (fsPath: string) =>
					fsPath === whitelistPath || fsPath.endsWith('check_fake.ts'),
				readdirSync: () => pluginFiles,
				readFileSync: (fsPath: string) =>
					fsPath === whitelistPath ? whitelistContent : pluginSource,
				writeFileSync: () => undefined,
				mkdirSync: () => undefined,
				statSync: (fsPath: string) => {
					if (fsPath === whitelistPath) {
						return {
							isFile: () => true,
							mtimeMs: 0,
							uid: 1000,
							mode: 0o100600,
						};
					}
					return {
						isFile: () => true,
						mtimeMs: 0,
						uid: 1000,
						mode: 0o100644,
					};
				},
			},
			existsSync: (fsPath: string) =>
				fsPath === whitelistPath || fsPath.endsWith('check_fake.ts'),
			readdirSync: () => pluginFiles,
			readFileSync: (fsPath: string) =>
				fsPath === whitelistPath ? whitelistContent : pluginSource,
			writeFileSync: () => undefined,
			mkdirSync: () => undefined,
			statSync: (fsPath: string) => {
				if (fsPath === whitelistPath) {
					return {
						isFile: () => true,
						mtimeMs: 0,
						uid: 1000,
						mode: 0o100600,
					};
				}
				return {
					isFile: () => true,
					mtimeMs: 0,
					uid: 1000,
					mode: 0o100644,
				};
			},
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
			createRequire: () => {
				const requireFn = ((modulePath: string) => {
					if (modulePath.startsWith('memory://')) {
						return pluginModule;
					}
					return pluginModule;
				}) as ((modulePath: string) => unknown) & {
					resolve: (modulePath: string) => string;
				};
				requireFn.resolve = (modulePath: string) => modulePath;
				return requireFn;
			},
		}));

		// Configure vm mock with plugin module for this test
		const vm = require('vm');
		vm.setPluginModule(pluginModule);

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

		jest.spyOn(process, 'getuid').mockReturnValue(1000);

		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const routesModule = require('./dynamic-routes') as {
			default: express.Router;
		};
		router = routesModule.default;

		const app = express();
		app.use(express.json());
		app.use('/', router!);

		const res = await request(app).get('/plugins/check-fake');
		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.body).toHaveProperty('code', 3);
	});
});
