import {
	NagiosReturnMessage,
	NagiosReturnValuesEnum,
	PerformanceData,
} from '../types/nagios';
import {logger} from './logger';

/**
 * Creates a Nagios return message with status code and optional performance data.
 *
 * @param message - The status message to include in the Nagios response
 * @param code - The Nagios return status code (OK, WARNING, CRITICAL, UNKNOWN)
 * @param performanceData - Optional performance data object or array of performance data to include in the response
 * @returns A NagiosReturnMessage object containing the message, code, and formatted performance data
 *
 * @example
 * const result = createNagiosReturnMessage('CPU Load OK', NagiosReturnValuesEnum.OK, {
 *   label: 'cpu',
 *   value: 45,
 *   uom: '%',
 *   warn: 80,
 *   crit: 90
 * });
 */
export const createNagiosReturnMessage = (
	message: string,
	code: NagiosReturnValuesEnum,
	performanceData?: PerformanceData | PerformanceData[],
): NagiosReturnMessage => {
	const nagiosReturnMessage: NagiosReturnMessage = {
		message,
		code,
	};

	if (performanceData) {
		logger.debug(performanceData);
		if (!Array.isArray(performanceData)) {
			performanceData = [performanceData];
		}

		if (performanceData.every((perfData) => perfData)) {
			nagiosReturnMessage.performanceData = performanceData
				.flatMap(
					(perfData) =>
						`${perfData.label ? `'${perfData.label}':` : ''}${
							perfData.value
								? `${perfData.value}${perfData.uom ? `${perfData.uom}` : ''}`
								: ''
						}${perfData.warn ? `;WARN=${perfData.warn}` : ''}${
							perfData.crit ? `;CRIT=${perfData.crit}` : ''
						}${perfData.min ? `;MIN=${perfData.min}` : ''}${
							perfData.max ? `;MAX=${perfData.max}` : ''
						}`,
				)
				.join(' ')
				.trimStart();
		} else {
			logger.error(`Error parsing performance data: ${performanceData}`);
		}
	}

	return nagiosReturnMessage;
};

/**
 * Type guard to check if a value is a valid PerformanceData object.
 *
 * @param value - The value to check
 * @returns True if v is a PerformanceData object with required properties (value and uom), false otherwise
 */

export const isPerformanceData = (value: unknown): value is PerformanceData => {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const v = value as Record<string, unknown>;

	// label: required string, must not contain '=' or single-quote
	if (!('label' in v) || typeof v.label !== 'string') {
		return false;
	}
	if (/[=']/.test(v.label)) {
		return false;
	}

	// value: number or string. If string, allow numeric strings or the literal 'U'
	if (!('value' in v)) {
		return false;
	}
	const val = v.value;
	const isNumber = typeof val === 'number';
	const isNumericString =
		typeof val === 'string' && (val === 'U' || /^-?\d+(?:\.\d+)?$/.test(val));
	if (!isNumber && !isNumericString) {
		return false;
	}

	// uom: required string, must not include digits, semicolons or quotes
	if (!('uom' in v) || typeof v.uom !== 'string') {
		return false;
	}
	if (/[0-9;']/.test(String(v.uom))) {
		return false;
	}

	// warn/crit: optional string or null
	if ('warn' in v && v.warn !== null && typeof v.warn !== 'string') {
		return false;
	}
	if ('crit' in v && v.crit !== null && typeof v.crit !== 'string') {
		return false;
	}

	// min/max: optional number|string|null
	if ('min' in v) {
		const minVal = v.min;
		if (
			minVal !== null &&
			typeof minVal !== 'number' &&
			typeof minVal !== 'string'
		) {
			return false;
		}
		if (
			minVal !== null &&
			typeof minVal === 'string' &&
			!/^(-?\d+(\.\d+)?|U)$/.test(minVal)
		) {
			return false;
		}
	}
	if ('max' in v) {
		const maxVal = v.max;
		if (
			maxVal !== null &&
			typeof maxVal !== 'number' &&
			typeof maxVal !== 'string'
		) {
			return false;
		}
		if (
			maxVal !== null &&
			typeof maxVal === 'string' &&
			!/^(-?\d+(\.\d+)?|U)$/.test(maxVal)
		) {
			return false;
		}
	}

	return true;
};

/**
 * Type guard to check if a value is a valid array of PerformanceData objects.
 *
 * @param value - The value to check
 * @returns True if v is an array where every item is a valid PerformanceData object, false otherwise
 */
export const isPerformanceDataArray = (
	value: unknown,
): value is PerformanceData[] =>
	Array.isArray(value) && value.every((item) => isPerformanceData(item));
