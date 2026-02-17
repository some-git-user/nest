export enum NagiosReturnValuesEnum {
	OK = 0,
	WARNING = 1,
	CRITICAL = 2,
	UNKNOWN = 3,
}

export type PerformanceDataFormat = string;

/**
 * 
 * https://nagios-plugins.org/doc/guidelines.html#AEN200
  Notes:
    - space separated list of label/value pairs
    - label can contain any characters except the equals sign or single quote (')
    - the single quotes for the label are optional. Required if spaces are in the label
    - label length is arbitrary, but ideally the first 19 characters are unique (due to a limitation in RRD). Be aware of a limitation in the amount of data that NRPE returns to Nagios
    - to specify a quote character, use two single quotes
    - warn, crit, min or max may be null (for example, if the threshold is not defined or min and max do not apply). Trailing unfilled semicolons can be dropped
    - min and max are not required if UOM=%
    - value, min and max in class [-0-9.]. Must all be the same UOM. value may be a literal "U" instead, this would indicate that the actual value couldn't be determined
    - warn and crit are in the range format (see the Section called Threshold and Ranges). Must be the same UOM
    - UOM (unit of measurement) is a string of zero or more characters, NOT including numbers, semicolons, or quotes. Some examples:

        no unit specified - assume a number (int or float) of things (eg, users, processes, load averages)
        s - seconds (also us, ms)
        % - percentage
        B - bytes (also KB, MB, TB)
        c - a continous counter (such as bytes transmitted on an interface)
*/
export interface PerformanceData {
	label: string;
	value: number | string;
	uom: string;
	warn?: string | null;
	crit?: string | null;
	min?: number | string | null;
	max?: number | string | null;
}

export interface NagiosReturnMessage {
	message: string;
	code: NagiosReturnValuesEnum;
	performanceData?: PerformanceDataFormat;
}
