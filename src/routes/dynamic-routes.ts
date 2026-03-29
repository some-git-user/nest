import express from 'express';
import fs from 'fs';
import {createRequire} from 'module';
import path from 'path';
import ts from 'typescript';
import {env} from '../config/env';
import {createPluginRouteHandler} from '../controllers/dynamic-routes';
import {getErrorMessage} from '../lib/error-message';
import {validateUnixFileSecurity} from '../lib/file-security';
import {logger} from '../lib/logger';

const router = express.Router();
const pluginsDir = path.join(process.cwd(), env.PLUGINS_DIR);
const pluginCacheDir = path.join(pluginsDir, 'plugin-cache');
const pluginRoutePrefix = '/plugins';
const requireFn = createRequire(__filename);

type PluginMetaUsage =
	| string
	| {
			http?: string;
			shell?: string;
	  };

type PluginMeta = {
	usage?: PluginMetaUsage;
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

const logPluginUsage = (pluginPath: string, usage: PluginMetaUsage): void => {
	if (typeof usage === 'string') {
		logger.info(`Usage for plugin ${pluginPath}: ${usage}`);
		return;
	}

	if (usage.http) {
		logger.info(`HTTP usage for plugin ${pluginPath}: ${usage.http}`);
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
		logger.warn(
			`Skipping plugin ${filePath} due to insecure permissions: plugin files must not be writable by group or others.`,
		);
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
const routePathToFilePath = new Map<string, string>();

pluginFiles.forEach((file) => {
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
	const existingFilePath = routePathToFilePath.get(kebabCasePath);
	if (existingFilePath) {
		logger.warn(
			`Skipping plugin ${filePath} because route ${kebabCasePath} already belongs to ${existingFilePath}. Keep plugin filenames unique after kebab-case normalization.`,
		);
		return;
	}
	routePathToFilePath.set(kebabCasePath, filePath);
	logger.info(
		`GET route initialized for plugin: ${filePath}: http://${env.HOST}:${env.PORT}${kebabCasePath}`,
	);

	try {
		const pluginModule: unknown = requireFn(runtimePluginPath);
		const usage = getPluginMetaUsage(pluginModule);
		if (usage) {
			logPluginUsage(filePath, usage);
		}
	} catch (err) {
		warnWithError(`Could not load plugin metadata for ${filePath}`, err);
	}

	router.get(
		kebabCasePath,
		createPluginRouteHandler(runtimePluginPath, kebabCasePath),
	);
});

export default router;
