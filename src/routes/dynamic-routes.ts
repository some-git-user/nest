import express from 'express';
import fs from 'fs';
import {createRequire} from 'module';
import path from 'path';
import ts from 'typescript';
import vm from 'vm';
import {env} from '../config/env';
import {
	PluginHelpContext,
	createPluginRouteHandler,
	setTranspiledPlugin,
} from '../controllers/dynamic-routes';
import {getErrorMessage} from '../lib/error-message';
import {validateUnixFileSecurity} from '../lib/file-security';
import {logger} from '../lib/logger';
import {buildPluginSandbox} from '../lib/plugin-sandbox';
import {commandToRoutePath} from '../lib/plugin-utils';
import {verifyPluginWhitelist} from '../lib/plugin-whitelist';
import {
	recordStartupWarning,
	recordStartupWarnings,
} from '../lib/startup-warning-registry';
import type {
	HtmlTemplateString,
	PluginMeta,
	PluginMetaUsage,
	PluginParam,
	PluginParamInputType,
} from '../types/plugin';

// VM dependency injection for testability
// This allows tests to mock vm.createContext and vm.runInContext
// Using arrow functions to defer binding until runtime (so mocks work)
export const vmApi = {
	createContext: (contextObject?: unknown): vm.Context => {
		return vm.createContext(contextObject as vm.Context | undefined);
	},
	runInContext: (code: string, context: vm.Context): unknown =>
		vm.runInContext(code, context),
};

const router = express.Router();
const pluginsDir = path.resolve(process.cwd(), env.PLUGINS_DIR);
const pluginRoutePrefix = '/plugins';
const requireFn = createRequire(__filename);
const pluginWhitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');

export const pluginStartupWarnings: string[] = [];
export const registeredPluginRoutes: string[] = [];

export type {
	PluginMeta,
	PluginMetaUsage,
	PluginParam,
	PluginParamInputType,
} from '../types/plugin';

export const registeredPluginRouteParams: Record<string, PluginParam[]> = {};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const toInputType = (value: unknown): PluginParamInputType => {
	if (
		value === 'password' ||
		value === 'url' ||
		value === 'text' ||
		value === 'number' ||
		value === 'boolean'
	) {
		return value;
	}

	return 'text';
};

export const getPluginMetaParams = (pluginModule: unknown): PluginParam[] => {
	if (typeof pluginModule !== 'object' || pluginModule === null) {
		return [];
	}

	const moduleRecord = pluginModule as Record<string, unknown>;
	if (typeof moduleRecord.meta !== 'object' || moduleRecord.meta === null) {
		return [];
	}

	const meta = moduleRecord.meta as PluginMeta;
	if (!Array.isArray(meta.params)) {
		return [];
	}

	const parsedParams: PluginParam[] = [];
	meta.params.forEach((param) => {
		if (!isRecord(param)) {
			return;
		}

		const name = typeof param.name === 'string' ? param.name.trim() : '';
		if (!name) {
			return;
		}

		const parsedParam: PluginParam = {
			name,
			label:
				typeof param.label === 'string' && param.label.length > 0
					? param.label
					: name,
			required: param.required === true,
			type: toInputType(param.type),
		};

		if (typeof param.default === 'string') {
			parsedParam.default = param.default;
		}

		if (typeof param.description === 'string' && param.description.length > 0) {
			parsedParam.description = param.description;
		}

		parsedParams.push(parsedParam);
	});

	return parsedParams;
};

/**
 * Whether a plugin module ships a `meta` object. A module that declares
 * metadata commits to also declaring its parameter set (see
 * {@link hasParamsDeclaration}); a metadata-less module is exempt and stays
 * loadable, it simply has no run form.
 */
export const declaresPluginMeta = (pluginModule: unknown): boolean => {
	if (typeof pluginModule !== 'object' || pluginModule === null) {
		return false;
	}

	const meta = (pluginModule as Record<string, unknown>).meta;
	return typeof meta === 'object' && meta !== null;
};

/**
 * Whether a plugin module declares `meta.params` as an array.
 *
 * Enforced at load time: a plugin without a parameter declaration cannot be
 * edited in the admin UI or rendered as a run form, so it is rejected rather
 * than silently loaded with an empty parameter set.
 */
