import crypto from 'crypto';
import express from 'express';
import path from 'path';
import request from 'supertest';
import {HttpStatusCodes} from '../lib/http-status-codes';
import {executePluginInMemory} from './dynamic-routes';

// Mock vm module - will be set up in buildApp() using jest.doMock()
let currentPluginModule: unknown = undefined;
const mockSetPluginModule = jest.fn((pluginModule: unknown) => {
	currentPluginModule = pluginModule;
});
const mockResetPluginModule = jest.fn(() => {
	currentPluginModule = undefined;
});
const mockCreateContext = jest.fn((contextObject?: unknown) => contextObject);
const mockRunInContext = jest.fn((code: string, context: unknown) => {
	// Simplified mock - will be overridden in test setup if needed
	if (!context) return {};
	const ctx = context as {
		module?: {exports: Record<string, unknown>};
		exports: Record<string, unknown>;
	};
	if (!ctx.module) {
		ctx.module = {exports: {}};
		ctx.exports = ctx.module.exports;
	}
	// Return the current plugin module if available
	if (currentPluginModule && typeof currentPluginModule === 'object') {
		// Copy properties from currentPluginModule to ctx.module.exports
		const pluginModule = currentPluginModule as Record<string, unknown>;
		for (const key of Object.keys(pluginModule)) {
			ctx.module.exports[key] = pluginModule[key];
		}
		ctx.exports = ctx.module.exports;
	}
	return ctx.module.exports;
});

type BuildAppOptions = {
	pluginFiles?: string[];
	nodeEnv?: string;
	pluginFileUid?: number;
	pluginFileMode?: number;
	pluginModule?: unknown;
	pluginsDir?: string;
	pluginWhitelistPath?: string;
};

