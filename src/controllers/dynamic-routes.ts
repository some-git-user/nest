import {Request, Response} from 'express';
import {createRequire} from 'module';
import {env} from '../config/env';
import {getErrorMessage} from '../lib/error-message';
import {sendNagiosUnknownError} from '../lib/http-nagios';
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
			const warn = (message: string) => {
				logger.warn(message);
			};

			const requireFn = createRequire(__filename);
			clearPluginRequireCache(requireFn, jsFilePath, warn);

			const pluginModule: unknown = requireFn(jsFilePath);
			const pluginFunc = getPluginFunction(pluginModule);

			if (!pluginFunc) {
				logger.error('Plugin must export a function');
				return sendNagiosUnknownError(
					res,
					500,
					`Plugin ${jsFilePath} must export a function`,
				);
			}

			logger.debug(req.url);
			const paramsObj = parseUrlParams(req.url);

			try {
				const result = await pluginFunc(paramsObj);
				const normalized = normalizePluginResult(result, jsFilePath, warn);

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
				const errorMessage = getErrorMessage(err);
				return sendNagiosUnknownError(
					res,
					500,
					`Plugin ${jsFilePath} failed: ${errorMessage}`,
				);
			}
		} catch (err) {
			logger.error(err);
			const errorMessage = getErrorMessage(err);
			return sendNagiosUnknownError(
				res,
				500,
				`Error loading plugin: ${jsFilePath}. Error: ${errorMessage}`,
			);
		}
	};
};
