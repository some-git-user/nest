import express, {Request, Response} from 'express';
import fs from 'fs';
import {createRequire} from 'module';
import path from 'path';
import ts from 'typescript';
import {env} from '../config/env';
import {logger} from '../lib/logger';
import {
	createNagiosReturnMessage,
	isPerformanceData,
	isPerformanceDataArray,
} from '../lib/nagios';
import {NagiosReturnValuesEnum, PerformanceData} from '../types/nagios';

const router = express.Router();
const pluginsDir = path.join(process.cwd(), env.PLUGINS_DIR);

logger.info(`Use plugins directory: ${pluginsDir}`);

fs.readdirSync(pluginsDir)?.forEach((file) => {
	const filePath = path.join(pluginsDir, file);
	const jsFilePath = filePath.replace(/\.ts$/, '.js');

	const tsCode = fs.readFileSync(filePath, 'utf-8');
	const result = ts.transpileModule(tsCode, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ESNext,
			esModuleInterop: true,
			allowSyntheticDefaultImports: true,
			outDir: path.dirname(jsFilePath),
		},
	});

	fs.writeFileSync(jsFilePath, result.outputText);

	const fileStat = fs.statSync(filePath);

	if (fileStat.isFile() && filePath.endsWith('.ts')) {
		const kebabCasePath = `/${path
			.basename(file, path.extname(file))
			.replace(/[^a-zA-Z0-9]/g, '-')
			.toLowerCase()}`;
		logger.info(
			`GET route initialized for plugin: ${filePath}: http://${env.HOST}:${env.PORT}${kebabCasePath}`,
		);

		router.get(kebabCasePath, (req: Request, res: Response) => {
			(async () => {
				try {
					const requireFn = createRequire(__filename);
					// clear require cache to allow reloading updated plugins
					try {
						const resolved = requireFn.resolve(jsFilePath);
						delete require.cache[resolved];
					} catch (e) {
						logger.warn(
							`Could not resolve plugin path for cache clearing: ${jsFilePath}. Error: ${e}`,
						);
					}
					const module = requireFn(jsFilePath);

					let func: (params: {
						[key: string]: string;
					}) => Promise<unknown> = () => {
						throw new Error('Function not found');
					};

					const funcMatch = Object.values(module).find(
						(value) => typeof value === 'function',
					);
					if (funcMatch) {
						func = funcMatch as (params: {
							[key: string]: string;
						}) => Promise<unknown>;
					}

					if (typeof func === 'function') {
						logger.debug(req.url);

						const urlParams = req.url
							.split(/\?|&/)
							.filter((param) => param !== '')
							.map(decodeURIComponent);
						const paramsObj: {[key: string]: string} = {};

						urlParams.forEach((param) => {
							const [key, value] = param.split(/=/);
							paramsObj[key] = value;
						});

						try {
							const result = await func(paramsObj);

							if (!result || typeof result !== 'object') {
								throw new Error(
									`Plugin ${jsFilePath} did not return a valid object: ${JSON.stringify(result)}`,
								);
							}

							if (res.headersSent) {
								return;
							}
							const message: string =
								'message' in result && typeof result.message === 'string'
									? result.message
									: `Plugin ${jsFilePath} did not return a message`;
							const code: NagiosReturnValuesEnum =
								'code' in result &&
								typeof result.code === 'number' &&
								Object.values(NagiosReturnValuesEnum).includes(result.code)
									? result.code
									: NagiosReturnValuesEnum.UNKNOWN;
							let performanceData:
								| PerformanceData
								| PerformanceData[]
								| undefined = undefined;
							if ('performanceData' in (result as Record<string, unknown>)) {
								const unknownPerformanceData: unknown = (
									result as Record<string, unknown>
								).performanceData;
								if (
									isPerformanceData(unknownPerformanceData) ||
									isPerformanceDataArray(unknownPerformanceData)
								) {
									performanceData = unknownPerformanceData;
								} else {
									logger.warn(
										`Plugin ${jsFilePath} returned invalid performanceData: ${JSON.stringify(
											unknownPerformanceData,
										)}`,
									);
								}
							}
							const codeString = code?.toString() ?? '';
							const codeNumber = Number.parseInt(codeString, 10);
							const isValidCode = Object.values(NagiosReturnValuesEnum).some(
								(value) => value === codeNumber,
							);
							if (!isValidCode) {
								const errorMessage = `Invalid return code "${code}" for plugin ${jsFilePath}: http://${env.HOST}:${env.PORT}${kebabCasePath}`;
								logger.warn(errorMessage);
								const nagiosReturn = createNagiosReturnMessage(
									errorMessage,
									NagiosReturnValuesEnum.UNKNOWN,
								);
								return res.send(nagiosReturn);
							}
							const debugTemplate = `Debug: message=${message}, code=${code}, performanceData=${
								performanceData ? JSON.stringify(performanceData) : undefined
							}`;
							logger.debug(debugTemplate);

							if (isValidCode && typeof message === 'string') {
								const nagiosReturn = createNagiosReturnMessage(
									message,
									code,
									performanceData,
								);
								logger.debug(nagiosReturn);

								return res.send(nagiosReturn);
							} else {
								return res.send(
									createNagiosReturnMessage(
										message ?? `Unknown command ${req.url}`,
										3,
									),
								);
							}
						} catch (err) {
							logger.error(err);
							return res
								.status(500)
								.send(
									createNagiosReturnMessage(
										`Plugin ${jsFilePath} failed: ${err && typeof err === 'object' && 'message' in err && err?.message ? err.message : String(err)}`,
										3,
									),
								);
						}
					} else {
						logger.error('Plugin must export a function');
						res
							.status(500)
							.send(
								createNagiosReturnMessage(
									`Plugin ${jsFilePath} must export a function`,
									3,
								),
							);
					}
				} catch (err) {
					logger.error(err);
					res
						.status(500)
						.send(
							createNagiosReturnMessage(
								`Error loading plugin: ${jsFilePath}. Error: ${err}`,
								3,
							),
						);
				}
			})();
		});
	}
});

export default router;
