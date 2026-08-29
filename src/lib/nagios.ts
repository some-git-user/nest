import type {NagiosPerformanceData, NagiosReturnCode} from '../types/nagios';
import {NagiosReturnCodes} from '../types/nagios';
import {logger} from './logger';

export type NagiosReturnMessage = {
	message: string;
	code: NagiosReturnCode;
	performanceData?: string;
};

/**
 * True for the two values that mean "this field carries no data".
 *
 * A plugin may leave an optional field out entirely, set it to `null`, or set it
 * to `undefined` by assigning the result of a lookup that came back empty, e.g.
 * `warn: thresholds.warningTempC !== undefined ? String(...) : undefined`. All
 * three have to behave the same way, otherwise a perfectly valid plugin result
 * loses its data over a key that merely exists.
 */
const isNullish = (value: unknown): boolean =>
	value === undefined || value === null;

/** A plain number, or a string holding one. Matches the `[-0-9.]` value class. */
const NUMERIC_STRING = /^-?\d+(?:\.\d+)?$/;

/**
 * Renders a value for a log line without losing information.
 *
 * `JSON.stringify` silently omits `undefined` object values, which makes a
 * payload like `{label: 'gpu', value: '1', warn: undefined}` look perfectly
 * valid in the log while it is exactly what was rejected. That cost hours of
 * diagnosis, so undefined/null values are written out explicitly here.
 *
 * Depth is bounded because the input comes from a plugin and may be cyclic.
 */
export const describeForLog = (value: unknown, depth = 0): string => {
	if (isNullish(value)) {
		return String(value);
	}
	if (typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value);
	}
	if (typeof value !== 'object') {
		return typeof value;
	}
	if (depth >= 3) {
		return Array.isArray(value) ? '[...]' : '{...}';
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => describeForLog(item, depth + 1)).join(', ')}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>).map(
		([key, item]) => `${key}: ${describeForLog(item, depth + 1)}`,
	);
	return `{${entries.join(', ')}}`;
};

/**
 * Coerces a label, or `''` when there is nothing usable to render.
 *
 * The spec forbids `=` and a single quote inside a label, and the label is
 * always emitted quoted, so those characters are stripped rather than treated
 * as an error: `"gpu=0 'die'"` becomes a still-identifiable `gpu0 die`.
 */