export const hasParamsDeclaration = (pluginModule: unknown): boolean => {
	if (typeof pluginModule !== 'object' || pluginModule === null) {
		return false;
	}

	const moduleRecord = pluginModule as Record<string, unknown>;
	if (typeof moduleRecord.meta !== 'object' || moduleRecord.meta === null) {
		return false;
	}

	return Array.isArray((moduleRecord.meta as Record<string, unknown>).params);
};

export const getPluginMetaUsage = (
	pluginModule: unknown,
): PluginMetaUsage | undefined => {
	if (typeof pluginModule !== 'object' || pluginModule === null) {
		return undefined;
	}

	const moduleRecord = pluginModule as Record<string, unknown>;
	if (typeof moduleRecord.meta !== 'object' || moduleRecord.meta === null) {
		return undefined;
	}

	const meta = moduleRecord.meta as PluginMeta;
	if (typeof meta.usage === 'string') {
		return meta.usage;
	}

	if (typeof meta.usage === 'object' && meta.usage !== null) {
		return meta.usage;
	}

	return undefined;
};

const isValidHtml = (value: string): boolean => {
	// HTML syntax validation - check for at least one valid HTML tag
	// This catches cases where plain text is accidentally used instead of HTML
	// Pattern handles quoted attributes with > characters inside
	// Based on best practices guides from Stack Overflow and MDN
	return /<(?:"[^"]*"['"]*|'[^']*'['"]*|[^'">])+>/.test(value);
};

const isHtmlTemplateString = (value: unknown): value is HtmlTemplateString => {
	if (typeof value !== 'string') {
		return false;
	}

	return isValidHtml(value);
};

export const isPluginMeta = (value: unknown): value is PluginMeta => {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const record = value as Record<string, unknown>;

	// Validate usage field
	if (!('usage' in record)) {
		return false;
	}

	const usage = record.usage;
	if (
		typeof usage !== 'string' &&
		!(typeof usage === 'object' && usage !== null)
	) {
		return false;
	}

	if (typeof usage === 'object') {
		const usageRecord = usage as Record<string, unknown>;
		if ('http' in usageRecord && typeof usageRecord.http !== 'string') {
			return false;
		}
		if ('shell' in usageRecord && typeof usageRecord.shell !== 'string') {
			return false;
		}
	}

	// Validate help field - must be a string (HTML template)
	if (!('help' in record)) {
		return false;
	}

	if (!isHtmlTemplateString(record.help)) {
		return false;
	}

	// Validate params field - must be an array of parameter definitions
	if (!('params' in record)) {
		return false;
	}

	if (!Array.isArray(record.params)) {
		return false;
	}

	return true;
};

export const getPluginMetaHelp = (
	pluginModule: unknown,
): HtmlTemplateString | undefined => {
	if (typeof pluginModule !== 'object' || pluginModule === null) {
		return undefined;
	}

	const moduleRecord = pluginModule as Record<string, unknown>;
	if (typeof moduleRecord.meta !== 'object' || moduleRecord.meta === null) {
		return undefined;
	}

	if (!isPluginMeta(moduleRecord.meta)) {
		return undefined;
	}

	return moduleRecord.meta.help;
};

const logPluginUsage = (
	pluginPath: string,
	usage: PluginMetaUsage,
	helpUrl: string,
): void => {
	if (usage.http) {
		logger.info(
			`HTTP usage for plugin ${pluginPath}: ${usage.http} | Help: ${helpUrl}`,
		);
	}

	if (usage.shell) {
		logger.info(`Shell usage for plugin ${pluginPath}: ${usage.shell}`);
	}
};

const warnWithError = (messagePrefix: string, err: unknown): void => {
	const errorMessage = getErrorMessage(err);
	logger.warn(`${messagePrefix}. Error: ${errorMessage}`);
};

const isIgnoredPluginFile = (file: string): boolean => {
	return (
		file.endsWith('.test.ts') ||
		file.endsWith('.spec.ts') ||
		file.endsWith('.test.js') ||
		file.endsWith('.spec.js') ||
		file.endsWith('.d.ts')
	);
};

const isSupportedPluginFile = (file: string): boolean => {
	if (isIgnoredPluginFile(file)) {
		return false;
	}

	return file.endsWith('.ts') || file.endsWith('.js');
};

const buildPluginHelpUrl = (kebabCasePath: string): string => {
	return `https://${env.HOST}:${env.PORT}${kebabCasePath}?help`;
};

