import {Request, Response} from 'express';
import {createRequire} from 'module';
import {env} from '../config/env';
import {logger} from '../lib/logger';
import {createNagiosReturnMessage} from '../lib/nagios';
import {
	buildInvalidCodeResponse,
	clearPluginRequireCache,
	getPluginFunction,
	isKnownNagiosCode,
	normalizePluginResult,
	parseUrlParams,
} from './dynamic-routes/helpers';

export const createPluginRouteHandler = (
	jsFilePath: string,
	kebabCasePath: string,
) => {
	return async (req: Request, res: Response) => {
		try {
			const requireFn = createRequire(__filename);
			clearPluginRequireCache(requireFn, jsFilePath, logger.warn);

			const pluginModule = requireFn(jsFilePath);
			const pluginFunc = getPluginFunction(pluginModule);

			if (!pluginFunc) {
				logger.error('Plugin must export a function');
				return res
					.status(500)
					.send(
						createNagiosReturnMessage(
							`Plugin ${jsFilePath} must export a function`,
							3,
						),
					);
			}

			logger.debug(req.url);
			const paramsObj = parseUrlParams(req.url);

			try {
				const result = await pluginFunc(paramsObj);
				const normalized = normalizePluginResult(
					result,
					jsFilePath,
					logger.warn,
				);

				if (res.headersSent) {
					return;
				}

				const isValidCode = isKnownNagiosCode(normalized.code);
				if (!isValidCode) {
					const invalidCodeResponse = buildInvalidCodeResponse(
						normalized.code,
						jsFilePath,
						kebabCasePath,
						env.HOST,
						env.PORT,
					);
					logger.warn(invalidCodeResponse.errorMessage);
					return res.send(invalidCodeResponse.nagiosReturn);
				}

				const debugTemplate = `Debug: message=${normalized.message}, code=${normalized.code}, performanceData=${
					normalized.performanceData
						? JSON.stringify(normalized.performanceData)
						: undefined
				}`;
				logger.debug(debugTemplate);

				if (isValidCode && typeof normalized.message === 'string') {
					const nagiosReturn = createNagiosReturnMessage(
						normalized.message,
						normalized.code,
						normalized.performanceData,
					);
					logger.debug(nagiosReturn);

					return res.send(nagiosReturn);
				}

				return res.send(
					createNagiosReturnMessage(
						normalized.message ?? `Unknown command ${req.url}`,
						3,
					),
				);
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
		} catch (err) {
			logger.error(err);
			return res
				.status(500)
				.send(
					createNagiosReturnMessage(
						`Error loading plugin: ${jsFilePath}. Error: ${err}`,
						3,
					),
				);
		}
	};
};
