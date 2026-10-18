import {Request, Response} from 'express';
import {env} from '../config/env';
import {
	PRESETS_UNAVAILABLE_MESSAGE,
	resolveDialBackAuth,
} from '../lib/dial-back-auth';
import {getErrorMessage} from '../lib/error-message';
import {
	appendExternalLinkGuard,
	applyHelpPageSecurityHeaders,
} from '../lib/help-page';
import {HttpStatusCodes} from '../lib/http-status-codes';
import {
	INTERNAL_REQUEST_TIMEOUT_MESSAGE,
	makeInternalRequest,
} from '../lib/internal-http-client';
import {isRecord} from '../lib/is-record';
import {hasRuntimeValidationFailed} from '../lib/local-config';
import {logger} from '../lib/logger';
import {renderHtmlDocument} from '../lib/ui-components';
import {
	NEST_UNIFIED_PARAM,
	type UnifiedCheck,
	type UnifiedPresetResult,
	aggregateUnifiedResults,
	getUnifiedChecks,
} from '../lib/unified-check';
import type {NagiosReturnCode} from '../types/nagios';
import {NagiosReturnCodes} from '../types/nagios';
import {isKnownNagiosCode} from './dynamic-routes/helpers';

const getUnifiedHelpHtml = (): string => {
	return appendExternalLinkGuard(
		renderHtmlDocument({
			title: 'Help: /unified',
			backHref: '/',
			hideHeader: true,
			contentHtml: `<h1>Built-in Help: /unified</h1>
<p>Runs the built-in monitoring routes plus every local-config preset opted into
the unified check, and returns the worst Nagios status, collapsing many services
into a single check.</p>
<h2>Endpoint</h2>
<ul>
<li><code>/unified</code></li>
<li><code>/unified?help</code></li>
</ul>
<h2>What runs</h2>
<p>
The built-in routes <code>/nagios</code> (process and host health) and
<code>/nagios/honey-pot</code> (intrusion signals) are <em>always</em> included;
they need no opt-in. Plugin presets join them only when opted in.
</p>
<h2>How a preset opts in</h2>
<p>
Add the reserved parameter <code>${NEST_UNIFIED_PARAM}=true</code> to a preset
line, or tick <em>Include in unified check</em> in the admin editor. The flag is
a directive for this aggregator, not a plugin input: it is stripped before the
preset is dialled back into its plugin route.
</p>
<h2>Behaviour</h2>
<ul>
<li>Checks run in parallel, each capped at <code>UNIFIED_TIMEOUT_MS</code>.</li>
<li>The overall status is the worst seen: CRITICAL &gt; UNKNOWN &gt; WARNING &gt; OK.</li>
<li>Every non-OK check is listed; OK checks are counted and still contribute performance data.</li>
<li>A check that errors or exceeds the timeout is reported as UNKNOWN, not allowed to stall the aggregate.</li>
</ul>
<h2>Example</h2>
<ul>
<li><code>/unified</code></li>
</ul>`,
		}),
	);
};

/**
 * Run one check and normalise its outcome.
 *
 * Any failure - a thrown dial-back, a timeout, a non-JSON body, or a body
 * without a usable Nagios code - becomes an UNKNOWN result carrying the reason,
 * so a single broken check degrades the aggregate instead of aborting it.
 */
const runCheck = async (
	check: UnifiedCheck,
	apiKey: string | undefined,
	requireApiKey: boolean,
): Promise<UnifiedPresetResult> => {
	try {
		const response = await makeInternalRequest({
			method: 'GET',
			path: check.path,
			params: check.params,
			apiKey,
			apiKeyHeader: env.API_KEY_HEADER,
			requireApiKey,
			// Pass our deadline down so a hung plugin's socket is destroyed rather
			// than left open after we have already reported the check as UNKNOWN.
			timeoutMs: env.UNIFIED_TIMEOUT_MS,
		});

		let parsed: unknown;
		try {
			parsed = JSON.parse(response.body);
		} catch {
			return {
				key: check.key,
				code: NagiosReturnCodes.UNKNOWN,
				message: 'Invalid response from plugin',
			};
		}

		if (!isRecord(parsed)) {
			return {
				key: check.key,
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

		return {key: check.key, code, message, performanceData};
	} catch (error) {
		// A socket timeout surfaces as a known sentinel; anything else (transport
		// error, missing key) reports its own message. Either way the check
		// degrades to UNKNOWN instead of aborting the aggregate.
		const errorMessage = getErrorMessage(error);
		const message =
			errorMessage === INTERNAL_REQUEST_TIMEOUT_MESSAGE
				? `Timed out after ${env.UNIFIED_TIMEOUT_MS} ms`
				: errorMessage;
		return {
			key: check.key,
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
		if ('help' in req.query) {
			applyHelpPageSecurityHeaders(res);
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.send(getUnifiedHelpHtml());
			return;
		}

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

		// Built-in routes are always included, so there is always at least one
		// check to run; opted-in plugin presets are appended after them.
		const checks = getUnifiedChecks();
		const results = await Promise.all(
			checks.map((check) => runCheck(check, apiKey, requireApiKey)),
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