const isPluginFileSecurityAcceptable = (
	filePath: string,
	fileStat: fs.Stats,
): boolean => {
	if (env.NODE_ENV !== 'production') {
		return true;
	}

	if (typeof process.getuid !== 'function') {
		return true;
	}

	const processUid = process.getuid();
	const validation = validateUnixFileSecurity(fileStat, processUid);
	if (!validation.ok && validation.reason === 'owner-mismatch') {
		logger.warn(
			`Skipping plugin ${filePath} due to insecure ownership: file uid ${validation.actualUid} does not match process uid ${validation.expectedUid}.`,
		);
		return false;
	}

	if (!validation.ok && validation.reason === 'group-or-other-writable') {
		const warning = `Skipping plugin ${filePath} due to insecure permissions: plugin files must not be writable by group or others.`;
		recordStartupWarning(warning);
		logger.warn(warning);
		return false;
	}

	return true;
};

// In-memory storage for transpiled plugin code
const transpiledPlugins = new Map<string, string>();

const transpilePluginInMemory = (
	filePath: string,
	fileName: string,
): string | undefined => {
	const virtualPath = `memory://plugin/${fileName}`;

	try {
		const tsCode = fs.readFileSync(filePath, 'utf-8');
		const result = ts.transpileModule(tsCode, {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				target: ts.ScriptTarget.ESNext,
				esModuleInterop: true,
				allowSyntheticDefaultImports: true,
			},
		});

		// Inline NagiosReturnCodes to avoid runtime import dependencies
		let outputText = result.outputText;

		// Remove the import statement for nagios module
		outputText = outputText.replace(
			/const nagios_1 = require\("([^"]*)"\);?\n?/g,
			'',
		);

		// Inline the NagiosReturnCodes constant directly
		outputText = outputText.replace(
			/nagios_1\.NagiosReturnCodes\.(OK|WARNING|CRITICAL|UNKNOWN)/g,
			(match: string, code: string) => {
				const values: Record<string, string> = {
					OK: '0',
					WARNING: '1',
					CRITICAL: '2',
					UNKNOWN: '3',
				};
				return values[code];
			},
		);

		// Store transpiled code in memory
		transpiledPlugins.set(virtualPath, outputText);
		// Also share with controller module for execution
		setTranspiledPlugin(virtualPath, outputText);
		logger.info(
			`Transpiled TS plugin to memory: ${filePath} -> ${virtualPath}`,
		);
		return virtualPath;
	} catch (err) {
		warnWithError(`Could not transpile plugin ${filePath}`, err);
		return undefined;
	}
};

const resolveRuntimePluginPath = (
	filePath: string,
	fileName: string,
): string | undefined => {
	if (fileName.endsWith('.js')) {
		logger.info(`Loaded JS plugin without transpilation: ${filePath}`);
		return filePath;
	}

	// For TypeScript plugins, transpile in-memory and return virtual path
	return transpilePluginInMemory(filePath, fileName);
};

export const executePluginInMemory = (virtualPath: string): unknown => {
	const transpiledCode = transpiledPlugins.get(virtualPath);
	if (!transpiledCode) {
		throw new Error(`Transpiled code not found for ${virtualPath}`);
	}

	// Create vm context with proper module.exports and exports synchronization
	// TypeScript transpiles to Object.defineProperty(exports, "__esModule", ...)
	// so exports and module.exports must reference the SAME object
	const moduleExports: Record<string, unknown> = {};
	const context: vm.Context = vmApi.createContext(
		buildPluginSandbox({
			require: createRequire(__filename),
			module: {exports: moduleExports},
			exports: moduleExports, // Same reference as module.exports
			__filename: virtualPath,
			__dirname: pluginsDir,
		}),
	);

	// Execute transpiled code directly in vm context
	// The code uses Object.defineProperty(exports, "__esModule", ...)
	// which will work because exports and module.exports are the same object
	vmApi.runInContext(transpiledCode, context);

	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
	return context.module.exports as Record<string, unknown>;
};

const loadPluginModule = (runtimePluginPath: string): unknown => {
	// For memory://plugin paths, execute via vm
	if (runtimePluginPath.startsWith('memory://plugin/')) {
		return executePluginInMemory(runtimePluginPath);
	}

	// For filesystem paths, use normal require
	return requireFn(runtimePluginPath);
};

logger.info(`Use plugins directory: ${pluginsDir}`);

// Transpiled code stored in memory only - no disk caching

