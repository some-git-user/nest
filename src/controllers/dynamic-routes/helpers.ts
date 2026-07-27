import {getErrorMessage} from '../../lib/error-message';
import {
	createNagiosReturnMessage,
	isPerformanceData,
	isPerformanceDataArray,
} from '../../lib/nagios';
import type {NagiosPerformanceData} from '../../types/nagios';
import {NagiosReturnCode, NagiosReturnCodes} from '../../types/nagios';
import type {PluginReturn} from '../../types/plugin';

export type PluginFunction = (params: {
	[key: string]: string;
}) => Promise<unknown>;

export const parseUrlParams = (url: string): {[key: string]: string} => {
	// Extract query string from URL (handle both full URLs and paths)
	const queryString = url.includes('?') ? url.split('?')[1] : '';

	// Use URLSearchParams for proper URL decoding (handles +, %XX, etc.)
	const searchParams = new URLSearchParams(queryString);
	const paramsObj: {[key: string]: string} = {};

	for (const [key, value] of searchParams) {
		paramsObj[key] = value;
	}

	return paramsObj;
};

export const getPluginFunction = (
	moduleValue: unknown,
): PluginFunction | undefined => {
	if (!moduleValue || typeof moduleValue !== 'object') {
		return undefined;
	}

	const moduleRecord = moduleValue as Record<string, unknown>;
	const preferredCheckFunc = Object.entries(moduleRecord).find(
		([key, value]) => typeof value === 'function' && /^check/i.test(key),
	)?.[1];

	if (typeof preferredCheckFunc === 'function') {
		return preferredCheckFunc as PluginFunction;
	}

	const funcMatch = Object.values(moduleRecord).find(
		(value) => typeof value === 'function',
	);

	if (typeof funcMatch === 'function') {
		return funcMatch as PluginFunction;
	}

	return undefined;
};

export const clearPluginRequireCache = (
	requireFn: NodeJS.Require,
	jsFilePath: string,
	onWarn: (message: string) => void,
) => {
	try {
		const resolved = requireFn.resolve(jsFilePath);
		delete require.cache[resolved];
	} catch (e) {
		const errorMessage = getErrorMessage(e);
		onWarn(
			`Could not resolve plugin path for cache clearing: ${jsFilePath}. Error: ${errorMessage}`,
		);
	}
};

export const normalizePluginResult = (
	result: unknown,
	jsFilePath: string,
	onWarn: (message: string) => void,
): PluginReturn => {
	if (!result || typeof result !== 'object') {
		throw new Error(
			`Plugin ${jsFilePath} did not return a valid object: ${JSON.stringify(result)}`,
		);
	}

	const message: string =
		'message' in result && typeof result.message === 'string'
			? result.message
			: `Plugin ${jsFilePath} did not return a message`;

	const code: NagiosReturnCode =
		'code' in result
			? (() => {
					// Convert string codes to numbers (HTTP params are strings)
					const numericCode =
						typeof result.code === 'string'
							? parseInt(result.code, 10)
							: result.code;

					if (
						typeof numericCode === 'number' &&
						isKnownNagiosCode(numericCode)
					) {
						return numericCode as NagiosReturnCode;
					}
					return NagiosReturnCodes.UNKNOWN;
				})()
			: NagiosReturnCodes.UNKNOWN;

	let performanceData: NagiosPerformanceData[] | undefined = undefined;
	if ('performanceData' in (result as Record<string, unknown>)) {
		const unknownPerformanceData: unknown = (result as Record<string, unknown>)
			.performanceData;
		if (isPerformanceDataArray(unknownPerformanceData)) {
			performanceData = unknownPerformanceData;
		} else if (isPerformanceData(unknownPerformanceData)) {
			// Normalize single PerformanceData to array
			performanceData = [unknownPerformanceData];
		} else {
			onWarn(
				`Plugin ${jsFilePath} returned invalid performanceData: ${JSON.stringify(
					unknownPerformanceData,
				)}`,
			);
		}
	}

	return {message, code, performanceData};
};

export const isKnownNagiosCode = (code: unknown): boolean => {
	return (
		code === NagiosReturnCodes.OK ||
		code === NagiosReturnCodes.WARNING ||
		code === NagiosReturnCodes.CRITICAL ||
		code === NagiosReturnCodes.UNKNOWN
	);
};

export const buildInvalidCodeResponse = (
	code: unknown,
	jsFilePath: string,
	kebabCasePath: string,
	host: string,
	port: number,
) => {
	const isCodeString = typeof code === 'string';
	const isCodeNumber = typeof code === 'number';
	const errorMessage = `Invalid return code "${isCodeNumber || isCodeString ? code : `unkown code`}" for plugin ${jsFilePath}: https://${host}:${port}${kebabCasePath}`;
	return {
		errorMessage,
		nagiosReturn: createNagiosReturnMessage(
			errorMessage,
			NagiosReturnCodes.UNKNOWN,
		),
	};
};
