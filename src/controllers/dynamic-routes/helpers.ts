import {getErrorMessage} from '../../lib/error-message';
import {
	createNagiosReturnMessage,
	isPerformanceData,
	isPerformanceDataArray,
} from '../../lib/nagios';
import {NagiosReturnValuesEnum, PerformanceData} from '../../types/nagios';

export type PluginFunction = (params: {
	[key: string]: string;
}) => Promise<unknown>;

export const parseUrlParams = (url: string): {[key: string]: string} => {
	const paramsObj: {[key: string]: string} = {};
	const urlParams = url
		.split(/\?|&/)
		.filter((param) => param !== '')
		.map(decodeURIComponent);

	urlParams.forEach((param) => {
		const [key, value] = param.split(/=/);
		paramsObj[key] = value;
	});

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
): {
	message: string;
	code: NagiosReturnValuesEnum;
	performanceData: PerformanceData | PerformanceData[] | undefined;
} => {
	if (!result || typeof result !== 'object') {
		throw new Error(
			`Plugin ${jsFilePath} did not return a valid object: ${JSON.stringify(result)}`,
		);
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

	let performanceData: PerformanceData | PerformanceData[] | undefined =
		undefined;
	if ('performanceData' in (result as Record<string, unknown>)) {
		const unknownPerformanceData: unknown = (result as Record<string, unknown>)
			.performanceData;
		if (
			isPerformanceData(unknownPerformanceData) ||
			isPerformanceDataArray(unknownPerformanceData)
		) {
			performanceData = unknownPerformanceData;
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

export const isKnownNagiosCode = (code: NagiosReturnValuesEnum): boolean => {
	return (
		code === NagiosReturnValuesEnum.OK ||
		code === NagiosReturnValuesEnum.WARNING ||
		code === NagiosReturnValuesEnum.CRITICAL ||
		code === NagiosReturnValuesEnum.UNKNOWN
	);
};

export const buildInvalidCodeResponse = (
	code: NagiosReturnValuesEnum,
	jsFilePath: string,
	kebabCasePath: string,
	host: string,
	port: number,
) => {
	const errorMessage = `Invalid return code "${code}" for plugin ${jsFilePath}: https://${host}:${port}${kebabCasePath}`;
	return {
		errorMessage,
		nagiosReturn: createNagiosReturnMessage(
			errorMessage,
			NagiosReturnValuesEnum.UNKNOWN,
		),
	};
};