const pluginFiles = fs.readdirSync(pluginsDir).filter(isSupportedPluginFile);
const tsPluginBaseNames = new Set(
	pluginFiles
		.filter((file) => file.endsWith('.ts'))
		.map((file) => path.basename(file, '.ts')),
);

const effectivePluginFiles = pluginFiles.filter((file) => {
	if (
		file.endsWith('.js') &&
		tsPluginBaseNames.has(path.basename(file, '.js'))
	) {
		logger.debug(
			`Skipping JS plugin because matching TS plugin exists: ${path.join(
				pluginsDir,
				file,
			)}`,
		);
		return false;
	}

	return true;
});

const pluginWhitelistVerification = verifyPluginWhitelist({
	pluginsDir,
	pluginFiles: effectivePluginFiles,
	whitelistPath: pluginWhitelistPath,
});
pluginStartupWarnings.push(...pluginWhitelistVerification.warnings);
recordStartupWarnings(pluginWhitelistVerification.warnings);
for (const warning of pluginStartupWarnings) {
	logger.warn(warning);
}

const routePathToFilePath = new Map<string, string>();

effectivePluginFiles.forEach((file) => {
	if (!pluginWhitelistVerification.approvedFiles.has(file)) {
		return;
	}

	const filePath = path.join(pluginsDir, file);
	const fileStat = fs.statSync(filePath);
	if (!fileStat.isFile()) {
		return;
	}

	if (!isPluginFileSecurityAcceptable(filePath, fileStat)) {
		return;
	}

	const runtimePluginPath = resolveRuntimePluginPath(filePath, file);
	if (!runtimePluginPath) {
		return;
	}

	const kebabCasePath = commandToRoutePath(
		path.basename(file, path.extname(file)),
	);
	const helpUrl = buildPluginHelpUrl(kebabCasePath);
	const existingFilePath = routePathToFilePath.get(kebabCasePath);
	if (existingFilePath) {
		const warning = `Skipping plugin ${filePath} because route ${kebabCasePath} already belongs to ${existingFilePath}. Keep plugin filenames unique after kebab-case normalization.`;
		recordStartupWarning(warning);
		logger.warn(warning);
		return;
	}
	routePathToFilePath.set(kebabCasePath, filePath);
	logger.info(
		`GET route initialized for plugin: ${filePath}: https://${env.HOST}:${env.PORT}${kebabCasePath}`,
	);

	let helpContext: PluginHelpContext = {};
	let pluginParams: PluginParam[] = [];
	let pluginRejected = false;
	try {
		const pluginModule: unknown = loadPluginModule(runtimePluginPath);
		// A plugin that ships metadata must declare its parameter set, so the
		// admin UI and overview run-form can expose every settable option. A
		// metadata-less module stays loadable (it simply has no run form).
		if (
			declaresPluginMeta(pluginModule) &&
			!hasParamsDeclaration(pluginModule)
		) {
			const warning = `Skipping plugin ${filePath} because meta.params is missing. Every plugin must declare its settable parameters in meta.params, even if it has none.`;
			recordStartupWarning(warning);
			logger.warn(warning);
			pluginRejected = true;
		} else {
			pluginParams = getPluginMetaParams(pluginModule);
			const usage = getPluginMetaUsage(pluginModule);
			let usageHttp: string | undefined;
			let usageShell: string | undefined;
			if (usage) {
				logPluginUsage(filePath, usage, helpUrl);
				if (typeof usage === 'string') {
					usageHttp = usage;
				} else {
					usageHttp = usage.http;
					usageShell = usage.shell;
				}
			}
			helpContext = {
				pluginName: path.basename(file, path.extname(file)),
				helpHtml: getPluginMetaHelp(pluginModule),
				usageHttp,
				usageShell,
			};
		}
	} catch (err) {
		warnWithError(`Could not load plugin metadata for ${filePath}`, err);
	}

	if (pluginRejected) {
		return;
	}

	const handler = createPluginRouteHandler(
		runtimePluginPath,
		kebabCasePath,
		helpContext,
	);
	router.get(kebabCasePath, handler);
	router.post(kebabCasePath, handler);
	registeredPluginRoutes.push(kebabCasePath);
	if (pluginParams.length > 0) {
		registeredPluginRouteParams[kebabCasePath] = pluginParams;
	}
});

registeredPluginRoutes.sort((a, b) => a.localeCompare(b));

export default router;
