import {Request} from 'express';
import {env} from '../config/env';
import {extractApiKey} from './browser-auth';

/**
 * Message returned when the startup approved-hash check failed, so no preset
 * can be executed. Shared by every route that runs presets (single-key and
 * unified) so the operator sees one consistent reason.
 */
export const PRESETS_UNAVAILABLE_MESSAGE =
	'Local config presets are currently unavailable due to hash validation failure. Please update LOCAL_CONFIG_HASH and restart the service.';

/** The outcome of resolving the API key for an internal dial-back. */
export type DialBackAuth = {
	/** The key to send on the dial-back, or undefined when none applies. */
	apiKey?: string;
	/** Whether the dial-back must carry a key (POST with a key configured). */
	requireApiKey: boolean;
	/** True when a key was required but the caller presented none. */
	missingKey: boolean;
};

/**
 * Resolve the API key for a dial-back into this same server.
 *
 * A browser delivers the key through Basic Auth, a script through the header,
 * so both sources are accepted. With a key configured, the internal request
 * could never pass the access control middleware without one, so a missing key
 * is flagged for the caller to reject with 401 rather than surfacing as a
 * generic failure. The configured key is a fallback only to repair a keyless
 * GET from an already-authenticated browser - it never weakens authentication.
 */
export const resolveDialBackAuth = (
	req: Request,
	httpMethod: 'GET' | 'POST',
): DialBackAuth => {
	const incomingApiKey = extractApiKey(req, env.API_KEY_HEADER);
	const requireApiKey = httpMethod === 'POST' && env.API_KEY.length > 0;
	if (requireApiKey && !incomingApiKey) {
		return {requireApiKey, missingKey: true};
	}
	const apiKey =
		incomingApiKey || (env.API_KEY.length > 0 ? env.API_KEY : undefined);
	return {apiKey, requireApiKey, missingKey: false};
};
