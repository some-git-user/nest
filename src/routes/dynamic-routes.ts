import express from 'express';
import fs from 'fs';
import {createRequire} from 'module';
import path from 'path';
import ts from 'typescript';
import {env} from '../config/env';
import {
	PluginHelpContext,
	createPluginRouteHandler,
} from '../controllers/dynamic-routes';
import {getErrorMessage} from '../lib/error-message';
import {validateUnixFileSecurity} from '../lib/file-security';
import {logger} from '../lib/logger';
import {verifyPluginWhitelist} from '../lib/plugin-whitelist';
import {
	recordStartupWarning,
	recordStartupWarnings,
} from '../lib/startup-warning-registry';
import type {
	PluginExampleField,
	PluginExampleFieldInputType,
	PluginMeta,
	PluginMetaUsage,
	PluginRouteExample,
} from '../types/plugin-meta';

const router = express.Router();
const pluginsDir = path.resolve(process.cwd(), env.PLUGINS_DIR);
const pluginCacheDir = path.join(pluginsDir, 'plugin-cache');
const pluginRoutePrefix = '/plugins';
const requireFn = createRequire(__filename);
const configuredPluginWhitelistPath = String(
	env.PLUGIN_WHITELIST_PATH || '',
).trim();
const pluginWhitelistPath = path.resolve(
	process.cwd(),
	configuredPluginWhitelistPath ||
		path.join(pluginsDir, 'plugin-whitelist.txt'),
);

export const pluginStartupWarnings: string[] = [];
export const registeredPluginRoutes: string[] = [];

export type {
	PluginExampleField,
	PluginExampleFieldInputType,
	PluginMeta,
	PluginMetaUsage,
	PluginRouteExample,
} from '../types/plugin-meta';

export const registeredPluginRouteExamples: Record<
	string,
	PluginRouteExample[]
> = {};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const toInputType = (value: unknown): PluginExampleFieldInputType => {
	if (value === 'password' || value === 'url' || value === 'text') {
		return value;
	}

	return 'text';
};

const getPluginMetaExamples = (pluginModule: unknown): PluginRouteExample[] => {
	if (typeof pluginModule !== 'object' || pluginModule === null) {
		return [];
	}

	const moduleRecord = pluginModule as Record<string, unknown>;
	if (typeof moduleRecord.meta !== 'object' || moduleRecord.meta === null) {
		return [];
	}

	const meta = moduleRecord.meta as PluginMeta;
	if (!Array.isArray(meta.examples)) {
		return [];
	}

	const parsedExamples: PluginRouteExample[] = [];
	meta.examples.forEach((example, index) => {
		const defaultLabel = `example ${index + 1}`;

		if (typeof example === 'string' && example.startsWith('/')) {
			parsedExamples.push({
				kind: 'link',
				label: defaultLabel,
				method: 'GET',
				href: example,
			});
			return;
		}

		if (!isRecord(example)) {
			return;
		}

		const method = example.method === 'POST' ? 'POST' : 'GET';
		const pathValue = typeof example.path === 'string' ? example.path : '';
		if (!pathValue.startsWith('/')) {
			return;
		}

		if (!Array.isArray(example.fields)) {
			return;
		}

		const fields = example.fields
			.filter(isRecord)
			.map((field): PluginExampleField | undefined => {
				const name = typeof field.name === 'string' ? field.name : '';
				if (!name) {
					return undefined;
				}
				const parsedField: PluginExampleField = {
					name,
					label: typeof field.label === 'string' ? field.label : name,
					required: field.required !== false,
					type: toInputType(field.type),
				};

				if (typeof field.defaultValue === 'string') {
					parsedField.defaultValue = field.defaultValue;
				}

				return parsedField;
			})
			.filter((field): field is PluginExampleField => field !== undefined);

		if (fields.length === 0) {
			return;
		}

		parsedExamples.push({
			kind: 'interactive',
			label:
				typeof example.label === 'string' && example.label.trim().length > 0
					? example.label
					: defaultLabel,
			method,
			path: pathValue,
			fields,
		});
	});

	return parsedExamples;
};