describe('dynamic routes (plugins)', () => {
	let app: express.Application;

	const cleanupTestMocks = (): void => {
		jest.dontMock('fs');
		jest.dontMock('typescript');
		jest.dontMock('module');
		jest.dontMock('../config/env');
		jest.dontMock('../lib/logger');
		jest.resetModules();
		jest.restoreAllMocks();
	};

	const buildApp = (options: BuildAppOptions = {}) => {
		jest.resetModules();

		const usageHttp =
			'/plugins/check-test?nagiosReturnMessage=<string>&nagiosReturnValue=<0 | 1 | 2 | 3>&performanceData=<true | false>';
		const pluginSource = 'export const checkTest = async () => ({})';
		const pluginFiles = options.pluginFiles ?? ['check_test.ts'];
		const pluginsDir = options.pluginsDir ?? 'plugins';
		const whitelistPath = path.join(
			path.resolve(process.cwd(), pluginsDir),
			'plugin-whitelist.txt',
		);
		const approvedHash = crypto
			.createHash('sha256')
			.update(pluginSource)
			.digest('hex');
		const currentUid =
			typeof process.getuid === 'function' ? process.getuid() : 1000;
		const pluginFileUid = options.pluginFileUid ?? currentUid;
		const pluginFileMode = options.pluginFileMode ?? 0o100644;
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const pluginModule = options.pluginModule ?? {
			meta: {
				usage: {
					http: usageHttp,
					shell:
						'./check_nest.sh check-test nagiosReturnMessage=<string> nagiosReturnValue=<0 | 1 | 2 | 3> performanceData=<true | false>',
				},
				params: [
					{
						name: 'nagiosReturnMessage',
						label: 'message',
						type: 'text',
						default: 'Example OK',
					},
					{
						name: 'nagiosReturnValue',
						label: 'return value',
						type: 'number',
						default: '0',
					},
				],
			},
			checkTest: (params: {
				nagiosReturnMessage?: string;
				nagiosReturnValue?: string;
				performanceData?: string;
			}) => {
				const {nagiosReturnMessage, nagiosReturnValue, performanceData} =
					params;

				const result = {
					message: nagiosReturnMessage,
					code: Number.isInteger(Number(nagiosReturnValue))
						? Number(nagiosReturnValue)
						: 3,
					performanceData: [] as Array<{
						label: string;
						value: string;
						uom: string;
						warn: string;
						crit: string;
						min: string;
						max: string;
					}>,
				};

				if (!nagiosReturnMessage || nagiosReturnValue == null) {
					result.message = `Usage: ${usageHttp}`;
					result.code = 3;
				}

				if (performanceData) {
					result.performanceData.push({
						label: 'WATER BOILER TEMP',
						value: '55',
						uom: 'C°',
						warn: '80',
						crit: '90',
						min: '0',
						max: '100',
					});
					result.performanceData.push({
						label: 'OUTDOOR TEMP',
						value: '21',
						uom: 'C°',
						warn: '30',
						crit: '40',
						min: '-20',
						max: '50',
					});
				}

				return result;
			},
		};

		const statSyncMock = (fsPath: string) => ({
			isFile: () => true,
			mtimeMs: 0,
			uid: fsPath === whitelistPath ? currentUid : pluginFileUid,
			mode: fsPath === whitelistPath ? 0o100600 : pluginFileMode,
		});

		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: (fsPath: string) => {
					// Whitelist file always exists
					if (fsPath === whitelistPath) {
						return true;
					}
					// Plugin files exist
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
						return pluginFiles
							.filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
							.map((file) => `${file} ${approvedHash}`)
							.join('\n');
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
					return true;
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
					return pluginFiles
						.filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
						.map((file) => `${file} ${approvedHash}`)
						.join('\n');
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

		const transpileModule = jest.fn(() => ({
			outputText: `
const pluginModule = ${JSON.stringify(pluginModule, null, 2)};
module.exports = pluginModule;
`,
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

		const requireFn = ((_modulePath: string) => {
			// Return the pluginModule for .js files (including transpiled plugin cache)
			// Also handle memory:// virtual paths used by vm execution
			if (_modulePath.endsWith('.js') || _modulePath.startsWith('memory://')) {
				return pluginModule;
			}
			// For other modules (like ../src/types/nagios), return appropriate mocks
			if (_modulePath === '../src/types/nagios') {
				return {
					NagiosReturnCodes: {
						OK: 0,
						WARNING: 1,
						CRITICAL: 2,
						UNKNOWN: 3,
					},
				};
			}
			if (_modulePath === '../src/types/plugin') {
				return {};
			}
			// For all other modules, use standard require
			return jest.requireActual(_modulePath);
		}) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../config/env', () => ({
			env: {
				NODE_ENV: options.nodeEnv ?? 'production',
				HOST: 'localhost',
				PORT: 5000,
				PLUGINS_DIR: pluginsDir,
				LOG_FILE_PATH: 'logs/nest.log',
			},
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		// Mock vm module - must be called BEFORE isolateModules
		// Use a factory that accesses the currentPluginModule variable from outer scope
		jest.doMock('vm', () => ({
			createContext: mockCreateContext,
			runInContext: mockRunInContext,
			setPluginModule: mockSetPluginModule,
			resetPluginModule: mockResetPluginModule,
		}));

		let dynamicRoutes: express.Router;
		let registeredPluginRoutes: string[];
		let registeredPluginRouteParams: Record<string, unknown[]>;

		// Get vm mock OUTSIDE isolateModules to avoid require() isolation issue
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const vm = require('vm');

		// Set the plugin module BEFORE loading dynamic-routes so it's available during plugin scanning
		vm.setPluginModule(pluginModule);

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const routesModule = require('./dynamic-routes') as {
				default: express.Router;
				registeredPluginRoutes: string[];
				registeredPluginRouteParams: Record<string, unknown[]>;
			};
			dynamicRoutes = routesModule.default;
			registeredPluginRoutes = routesModule.registeredPluginRoutes;
			registeredPluginRouteParams = routesModule.registeredPluginRouteParams;
		});

		const builtApp = express();
		builtApp.use(express.json());
		builtApp.use('/', dynamicRoutes!);
		return {
			app: builtApp,
			registeredPluginRoutes: registeredPluginRoutes!,
			registeredPluginRouteParams: registeredPluginRouteParams!,
			logger,
		};
	};

	beforeEach(() => {
		app = buildApp().app;
	});

	afterEach(() => {
		cleanupTestMocks();
	});

	test('preserves absolute PLUGINS_DIR when resolving plugin directory', () => {
		const {logger} = buildApp({pluginsDir: '/opt/nest-plugins'});

		expect(logger.info).toHaveBeenCalledWith(
			'Use plugins directory: /opt/nest-plugins',
		);
	});

	test('check-test plugin returns a Nagios-style JSON object', async () => {
		const res = await request(app).get('/plugins/check-test').query({
			nagiosReturnMessage: 'hello',
			nagiosReturnValue: '0',
			performanceData: 'true',
		});

		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.body).toHaveProperty('message', 'hello');
		expect(res.body).toHaveProperty('code', 0);
		expect(res.body).toHaveProperty(
			'performanceData',
			"'WATER BOILER TEMP'=55C°;80;90;0;100 'OUTDOOR TEMP'=21C°;30;40;-20;50",
		);
	});

	test('check-test plugin supports POST body params', async () => {
		const res = await request(app).post('/plugins/check-test').send({
			nagiosReturnMessage: 'hello-post',
			nagiosReturnValue: '0',
			performanceData: 'true',
		});

		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.body).toHaveProperty('message', 'hello-post');
		expect(res.body).toHaveProperty('code', 0);
	});

	test('check-test plugin returns usage and UNKNOWN code when required parameters are missing', async () => {
		const res = await request(app).get('/plugins/check-test').query({
			performanceData: 'true',
		});

		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.body).toHaveProperty(
			'message',
			'Usage: /plugins/check-test?nagiosReturnMessage=<string>&nagiosReturnValue=<0 | 1 | 2 | 3>&performanceData=<true | false>',
		);
		expect(res.body).toHaveProperty('code', 3);
		expect(res.body).toHaveProperty(
			'performanceData',
			"'WATER BOILER TEMP'=55C°;80;90;0;100 'OUTDOOR TEMP'=21C°;30;40;-20;50",
		);
	});

	test('check-test plugin omits perfdata when performanceData is omitted', async () => {
		const res = await request(app).get('/plugins/check-test').query({
			nagiosReturnMessage: 'plain',
			nagiosReturnValue: '1',
		});

		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.body).toHaveProperty('message', 'plain');
		expect(res.body).toHaveProperty('code', 1);
		expect(res.body).not.toHaveProperty('performanceData');
	});

	test('check-test plugin normalizes invalid plugin code to UNKNOWN', async () => {
		const res = await request(app).get('/plugins/check-test').query({
			nagiosReturnMessage: 'invalid-code',
			nagiosReturnValue: '9',
			performanceData: 'true',
		});

		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.body).toHaveProperty('message', 'invalid-code');
		expect(res.body).toHaveProperty('code', 3);
	});

	test('ignores test plugin files during route registration', () => {
		const {registeredPluginRoutes} = buildApp({
			pluginFiles: ['check_test.test.ts', 'check_test.ts'],
		});

		expect(registeredPluginRoutes).toEqual(['/plugins/check-test']);
	});

	test('sorts registered plugin routes alphabetically', () => {
		const {registeredPluginRoutes} = buildApp({
			pluginFiles: ['zeta_plugin.ts', 'alpha_plugin.ts'],
		});

		expect(registeredPluginRoutes).toEqual([
			'/plugins/alpha-plugin',
			'/plugins/zeta-plugin',
		]);
	});

	test('exports sanitized plugin params for overview forms', () => {
		const {registeredPluginRouteParams} = buildApp();

		expect(registeredPluginRouteParams['/plugins/check-test']).toEqual([
			expect.objectContaining({
				name: 'nagiosReturnMessage',
				label: 'message',
				type: 'text',
				default: 'Example OK',
			}),
			expect.objectContaining({
				name: 'nagiosReturnValue',
				label: 'return value',
				type: 'number',
				default: '0',
			}),
		]);
	});

	test('normalises declared params and ignores malformed definitions', () => {
		const {registeredPluginRouteParams} = buildApp({
			pluginModule: {
				meta: {
					usage: {
						http: '/plugins/check-test',
					},
					params: [
						// Not an object - ignored.
						'not-a-param',
						// Missing/blank name - ignored.
						{label: 'Missing name'},
						{
							name: '   ',
							type: 'text',
						},
						// Unknown type coerced to text, label defaults to name.
						{name: 'baseUrl', type: 'mystery'},
						// Fully specified param, required + default + description.
						{
							name: 'token',
							label: 'Token',
							type: 'password',
							required: true,
							default: 'secret',
							description: 'Bearer token.',
						},
					],
				},
				checkTest: () => ({message: 'ok', code: 0, performanceData: []}),
			},
		});

		expect(registeredPluginRouteParams['/plugins/check-test']).toEqual([
			{
				name: 'baseUrl',
				label: 'baseUrl',
				required: false,
				type: 'text',
			},
			{
				name: 'token',
				label: 'Token',
				required: true,
				type: 'password',
				default: 'secret',
				description: 'Bearer token.',
			},
		]);
	});

	test('does not record params for a plugin that declares none', () => {
		const {registeredPluginRouteParams, registeredPluginRoutes} = buildApp({
			pluginModule: {
				meta: {
					usage: {http: '/plugins/check-test'},
					params: [],
				},
				checkTest: () => ({message: 'ok', code: 0, performanceData: []}),
			},
		});

		expect(registeredPluginRoutes).toContain('/plugins/check-test');
		expect(
			Object.prototype.hasOwnProperty.call(
				registeredPluginRouteParams,
				'/plugins/check-test',
			),
		).toBe(false);
	});

	test('allows plugin registration in non-production even with insecure plugin file metadata', async () => {
		const currentUid =
			typeof process.getuid === 'function' ? process.getuid() : 1000;
		const {app: developmentApp} = buildApp({
			nodeEnv: 'development',
			pluginFileUid: currentUid + 1,
			pluginFileMode: 0o100666,
		});

		const res = await request(developmentApp).get('/plugins/check-test').query({
			nagiosReturnMessage: 'dev-mode',
			nagiosReturnValue: '0',
		});

		expect(res.status).toBe(HttpStatusCodes.OK);
		expect(res.body).toHaveProperty('message', 'dev-mode');
		expect(res.body).toHaveProperty('code', 0);
	});

	test('handles plugin with string usage instead of object', () => {
		const {registeredPluginRoutes} = buildApp({
			pluginFiles: ['string_usage_plugin.ts'],
			pluginModule: {
				meta: {
					usage: '/plugins/string-usage-plugin?param=value',
					help: '<p>Help text</p>',
					params: [],
				},
				stringUsagePlugin: () => ({
					message: 'ok',
					code: 0,
					performanceData: [],
				}),
			},
		});

		expect(registeredPluginRoutes).toEqual(['/plugins/string-usage-plugin']);
	});

	test('handles plugin with null meta', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: null,
			nullMetaPlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('null_meta_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with undefined meta', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			nullMetaPlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('undefined_meta_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with invalid usage type (number)', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: 123,
				help: '<p>Help text</p>',
				params: [],
			},
			invalidUsagePlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('invalid_usage_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with missing usage field', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				help: '<p>Help text</p>',
				params: [],
			},
			missingUsagePlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('missing_usage_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with invalid help (not HTML)', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: '/plugins/invalid-help-plugin',
				help: 'plain text help',
				params: [],
			},
			invalidHelpPlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('invalid_help_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with missing help field', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: '/plugins/missing-help-plugin',
				params: [],
			},
			missingHelpPlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('missing_help_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('rejects a plugin whose params declaration is not an array', () => {
		const {registeredPluginRoutes, logger} = buildApp({
			pluginModule: {
				meta: {
					usage: '/plugins/check-test',
					help: '<p>Help text</p>',
					params: 'not-an-array',
				},
				checkTest: () => ({
					message: 'ok',
					code: 0,
					performanceData: [],
				}),
			},
		});

		// A plugin that declares meta but whose params is not an array is
		// hard-rejected: a warning is logged and the route is never registered.
		const warningCalls = (logger.warn.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('meta.params is missing'),
		);
		expect(warningCalls.length).toBeGreaterThan(0);
		expect(registeredPluginRoutes).not.toContain('/plugins/check-test');
	});

	test('registers a plugin whose meta is null without a params warning', () => {
		const {registeredPluginRoutes, logger} = buildApp({
			pluginModule: {
				meta: null,
				checkTest: () => ({
					message: 'ok',
					code: 0,
					performanceData: [],
				}),
			},
		});

		// A null meta is not a metadata declaration, so the params contract does
		// not apply: the plugin registers and no warning is logged.
		const warningCalls = (logger.warn.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('meta.params is missing'),
		);
		expect(warningCalls.length).toBe(0);
		expect(registeredPluginRoutes).toContain('/plugins/check-test');
	});

	test('handles plugin with null plugin module', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => null) as ((
			modulePath: string,
		) => unknown) & {
			resolve: (modulePath: string) => string;
		};
		requireFn.resolve = (modulePath: string) => modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to null_module_plugin
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('null_module_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with undefined plugin module', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => undefined) as ((
			modulePath: string,
		) => unknown) & {
			resolve: (modulePath: string) => string;
		};
		requireFn.resolve = (modulePath: string) => modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to undefined_module_plugin
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('undefined_module_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with usage object missing http and shell', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: {foo: 'bar'},
				help: '<p>Help text</p>',
				params: [],
			},
			missingHttpShellPlugin: () => ({
				message: 'ok',
				code: 0,
				performanceData: [],
			}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('missing_http_shell_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with usage.http as non-string', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: {http: 123},
				help: '<p>Help text</p>',
				params: [],
			},
			invalidHttpPlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('invalid_http_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with usage.shell as non-string', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: {http: '/plugins/invalid-shell-plugin', shell: 456},
				help: '<p>Help text</p>',
				params: [],
			},
			invalidShellPlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('invalid_shell_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin execution when headers already sent', async () => {
		const {app} = buildApp({
			pluginFiles: ['check_test.ts'],
			pluginModule: {
				meta: {
					usage:
						'/plugins/check-test?nagiosReturnMessage=<string>&nagiosReturnValue=<0 | 1 | 2 | 3>&performanceData=<true | false>',
					help: '<p>Test plugin</p>',
					params: [],
				},
				checkTest: () => ({message: 'ok', code: 0, performanceData: []}),
			},
		});

		// Send headers first
		const res = await request(app)
			.get('/plugins/check-test')
			.query({
				nagiosReturnMessage: 'hello',
				nagiosReturnValue: '0',
			})
			.expect(HttpStatusCodes.OK);

		expect(res.body).toHaveProperty('message', 'ok');
		expect(res.body).toHaveProperty('code', 0);
	});

	test('handles plugin with usage as number (invalid)', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: 12345,
				help: '<p>Help text</p>',
				params: [],
			},
			invalidUsagePlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('invalid_usage_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('handles plugin with help as non-string', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: '/plugins/invalid-help-plugin',
				help: 12345,
				params: [],
			},
			invalidHelpPlugin: () => ({message: 'ok', code: 0, performanceData: []}),
		})) as ((modulePath: string) => unknown) & {
			resolve: (modulePath: string) => string;
		};
		requireFn.resolve = (modulePath: string) => modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Filter to only check calls specific to this test's plugin path
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('invalid_help_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('isPluginMeta rejects usage as number type', () => {
		jest.resetModules();

		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: 123,
				help: '<p>Help text</p>',
				params: [],
			},
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
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

		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: () => false,
				readdirSync: () => [],
				readFileSync: () => '',
				writeFileSync: () => undefined,
				mkdirSync: () => undefined,
				statSync: () => ({
					isFile: () => true,
					mtimeMs: 0,
					uid: 1000,
					mode: 0o100644,
				}),
			},
			existsSync: () => false,
			readdirSync: () => [],
			readFileSync: () => '',
			writeFileSync: () => undefined,
			mkdirSync: () => undefined,
			statSync: () => ({
				isFile: () => true,
				mtimeMs: 0,
				uid: 1000,
				mode: 0o100644,
			}),
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Plugin with usage as number should not log HTTP usage
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('http'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('isPluginMeta rejects params as non-array type', () => {
		jest.resetModules();

		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: {http: '/test'},
				help: '<p>Help text</p>',
				params: 'not-an-array',
			},
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
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

		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: () => false,
				readdirSync: () => [],
				readFileSync: () => '',
				writeFileSync: () => undefined,
				mkdirSync: () => undefined,
				statSync: () => ({
					isFile: () => true,
					mtimeMs: 0,
					uid: 1000,
					mode: 0o100644,
				}),
			},
			existsSync: () => false,
			readdirSync: () => [],
			readFileSync: () => '',
			writeFileSync: () => undefined,
			mkdirSync: () => undefined,
			statSync: () => ({
				isFile: () => true,
				mtimeMs: 0,
				uid: 1000,
				mode: 0o100644,
			}),
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Plugin with params as non-array should not log HTTP usage
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('http'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('isPluginMeta rejects null input', () => {
		jest.resetModules();

		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: null,
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
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

		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: () => false,
				readdirSync: () => [],
				readFileSync: () => '',
				writeFileSync: () => undefined,
				mkdirSync: () => undefined,
				statSync: () => ({
					isFile: () => true,
					mtimeMs: 0,
					uid: 1000,
					mode: 0o100644,
				}),
			},
			existsSync: () => false,
			readdirSync: () => [],
			readFileSync: () => '',
			writeFileSync: () => undefined,
			mkdirSync: () => undefined,
			statSync: () => ({
				isFile: () => true,
				mtimeMs: 0,
				uid: 1000,
				mode: 0o100644,
			}),
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Plugin with null meta should not log HTTP usage
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('http'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('isPluginMeta rejects missing params field', () => {
		jest.resetModules();

		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: {http: '/test'},
				help: '<p>Help text</p>',
				// Missing params field
			},
		})) as ((_modulePath: string) => unknown) & {
			resolve: (_modulePath: string) => string;
		};
		requireFn.resolve = (_modulePath: string) => _modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
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

		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: () => false,
				readdirSync: () => [],
				readFileSync: () => '',
				writeFileSync: () => undefined,
				mkdirSync: () => undefined,
				statSync: () => ({
					isFile: () => true,
					mtimeMs: 0,
					uid: 1000,
					mode: 0o100644,
				}),
			},
			existsSync: () => false,
			readdirSync: () => [],
			readFileSync: () => '',
			writeFileSync: () => undefined,
			mkdirSync: () => undefined,
			statSync: () => ({
				isFile: () => true,
				mtimeMs: 0,
				uid: 1000,
				mode: 0o100644,
			}),
		}));

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Plugin with missing params field should not log HTTP usage
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('http'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	describe('executePluginInMemory', () => {
		test('throws error when transpiled code not found in cache', () => {
			const virtualPath = 'memory://plugin/nonexistent-plugin';

			expect(() => executePluginInMemory(virtualPath)).toThrow(
				expect.objectContaining({
					message: `Transpiled code not found for ${virtualPath}`,
				}),
			);
		});
	});
});
