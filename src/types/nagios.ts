import {NagiosReturnCode} from './nagios.d';

export type {
	NagiosPerformanceData,
	NagiosReturnCode,
	PerformanceDataFormat,
} from './nagios.d';

export const NagiosReturnCodes = {
	OK: 0 as NagiosReturnCode,
	WARNING: 1 as NagiosReturnCode,
	CRITICAL: 2 as NagiosReturnCode,
	UNKNOWN: 3 as NagiosReturnCode,
} as const;