const toLabel = (value: unknown): string => {
	if (typeof value !== 'string' && typeof value !== 'number') {
		return '';
	}
	return String(value).replace(/[=']/g, '');
};

/**
 * Coerces a unit of measurement, or `''` when there is none.
 *
 * The spec excludes digits, semicolons and quotes from a UOM. Stripping them
 * keeps the measurement (`ms1` -> `ms`) instead of discarding the whole metric.
 */
const toUom = (value: unknown): string => {
	if (typeof value !== 'string' && typeof value !== 'number') {
		return '';
	}
	return String(value).replace(/[0-9;']/g, '');
};

/**
 * Picks the value and the min/max bounds, which the spec restricts to the
 * `[-0-9.]` class or the literal `U`.
 *
 * A number is kept as a number and a numeric string as a string, so the
 * normalized entry still reflects what the producer reported. Returns
 * `undefined` when the field holds no number at all; `null`/`undefined`/`NaN`/
 * `Infinity`/`'abc'`/objects all mean "this field carries nothing usable".
 */
const pickNumericField = (value: unknown): number | string | undefined => {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === 'U' || NUMERIC_STRING.test(trimmed) ? trimmed : undefined;
};

/**
 * Coerces a warn/crit threshold. These are range expressions rather than plain
 * numbers (`10:`, `~25`, `@1:5`), so anything textual is kept as written; only
 * the field separator and line breaks are removed because they would shift the
 * positional fields, and non-scalars are dropped.
 */
const toThresholdField = (value: unknown): string | undefined => {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : undefined;
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	const cleaned = value.trim().replace(/[;\r\n]/g, '');
	return cleaned.length > 0 ? cleaned : undefined;
};

/**
 * Turns one unknown value into a performance data entry, or `undefined` when it
 * carries no usable value.
 *
 * Every field is accepted in whatever shape a plugin may hand it over: absent,
 * `null`, `undefined`, a number where a string is declared, or a numeric string.
 * Only a missing or non-numeric `value` makes an entry unusable, because without
 * it there is nothing to report.
 */
const sanitizePerformanceDataEntry = (
	value: unknown,
): NagiosPerformanceData | undefined => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;

	const entryValue = pickNumericField(candidate.value);
	if (entryValue === undefined) {
		return undefined;
	}

	const entry: NagiosPerformanceData = {
		label: toLabel(candidate.label),
		value: entryValue,
		uom: toUom(candidate.uom),
	};

	const warn = toThresholdField(candidate.warn);
	if (warn !== undefined) {
		entry.warn = warn;
	}
	const crit = toThresholdField(candidate.crit);
	if (crit !== undefined) {
		entry.crit = crit;
	}
	const min = pickNumericField(candidate.min);
	if (min !== undefined) {
		entry.min = min;
	}
	const max = pickNumericField(candidate.max);
	if (max !== undefined) {
		entry.max = max;
	}

	return entry;
};

export type SanitizedPerformanceData = {
	/** Entries that could be rendered, in the order they arrived. */
	entries: NagiosPerformanceData[];
	/** The original values that carried no usable value, for logging. */
	dropped: unknown[];
};

/**
 * Normalizes whatever a producer reports as performance data into entries that
 * can be formatted, without rejecting the set as a whole.
 *
 * A single entry, an array of entries, or an array with a few broken items all
 * work: only the individual broken items are reported back in `dropped`. This is
 * deliberately tolerant about types — a plugin that reports a threshold as a
 * number, or leaves a key present but `undefined`, is still reporting real data.
 */
export const sanitizePerformanceData = (
	value: unknown,
): SanitizedPerformanceData => {
	const candidates = Array.isArray(value) ? value : [value];
	const entries: NagiosPerformanceData[] = [];
	const dropped: unknown[] = [];

	for (const candidate of candidates) {
		const entry = sanitizePerformanceDataEntry(candidate);
		if (entry) {
			entries.push(entry);
		} else {
			dropped.push(candidate);
		}
	}

	return {entries, dropped};
};

/**
 * Formats one performance data entry in the layout defined by the Nagios plugin
 * guidelines (see https://nagios-plugins.org/doc/guidelines.html#performance):
 *
 *   `'label'=value[UOM];[warn];[crit];[min];[max]`
 *
 * Two details of that layout are easy to get wrong and are the reason this is
 * spelled out here:
 *
 *  - The fields after the value are POSITIONAL. They are separated by semicolons
 *    and carry no name, so an omitted `warn` still occupies an empty field when a
 *    later `min` is present: `'x'=1;;5` means "no warning, critical at 5".
 *  - Trailing unfilled fields are dropped rather than written as empty ones.
 *
 * A value of `0` is data and must be emitted; only `null`/`undefined` mean absent.
 */
const formatPerformanceDataEntry = (
	perfData: NagiosPerformanceData,
): string => {
	const label = perfData.label ? `'${perfData.label}'=` : '';
	const uom = perfData.uom ? perfData.uom : '';

	const fields = [perfData.warn, perfData.crit, perfData.min, perfData.max];
	while (fields.length > 0 && isNullish(fields[fields.length - 1])) {
		fields.pop();
	}
	const fieldPart = fields
		.map((field) => (isNullish(field) ? '' : `${field}`))
		.join(';');

	return `${label}${perfData.value}${uom}${fieldPart ? `;${fieldPart}` : ''}`;
};

/**
 * Creates a Nagios return message with status code and optional performance data.
 *
 * @param message - The status message to include in the Nagios response
 * @param code - The Nagios return status code (OK, WARNING, CRITICAL, UNKNOWN)
 * @param performanceData - Optional performance data, either one entry or an array of entries. Taken as `unknown` on purpose: producers are plugins and their output is normalized rather than trusted.
 * @returns A NagiosReturnMessage object containing the message, code, and formatted performance data
 *
 * @example
 * const result = createNagiosReturnMessage('CPU Load OK', NagiosReturnCodes.OK, {
 *   label: 'cpu',
 *   value: 45,
 *   uom: '%',
 *   warn: '80',
 *   crit: '90'
 * });
 * // performanceData === "'cpu'=45%;80;90"
 */
export const createNagiosReturnMessage = (
	message: string,
	code: NagiosReturnCode,
	performanceData?: unknown,
): NagiosReturnMessage => {
	const nagiosReturnMessage: NagiosReturnMessage = {
		message,
		code,
	};

	if (performanceData) {
		logger.debug(performanceData);
		const {entries, dropped} = sanitizePerformanceData(performanceData);

		if (dropped.length > 0) {
			logger.error(
				`Error parsing performance data, ${dropped.length} of ${dropped.length + entries.length} entries dropped: ${describeForLog(dropped)}`,
			);
		}

		const formattedData = entries
			.map((perfData) => formatPerformanceDataEntry(perfData))
			.join(' ');

		if (formattedData) {
			nagiosReturnMessage.performanceData = formattedData;
		}
	}

	return nagiosReturnMessage;
};

export const getNagiosStatusText = (code: NagiosReturnCode): string => {
	if (code === NagiosReturnCodes.OK) {
		return 'OK';
	}

	if (code === NagiosReturnCodes.WARNING) {
		return 'WARNING';
	}

	if (code === NagiosReturnCodes.CRITICAL) {
		return 'CRITICAL';
	}

	return 'UNKNOWN';
};