const getPluginMetaUsage = (
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

const getPluginMetaHelp = (pluginModule: unknown): string | undefined => {
	if (typeof pluginModule !== 'object' || pluginModule === null) {
		return undefined;
	}
	const moduleRecord = pluginModule as Record<string, unknown>;
	if (typeof moduleRecord.meta !== 'object' || moduleRecord.meta === null) {
		return undefined;
	}
	const meta = moduleRecord.meta as PluginMeta;
	return typeof meta.help === 'string' ? meta.help : undefined;
};

const logPluginUsage = (
	pluginPath: string,
	usage: PluginMetaUsage,
	helpUrl: string,
): void => {
	if (typeof usage === 'string') {
		logger.info(`Usage for plugin ${pluginPath}: ${usage} | Help: ${helpUrl}`);
		return;
	}

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

const buildPluginRoutePath = (file: string): string => {
	const normalizedPathSegment = path
		.basename(file, path.extname(file))
		.replace(/[^a-zA-Z0-9]/g, '-')
		.toLowerCase();

	return `${pluginRoutePrefix}/${normalizedPathSegment}`;
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

const resolveRuntimePluginPath = (
	filePath: string,
	fileName: string,
): string | undefined => {
	if (fileName.endsWith('.js')) {
		logger.info(`Loaded JS plugin without transpilation: ${filePath}`);
		return filePath;
	}

	const jsCachePath = path.join(
		pluginCacheDir,
		fileName.replace(/\.ts$/, '.js'),
	);

	let sourceMtimeMs = 0;
	let cacheMtimeMs = -1;

	try {
		const sourceStat = fs.statSync(filePath);
		sourceMtimeMs =
			typeof sourceStat.mtimeMs === 'number' ? sourceStat.mtimeMs : 0;
	} catch (err) {
		warnWithError(`Could not stat plugin file ${filePath}`, err);
		return undefined;
	}

	try {
		const cacheStat = fs.statSync(jsCachePath);
		cacheMtimeMs =
			typeof cacheStat.mtimeMs === 'number' ? cacheStat.mtimeMs : -1;
	} catch {
		cacheMtimeMs = -1;
	}

	if (cacheMtimeMs >= sourceMtimeMs) {
		logger.debug(`Using cached transpiled plugin: ${jsCachePath}`);
		return jsCachePath;
	}

	try {
		fs.mkdirSync(pluginCacheDir, {recursive: true});
		const tsCode = fs.readFileSync(filePath, 'utf-8');
		const result = ts.transpileModule(tsCode, {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				target: ts.ScriptTarget.ESNext,
				esModuleInterop: true,
				allowSyntheticDefaultImports: true,
				outDir: path.dirname(jsCachePath),
			},
		});

		fs.writeFileSync(jsCachePath, result.outputText);
		logger.info(`Transpiled TS plugin to cache: ${filePath} -> ${jsCachePath}`);
		return jsCachePath;
	} catch (err) {
		warnWithError(`Could not transpile plugin ${filePath}`, err);
		return undefined;
	}
};

logger.info(`Use plugins directory: ${pluginsDir}`);

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

	const kebabCasePath = buildPluginRoutePath(file);
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
	let pluginExamples: PluginRouteExample[] = [];
	try {
		const pluginModule: unknown = requireFn(runtimePluginPath);
		const usage = getPluginMetaUsage(pluginModule);
		pluginExamples = getPluginMetaExamples(pluginModule);
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
	} catch (err) {
		warnWithError(`Could not load plugin metadata for ${filePath}`, err);
	}

	const handler = createPluginRouteHandler(
		runtimePluginPath,
		kebabCasePath,
		helpContext,
	);
	router.get(kebabCasePath, handler);
	router.post(kebabCasePath, handler);
	registeredPluginRoutes.push(kebabCasePath);
	if (pluginExamples.length > 0) {
		registeredPluginRouteExamples[kebabCasePath] = pluginExamples;
	}
});

registeredPluginRoutes.sort((a, b) => a.localeCompare(b));

export default router;
