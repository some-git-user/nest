import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

type BuildAppOptions = {
	pluginFiles?: string[];
	nodeEnv?: string;
	pluginFileUid?: number;
	pluginFileMode?: number;
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
		const approvedHash = crypto
			.createHash('sha256')
			.update(pluginSource)
			.digest('hex');
		const whitelistPath = `${process.cwd()}/plugins/plugin-whitelist.txt`;
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

		const pluginModule = {
			meta: {
				usage: {
					http: usageHttp,
					shell:
						'./check_nest.sh check-test nagiosReturnMessage=<string> nagiosReturnValue=<0 | 1 | 2 | 3> performanceData=<true | false>',
				},
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
				existsSync: (fsPath: string) => fsPath === whitelistPath,
				readdirSync: () => pluginFiles,
				readFileSync: (fsPath: string) =>
					fsPath === whitelistPath
						? pluginFiles
								.filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
								.map((file) => `${file} ${approvedHash}`)
								.join('\n')
						: pluginSource,
				writeFileSync: () => undefined,
				mkdirSync: () => undefined,
				statSync: statSyncMock,
			},
			existsSync: (fsPath: string) => fsPath === whitelistPath,
			readdirSync: () => pluginFiles,
			readFileSync: (fsPath: string) =>
				fsPath === whitelistPath
					? pluginFiles
							.filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
							.map((file) => `${file} ${approvedHash}`)
							.join('\n')
					: pluginSource,
			writeFileSync: () => undefined,
			mkdirSync: () => undefined,
			statSync: statSyncMock,
		}));

		const transpileModule = jest.fn(() => ({
			outputText: 'module.exports = {};',
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

		const requireFn = ((modulePath: string) => {
			if (!modulePath.endsWith('.js')) {
				throw new Error(`Unexpected module path: ${modulePath}`);
			}
			return pluginModule;
		}) as ((modulePath: string) => unknown) & {
			resolve: (modulePath: string) => string;
		};
		requireFn.resolve = (modulePath: string) => modulePath;

		jest.doMock('module', () => ({
			createRequire: () => requireFn,
		}));

		jest.doMock('../config/env', () => ({
			env: {
				NODE_ENV: options.nodeEnv ?? 'production',
				HOST: 'localhost',
				PORT: 5000,
				PLUGINS_DIR: 'plugins',
				PLUGIN_WHITELIST_PATH: '',
				LOG_FILE_PATH: 'logs/nest.log',
			},
		}));

		jest.doMock('../lib/logger', () => ({
			logger,
		}));

		let dynamicRoutes: express.Router;
		let registeredPluginRoutes: string[];
		jest.isolateModules(() => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const routesModule = require('./dynamic-routes') as {
				default: express.Router;
				registeredPluginRoutes: string[];
			};
			dynamicRoutes = routesModule.default;
			registeredPluginRoutes = routesModule.registeredPluginRoutes;
		});

		const builtApp = express();
		builtApp.use(express.json());
		builtApp.use('/', dynamicRoutes!);
		return {app: builtApp, registeredPluginRoutes: registeredPluginRoutes!};
	};

	beforeEach(() => {
		app = buildApp().app;
	});

	afterEach(() => {
		cleanupTestMocks();
	});

	test('check-test plugin returns a Nagios-style JSON object', async () => {
		const res = await request(app).get('/plugins/check-test').query({
			nagiosReturnMessage: 'hello',
			nagiosReturnValue: '0',
			performanceData: 'true',
		});

		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('message', 'hello');
		expect(res.body).toHaveProperty('code', 0);
		expect(res.body).toHaveProperty(
			'performanceData',
			"'WATER BOILER TEMP':55C°;WARN=80;CRIT=90;MIN=0;MAX=100 'OUTDOOR TEMP':21C°;WARN=30;CRIT=40;MIN=-20;MAX=50",
		);
	});

	test('check-test plugin returns usage and UNKNOWN code when required parameters are missing', async () => {
		const res = await request(app).get('/plugins/check-test').query({
			performanceData: 'true',
		});

		expect(res.status).toBe(200);
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

		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('message', 'plain');
		expect(res.body).toHaveProperty('code', 1);
		expect(res.body).toHaveProperty('performanceData', '');
	});

	test('check-test plugin normalizes invalid plugin code to UNKNOWN', async () => {
		const res = await request(app).get('/plugins/check-test').query({
			nagiosReturnMessage: 'invalid-code',
			nagiosReturnValue: '9',
			performanceData: 'true',
		});

		expect(res.status).toBe(200);
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

		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('message', 'dev-mode');
		expect(res.body).toHaveProperty('code', 0);
	});
});
