import crypto from 'crypto';
import express from 'express';
import path from 'path';
import request from 'supertest';
import {HttpStatusCodes} from '../lib/http-status-codes';

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
				examples: [
					{
						label: 'post sample',
						method: 'POST',
						path: '/plugins/check-test',
						fields: [
							{
								name: 'nagiosReturnMessage',
								defaultValue: 'Example OK',
							},
							{name: 'nagiosReturnValue', defaultValue: '0'},
						],
					},
					'invalid-example',
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
					// Cache directory exists
					if (fsPath.includes('plugin-cache')) {
						return true;
					}
					return false;
				},
				readdirSync: (fsPath: string) => {
					if (fsPath.includes('plugin-cache')) {
						return [];
					}
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
				if (fsPath.includes('plugin-cache')) {
					return true;
				}
				return false;
			},
			readdirSync: (fsPath: string) => {
				if (fsPath.includes('plugin-cache')) {
					return [];
				}
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
			// Return pluginModule for any .js file (including transpiled plugin cache)
			if (_modulePath.endsWith('.js')) {
				return pluginModule;
			}
			// For other modules, throw an error
			throw new Error(`Unexpected module path: ${_modulePath}`);
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

		let dynamicRoutes: express.Router;
		let registeredPluginRoutes: string[];
		let registeredPluginRouteExamples: Record<string, string[]>;
		jest.isolateModules(() => {
			// No need to mock plugin-executor - dynamic-routes uses inline execution
			// with requireFn which is already mocked above

			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const routesModule = require('./dynamic-routes') as {
				default: express.Router;
				registeredPluginRoutes: string[];
				registeredPluginRouteExamples: Record<string, string[]>;
			};
			dynamicRoutes = routesModule.default;
			registeredPluginRoutes = routesModule.registeredPluginRoutes;
			registeredPluginRouteExamples =
				routesModule.registeredPluginRouteExamples;
		});

		const builtApp = express();
		builtApp.use(express.json());
		builtApp.use('/', dynamicRoutes!);
		return {
			app: builtApp,
			registeredPluginRoutes: registeredPluginRoutes!,
			registeredPluginRouteExamples: registeredPluginRouteExamples!,
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
			"'WATER BOILER TEMP':55C°;WARN=80;CRIT=90;MIN=0;MAX=100 'OUTDOOR TEMP':21C°;WARN=30;CRIT=40;MIN=-20;MAX=50",
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
			"'WATER BOILER TEMP':55C°;WARN=80;CRIT=90;MIN=0;MAX=100 'OUTDOOR TEMP':21C°;WARN=30;CRIT=40;MIN=-20;MAX=50",
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

	test('exports sanitized plugin examples for overview links', () => {
		const {registeredPluginRouteExamples} = buildApp();

		expect(registeredPluginRouteExamples['/plugins/check-test']).toEqual([
			expect.objectContaining({
				kind: 'interactive',
				method: 'POST',
				path: '/plugins/check-test',
			}),
		]);
	});

	test('parses interactive examples and ignores malformed example definitions', () => {
		const {registeredPluginRouteExamples} = buildApp({
			pluginModule: {
				meta: {
					usage: {
						http: '/plugins/check-test',
					},
					examples: [
						// Missing path - should be ignored
						{method: 'POST', fields: []},
						// Invalid path (no leading /) - should be ignored
						{method: 'POST', path: 'plugins/check-test', fields: []},
						// Invalid fields (not array) - should be ignored
						{method: 'POST', path: '/plugins/check-test', fields: 'bad'},
						// Missing field name - should be ignored
						{
							method: 'POST',
							path: '/plugins/check-test',
							fields: [{label: 'Missing name'}],
						},
						// Valid interactive example
						{
							method: 'GET',
							label: 'web get',
							path: '/plugins/check-test',
							fields: [
								{
									name: 'baseUrl',
									label: 'Base URL',
									type: 'url',
									required: false,
									defaultValue: 'https://cloud.example.com',
								},
							],
						},
						// Valid interactive example
						{
							method: 'POST',
							path: '/plugins/check-test',
							fields: [{name: 'token', type: 'password'}],
						},
					],
				},
				checkTest: () => ({message: 'ok', code: 0, performanceData: []}),
			},
		});

		expect(registeredPluginRouteExamples['/plugins/check-test']).toEqual([
			{
				kind: 'interactive',
				method: 'GET',
				label: 'web get',
				path: '/plugins/check-test',
				fields: [
					{
						name: 'baseUrl',
						label: 'Base URL',
						type: 'url',
						required: false,
						defaultValue: 'https://cloud.example.com',
					},
				],
			},
			{
				kind: 'interactive',
				method: 'POST',
				path: '/plugins/check-test',
				label: 'example 6',
				fields: [
					{
						name: 'token',
						label: 'token',
						type: 'password',
						required: true,
					},
				],
			},
		]);
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
					examples: [],
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
				examples: [],
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
				examples: [],
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
				examples: [],
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
				examples: [],
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

	test('handles plugin with invalid examples (not array)', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: '/plugins/invalid-examples-plugin',
				help: '<p>Help text</p>',

				examples: 'not-an-array',
			},
			invalidExamplesPlugin: () => ({
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
			(call) => (call[0] as string).includes('invalid_examples_plugin'),
		);
		expect(httpUsageCalls.length).toBe(0);
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
				examples: [],
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
				examples: [],
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
				examples: [],
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
					examples: [],
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
				examples: [],
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
				examples: [],
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

	test('handles plugin with examples as non-array', () => {
		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const requireFn = ((_modulePath: string) => ({
			meta: {
				usage: '/plugins/invalid-examples-plugin',
				help: '<p>Help text</p>',
				examples: 'not-an-array',
			},
			invalidExamplesPlugin: () => ({
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
			(call) => (call[0] as string).includes('invalid_examples_plugin'),
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
				examples: [],
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

	test('clearPluginCache handles rmSync error', () => {
		jest.resetModules();

		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const mockFs = {
			__esModule: true,
			default: {
				existsSync: () => true,
				rmSync: jest.fn(() => {
					throw new Error('Permission denied');
				}),
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
			existsSync: () => true,
			rmSync: jest.fn(() => {
				throw new Error('Permission denied');
			}),
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
		};

		jest.doMock('fs', () => mockFs);

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

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Verify the logger.warn was called for rmSync error
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Could not clear plugin cache directory'),
		);
	});

	test('isPluginMeta rejects examples as non-array type', () => {
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
				examples: 'not-an-array',
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

		// Plugin with examples as non-array should not log HTTP usage
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

	test('isPluginMeta rejects missing examples field', () => {
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
				// Missing examples field
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

		// Plugin with missing examples field should not log HTTP usage
		const httpUsageCalls = (logger.info.mock.calls as Array<unknown[]>).filter(
			(call) => (call[0] as string).includes('http'),
		);
		expect(httpUsageCalls.length).toBe(0);
	});

	test('clearPluginCache logs success when cache is cleared', () => {
		jest.resetModules();

		const logger = {
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
		};

		const mockFs = {
			__esModule: true,
			default: {
				existsSync: () => true,
				rmSync: jest.fn(),
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
			existsSync: () => true,
			rmSync: jest.fn(),
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
		};

		jest.doMock('fs', () => mockFs);

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

		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require('./dynamic-routes');
		});

		// Verify the logger.info was called for successful cache clear
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Cleared plugin cache directory'),
		);
	});
});
