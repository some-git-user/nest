import {Request, Response} from 'express';
import {env} from '../config/env';
import {
	PRESETS_UNAVAILABLE_MESSAGE,
	resolveDialBackAuth,
} from '../lib/dial-back-auth';
import {getErrorMessage} from '../lib/error-message';
import {HttpStatusCodes} from '../lib/http-status-codes';
import {
	INTERNAL_REQUEST_TIMEOUT_MESSAGE,
	makeInternalRequest,
} from '../lib/internal-http-client';
import {isRecord} from '../lib/is-record';
import {hasRuntimeValidationFailed} from '../lib/local-config';
import {logger} from '../lib/logger';
import {commandToRoutePath} from '../lib/plugin-utils';
import {
	type UnifiedPreset,
	type UnifiedPresetResult,
	aggregateUnifiedResults,
	getUnifiedPresetEntries,
} from '../lib/unified-check';
import type {NagiosReturnCode} from '../types/nagios';
import {NagiosReturnCodes} from '../types/nagios';
import {isKnownNagiosCode} from './dynamic-routes/helpers';

/**
 * Run one preset and normalise its outcome.
 *
 * Any failure - a thrown dial-back, a timeout, a non-JSON body, or a body
 * without a usable Nagios code - becomes an UNKNOWN result carrying the reason,
 * so a single broken preset degrades the aggregate instead of aborting it.
 */
const runPreset = async (
	preset: UnifiedPreset,
	apiKey: string | undefined,
	requireApiKey: boolean,
): Promise<UnifiedPresetResult> => {
	try {
		const response = await makeInternalRequest({
			method: 'GET',
			path: commandToRoutePath(preset.command),
			params: preset.params,
			apiKey,
			apiKeyHeader: env.API_KEY_HEADER,
			requireApiKey,
			// Pass our deadline down so a hung plugin's socket is destroyed rather
			// than left open after we have already reported the preset as UNKNOWN.
			timeoutMs: env.UNIFIED_TIMEOUT_MS,
		});

		let parsed: unknown;
		try {
			parsed = JSON.parse(response.body);
		} catch {
			return {
				key: preset.key,
				code: NagiosReturnCodes.UNKNOWN,
				message: 'Invalid response from plugin',
			};
		}

		if (!isRecord(parsed)) {
			return {
				key: preset.key,
				code: NagiosReturnCodes.UNKNOWN,
				message: 'Invalid response from plugin',
			};
		}

		const code = isKnownNagiosCode(parsed.code)
			? (parsed.code as NagiosReturnCode)
			: NagiosReturnCodes.UNKNOWN;
		const message =
			typeof parsed.message === 'string' && parsed.message.length > 0
				? parsed.message
				: 'No message from plugin';
		const performanceData =
			typeof parsed.performanceData === 'string'
				? parsed.performanceData
				: undefined;

		return {key: preset.key, code, message, performanceData};
	} catch (error) {
		// A socket timeout surfaces as a known sentinel; anything else (transport
		// error, missing key) reports its own message. Either way the preset
		// degrades to UNKNOWN instead of aborting the aggregate.
		const errorMessage = getErrorMessage(error);
		const message =
			errorMessage === INTERNAL_REQUEST_TIMEOUT_MESSAGE
				? `Timed out after ${env.UNIFIED_TIMEOUT_MS} ms`
				: errorMessage;
		return {
			key: preset.key,
			code: NagiosReturnCodes.UNKNOWN,
			message,
		};
	}
};

/**
 * GET/POST /unified
 *
 * Runs every preset opted into the unified check and returns the worst status.
 * This collapses many Nagios services into one: a single check reports whether
 * any enabled preset is WARNING/CRITICAL and lists the offenders.
 *
 * The presets run in parallel, each dialled back into its own plugin route with
 * the server's own key (the operator is already authenticated here), so no new
 * authority is granted. A preset that errors or exceeds UNIFIED_TIMEOUT_MS is
 * reported as UNKNOWN rather than allowed to stall the aggregate.
 */
export const unifiedCheck = async (
	req: Request,
	res: Response,
): Promise<void> => {
	// Express 5 forwards a rejected async handler to its default error handler,
	// which replies with an HTML 500 — useless to a Nagios consumer. Catch here so
	// every path, including an unexpected throw, returns a Nagios-shaped JSON body.
	try {
		if (hasRuntimeValidationFailed()) {
			res.status(HttpStatusCodes.FORBIDDEN).json({
				code: NagiosReturnCodes.UNKNOWN,
				message: PRESETS_UNAVAILABLE_MESSAGE,
			});
			return;
		}

		const httpMethod: 'GET' | 'POST' = req.method === 'POST' ? 'POST' : 'GET';
		const {apiKey, requireApiKey, missingKey} = resolveDialBackAuth(
			req,
			httpMethod,
		);
		if (missingKey) {
			logger.warn('Rejected unified POST: missing API key header');
			res.status(HttpStatusCodes.UNAUTHORIZED).json({
				code: NagiosReturnCodes.UNKNOWN,
				message: `Missing API key. Provide it in the '${env.API_KEY_HEADER}' header.`,
			});
			return;
		}

		const presets = getUnifiedPresetEntries();
		if (presets.length === 0) {
			res.status(HttpStatusCodes.OK).json({
				code: NagiosReturnCodes.UNKNOWN,
				message: 'NEST UNIFIED: no presets are enabled for the unified check',
			});
			return;
		}

		const results = await Promise.all(
			presets.map((preset) => runPreset(preset, apiKey, requireApiKey)),
		);
		const aggregate = aggregateUnifiedResults(results);

		res.status(HttpStatusCodes.OK).json({
			code: aggregate.code,
			message: aggregate.message,
			...(aggregate.performanceData
				? {performanceData: aggregate.performanceData}
				: {}),
		});
	} catch (error) {
		logger.error(`Unified check failed: ${getErrorMessage(error)}`);
		res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({
			code: NagiosReturnCodes.UNKNOWN,
			message: 'Internal server error',
		});
	}
};
