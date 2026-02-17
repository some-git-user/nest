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

export const isPerformanceData = (value: unknown): value is PerformanceData =>
	typeof value === 'object' &&
	value !== null &&
	'value' in (value as Record<string, unknown>) &&
	(typeof (value as Record<string, unknown>).value === 'number' ||
		typeof (value as Record<string, unknown>).value === 'string') &&
	'uom' in (value as Record<string, unknown>) &&
	typeof (value as Record<string, unknown>).uom === 'string';

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
