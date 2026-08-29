import {getErrorMessage} from '../../lib/error-message';
import {
	type NagiosReturnMessage,
	createNagiosReturnMessage,
	describeForLog,
	sanitizePerformanceData,
} from '../../lib/nagios';
import type {NagiosPerformanceData} from '../../types/nagios';
import {NagiosReturnCode, NagiosReturnCodes} from '../../types/nagios';
import type {PluginReturn} from '../../types/plugin';

export type PluginFunction = (params: {
	[key: string]: string | number | boolean;
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

export const coerceParams = (params: {
	[key: string]: string;
}): {[key: string]: string | number | boolean} => {
	const coerced: {[key: string]: string | number | boolean} = {};

	for (const [key, value] of Object.entries(params)) {
		// Boolean coercion (case-sensitive, exact match)
		if (value === 'true') {
			coerced[key] = true;
		} else if (value === 'false') {
			coerced[key] = false;
		} else if (/^-?\d+\.?\d*$/.test(value) && value.trim() !== '') {
			coerced[key] = Number(value);
		} else {
			coerced[key] = value;
		}
	}

	return coerced;
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
): void => {
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
		// Normalize instead of validating: a plugin reporting a threshold as a
		// number, or leaving a key present but undefined, still reports real
		// metrics, and one unusable entry must not discard the others.
		const {entries, dropped} = sanitizePerformanceData(unknownPerformanceData);
		performanceData = entries;
		if (dropped.length > 0) {
			onWarn(
				`Plugin ${jsFilePath} returned invalid performanceData: ${describeForLog(dropped)}`,
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
): {errorMessage: string; nagiosReturn: NagiosReturnMessage} => {
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
