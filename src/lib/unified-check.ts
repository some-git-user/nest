import type {NagiosReturnCode} from '../types/nagios';
import {NagiosReturnCodes} from '../types/nagios';
import {getConfigKeys, safeLookupConfig} from './local-config';
import {getNagiosStatusText} from './nagios';

/**
 * Reserved parameter name that opts a preset into the unified check.
 *
 * It is stored in the preset line like any other parameter, so the selection
 * survives the approved-hash gate exactly like a normal edit. The unified
 * executor strips it before dialling back into the plugin route, so a plugin
 * never receives a parameter it did not declare.
 */
export const NEST_UNIFIED_PARAM = 'nestUnified';

/**
 * Whether a preset is opted into the unified check.
 *
 * Only the literal `true` opts in; anything else (absent, empty, `false`, a
 * typo) leaves it out, so a stray value can never silently pull a preset into
 * the aggregate.
 */
export const isUnifiedEnabled = (params: Record<string, string>): boolean =>
	params[NEST_UNIFIED_PARAM] === 'true';

/**
 * A preset's parameters with the reserved unified flag removed.
 *
 * The flag is a directive for the aggregator, not a plugin input, so it must
 * not reach the plugin — a plugin validates its parameters against
 * `meta.params` and would reject an undeclared key.
 */
export const stripUnifiedParam = (
	params: Record<string, string>,
): Record<string, string> => {
	const rest: Record<string, string> = {};
	for (const [name, value] of Object.entries(params)) {
		if (name !== NEST_UNIFIED_PARAM) {
			rest[name] = value;
		}
	}
	return rest;
};

/** A preset selected for the unified check, ready to dial back. */
export type UnifiedPreset = {
	key: string;
	command: string;
	/** Parameters with the reserved unified flag stripped. */
	params: Record<string, string>;
};

/**
 * The presets opted into the unified check, from the startup-approved cache.
 *
 * Reads the same in-memory cache the single-key `/local-config` route uses, so
 * the aggregate honours the approved-hash gate: a drifted or unapproved file yields
 * no keys here, exactly as it does there. Keys are returned in the cache's
 * insertion order (file order), so the aggregate output is stable.
 */
export const getUnifiedPresetEntries = (): UnifiedPreset[] => {
	const presets: UnifiedPreset[] = [];
	for (const key of getConfigKeys()) {
		const entry = safeLookupConfig(key);
		if (!entry || !isUnifiedEnabled(entry.params)) {
			continue;
		}
		presets.push({
			key,
			command: entry.command,
			params: stripUnifiedParam(entry.params),
		});
	}
	return presets;
};

/** The outcome of running one preset inside the aggregate. */
export type UnifiedPresetResult = {
	key: string;
	code: NagiosReturnCode;
	message: string;
	performanceData?: string;
};

/**
 * Severity order for the aggregate: CRITICAL > UNKNOWN > WARNING > OK.
 *
 * A definite failure outranks an indeterminate one, matching the common
 * meta-check convention: a plugin that reports CRITICAL is a known problem,
 * while UNKNOWN (a plugin that errored or timed out) is worse than a plain
 * threshold warning but does not mask a real CRITICAL.
 */
const SEVERITY_RANK: Record<NagiosReturnCode, number> = {
	2: 3,
	3: 2,
	1: 1,
	0: 0,
};

/** Nagios truncates plugin output at 4 KB; keep the message under it. */
const MAX_MESSAGE_BYTES = 4096;

const truncateMessage = (message: string): string => {
	if (Buffer.byteLength(message, 'utf8') <= MAX_MESSAGE_BYTES) {
		return message;
	}
	// Reserve room for the ellipsis, then cut at a UTF-8 boundary: back off while
	// the byte at the cut is a continuation byte (10xxxxxx), so a multi-byte
	// character is never split (which would render as U+FFFD).
	const budget = MAX_MESSAGE_BYTES - 3;
	const buffer = Buffer.from(message, 'utf8');
	let end = budget;
	while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
		end -= 1;
	}
	return `${buffer.subarray(0, end).toString('utf8')}...`;
};

/** The aggregate's single Nagios result: worst code, listed problems, perfdata. */
export type UnifiedAggregate = {
	code: NagiosReturnCode;
	message: string;
	performanceData?: string;
};

/**
 * Split a Nagios performance-data string into its `label=value...` tokens.
 *
 * Tokens are space-separated, but a label may itself contain spaces when quoted
 * (`'cpu load'=5%`), so splitting on a bare space would corrupt valid data. This
 * walks the string and only breaks on a space outside single quotes.
 */
const splitPerformanceData = (data: string): string[] => {
	const tokens: string[] = [];
	let current = '';
	let inQuote = false;
	for (const char of data) {
		if (char === `'`) {
			inQuote = !inQuote;
			current += char;
		} else if (char === ' ' && !inQuote) {
			if (current.length > 0) {
				tokens.push(current);
			}
			current = '';
		} else {
			current += char;
		}
	}
	if (current.length > 0) {
		tokens.push(current);
	}
	return tokens;
};

/**
 * Separate a token's label from the rest (`=value;warn;...`). Returns `undefined`
 * when the token carries no label, so it can be passed through untouched.
 */
const splitLabel = (
	token: string,
): {label: string; rest: string; quoted: boolean} | undefined => {
	const eq = token.indexOf('=');
	if (eq <= 0) {
		return undefined;
	}
	const head = token.slice(0, eq);
	const rest = token.slice(eq);
	const quoted = head.length >= 2 && head.startsWith(`'`) && head.endsWith(`'`);
	return quoted
		? {label: head.slice(1, -1), rest, quoted}
		: {label: head, rest, quoted: false};
};

/**
 * Make a preset key safe to embed in a performance-data label.
 *
 * A duplicate label is namespaced with the preset key, but a key is operator
 * text and could contain a space or `=`, which would corrupt the `label=value`
 * token once written unquoted. Collapsing any such character to `_` keeps the
 * token well-formed while staying recognisable.
 */
const keyForLabel = (key: string): string => key.replace(/[\s=]/g, '_');

/**
 * Concatenate every preset's performance data, namespacing duplicate labels.
 *
 * Nagios requires perfdata labels to be unique within one check; concatenating
 * presets verbatim would emit duplicates (e.g. every preset reporting `time`).
 * The first occurrence of a label is left untouched — so the common single-preset
 * case is byte-for-byte unchanged — and only a repeat is rewritten to
 * `<key>_<label>` (with a numeric suffix on a further clash). The result is
 * capped to the Nagios output limit by dropping whole trailing tokens, so a very
 * large preset set cannot overflow the check output.
 */
const dedupePerformanceData = (
	results: UnifiedPresetResult[],
): string | undefined => {
	const seen = new Set<string>();
	const chunks: string[] = [];

	for (const result of results) {
		if (!result.performanceData) {
			continue;
		}
		const prefix = keyForLabel(result.key);
		for (const token of splitPerformanceData(result.performanceData)) {
			const parts = splitLabel(token);
			if (!parts) {
				chunks.push(token);
				continue;
			}
			let uniqueLabel = parts.label;
			if (seen.has(uniqueLabel)) {
				uniqueLabel = `${prefix}_${parts.label}`;
				let suffix = 1;
				while (seen.has(uniqueLabel)) {
					uniqueLabel = `${prefix}_${parts.label}_${suffix}`;
					suffix += 1;
				}
			}
			seen.add(uniqueLabel);
			const head = parts.quoted ? `'${uniqueLabel}'` : uniqueLabel;
			chunks.push(`${head}${parts.rest}`);
		}
	}

	return capPerformanceData(chunks);
};

/**
 * Join perfdata tokens, dropping whole trailing tokens so the result stays
 * within the Nagios output limit. Tokens are dropped whole (never sliced) so a
 * truncated string is still a sequence of valid `label=value` entries.
 */
const capPerformanceData = (chunks: string[]): string | undefined => {
	if (chunks.length === 0) {
		return undefined;
	}
	const kept: string[] = [];
	let bytes = 0;
	for (const chunk of chunks) {
		// Budget in UTF-8 bytes (matching truncateMessage), not code units: a
		// quoted label may hold multibyte characters. Each kept chunk costs its own
		// bytes plus a separating space (except the first), matching the joined
		// output exactly.
		const cost = (kept.length === 0 ? 0 : 1) + Buffer.byteLength(chunk, 'utf8');
		if (bytes + cost > MAX_MESSAGE_BYTES) {
			break;
		}
		kept.push(chunk);
		bytes += cost;
	}
	return kept.length > 0 ? kept.join(' ') : undefined;
};

/**
 * Fold per-preset results into one Nagios result.
 *
 * The overall code is the worst seen. The message names the worst status and
 * the problem count, then lists every non-OK preset as `key: STATUS - message`.
 * OK presets are counted in the total but not listed; their performance data is
 * still concatenated so graphs keep working, with duplicate labels namespaced by
 * preset key (see {@link dedupePerformanceData}). The message is truncated to the
 * Nagios output limit.
 */
export const aggregateUnifiedResults = (
	results: UnifiedPresetResult[],
): UnifiedAggregate => {
	if (results.length === 0) {
		return {
			code: NagiosReturnCodes.UNKNOWN,
			message: 'NEST UNIFIED: UNKNOWN - no presets were run',
		};
	}

	let worstCode: NagiosReturnCode = NagiosReturnCodes.OK;
	for (const result of results) {
		if (SEVERITY_RANK[result.code] > SEVERITY_RANK[worstCode]) {
			worstCode = result.code;
		}
	}

	const problems = results.filter(
		(result) => result.code !== NagiosReturnCodes.OK,
	);
	const problemCount = problems.length;
	const total = results.length;

	const header = `NEST UNIFIED: ${getNagiosStatusText(worstCode)} - ${problemCount} problem(s) of ${total}`;
	const problemLines = problems.map(
		(result) =>
			`${result.key}: ${getNagiosStatusText(result.code)} - ${result.message}`,
	);
	const message = truncateMessage(
		problemLines.length > 0 ? `${header}; ${problemLines.join('; ')}` : header,
	);

	const performanceData = dedupePerformanceData(results);

	return {
		code: worstCode,
		message,
		...(performanceData ? {performanceData} : {}),
	};
};
