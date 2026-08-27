import {Request, Response} from 'express';
import {env} from '../config/env';
import {getErrorMessage} from '../lib/error-message';
import {HttpStatusCodes} from '../lib/http-status-codes';
import {makeInternalRequest} from '../lib/internal-http-client';
import {
	hasRuntimeValidationFailed,
	safeLookupConfig,
} from '../lib/local-config';
import {logger} from '../lib/logger';
import {commandToRoutePath} from '../lib/plugin-utils';

interface LocalConfigRequest {
	localConfig: string;
	[key: string]: unknown;
}

interface LocalConfigQuery {
	config?: string;
	[key: string]: unknown;
}

// Allowed characters for config key: alphanumeric, underscore, hyphen
const CONFIG_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_CONFIG_KEY_LENGTH = 128;

/**
 * Execute a local config key with the specified HTTP method
 * Extracted to avoid duplication between GET and POST handlers
 *
 * @param req Express request
 * @param res Express response
 * @param configKey The config key to execute
 * @param httpMethod HTTP method for internal request (GET or POST)
 */
const executeLocalConfig = async (
	req: Request,
	res: Response,
	configKey: string,
	httpMethod: 'GET' | 'POST',
): Promise<void> => {
	// Reject if runtime validation has failed (checked at startup)
	if (hasRuntimeValidationFailed()) {
		res.status(HttpStatusCodes.FORBIDDEN).json({
			code: 3,
			message:
				'Local config presets are currently unavailable due to hash validation failure. Please update the whitelist and restart the service.',
		});
		return;
	}

	// Safely look up the config entry (returns undefined if unavailable)
	const configEntry = safeLookupConfig(configKey);

	if (!configEntry) {
		logger.error(`Config key not found: ${configKey}`);
		res.status(HttpStatusCodes.NOT_FOUND).json({
			code: 3,
			message: 'Config key not found',
		});
		return;
	}

	// Convert command to route path
	const routePath = commandToRoutePath(configEntry.command);

	// For GET requests (web UI access), API key is optional since the web UI is already protected by HTTPS
	// For POST requests (programmatic access), API key is required, but only when
	// authentication is actually configured (API_KEY can be empty).
	const apiKeyHeader = env.API_KEY_HEADER;
	const apiKey = req.headers[apiKeyHeader] as string | undefined;
	const apiKeyRequired = httpMethod === 'POST' && env.API_KEY.length > 0;

	// With an API key configured, the internal request could never pass the access
	// control middleware without one. Reject here with 401 instead of letting the
	// internal request fail and surface as a generic 500.
	if (apiKeyRequired && !apiKey) {
		logger.warn(
			`Rejected local config POST for '${configKey}': missing API key header`,
		);
		res.status(HttpStatusCodes.UNAUTHORIZED).json({
			code: 3,
			message: `Missing API key. Provide it in the '${apiKeyHeader}' header.`,
		});
		return;
	}

	// Make internal HTTPS request with API key (optional for GET requests)
	logger.debug(`Executing local config: ${configKey} -> ${routePath}`);
	const internalResponse = await makeInternalRequest({
		method: httpMethod,
		path: routePath,
		params: httpMethod === 'GET' ? configEntry.params : undefined,
		body: httpMethod === 'POST' ? configEntry.params : undefined,
		apiKey,
		apiKeyHeader,
		requireApiKey: apiKeyRequired,
	});

	// Parse and forward response
	let responseJson: unknown;
	try {
		responseJson = JSON.parse(internalResponse.body);
	} catch (error) {
		res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({
			code: 3,
			message: 'Invalid response from plugin',
		});
		return;
	}

	res.status(internalResponse.statusCode).json(responseJson);
};

/**
 * GET /local-config
 * Executes a plugin based on a local config key from query parameter
 * Query: ?config=<key>
 * Response: Nagios-compatible JSON response
 */
export const getLocalConfig = async (
	req: Request,
	res: Response,
): Promise<void> => {
	try {
		const query = req.query as LocalConfigQuery;
		const configKey = query.config;

		if (!configKey || typeof configKey !== 'string') {
			res.status(HttpStatusCodes.BAD_REQUEST).json({
				code: 3,
				message: 'Missing config parameter. Expected ?config=<key>',
			});
			return;
		}

		// Validate config key format
		if (!CONFIG_KEY_PATTERN.test(configKey)) {
			res.status(HttpStatusCodes.BAD_REQUEST).json({
				code: 3,
				message:
					'Invalid config key format. Only alphanumeric, underscore, and hyphen are allowed.',
			});
			return;
		}

		// Execute the config key
		await executeLocalConfig(req, res, configKey, 'GET');
	} catch (error) {
		const errorMessage = getErrorMessage(error);
		logger.error(`Error executing local config: ${errorMessage}`);
		res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({
			code: 3,
			message: 'Internal server error',
		});
	}
};

/**
 * POST /local-config
 * Executes a plugin based on a local config key
 * Request body: { localConfig: <key> }
 * Response: Nagios-compatible response
 *
 * This route makes an internal HTTP request to the plugin endpoint,
 * ensuring the request goes through the full middleware stack.
 */
export const postLocalConfig = async (
	req: Request,
	res: Response,
): Promise<void> => {
	try {
		const body = req.body as LocalConfigRequest | undefined;

		// Validate request body exists
		if (!body) {
			res.status(HttpStatusCodes.BAD_REQUEST).json({
				code: 3,
				message: 'Missing request body. Expected JSON object.',
			});
			return;
		}

		// Check for extra fields (only allow 'localConfig')
		const allowedFields = ['localConfig'];
		const extraFields = Object.keys(body).filter(
			(key) => !allowedFields.includes(key),
		);
		if (extraFields.length > 0) {
			logger.warn(
				`Unexpected fields in local-config request: ${extraFields.join(', ')}`,
			);
			res.status(HttpStatusCodes.BAD_REQUEST).json({
				code: 3,
				message: `Unexpected fields in request: ${extraFields.join(', ')}. Only 'localConfig' is allowed.`,
			});
			return;
		}

		// Validate localConfig field exists
		if (!body.localConfig) {
			res.status(HttpStatusCodes.BAD_REQUEST).json({
				code: 3,
				message:
					'Missing or invalid request body. Expected { localConfig: <key> }',
			});
			return;
		}

		// Validate localConfig is a string
		if (typeof body.localConfig !== 'string') {
			res.status(HttpStatusCodes.BAD_REQUEST).json({
				code: 3,
				message: 'localConfig must be a string',
			});
			return;
		}

		// Sanitize and validate config key
		const configKey = body.localConfig.trim();

		// Check length
		if (configKey.length === 0 || configKey.length > MAX_CONFIG_KEY_LENGTH) {
			res.status(HttpStatusCodes.BAD_REQUEST).json({
				code: 3,
				message: `Config key must be between 1 and ${MAX_CONFIG_KEY_LENGTH} characters`,
			});
			return;
		}

		// Check for allowed characters only (prevent injection/path traversal)
		if (!CONFIG_KEY_PATTERN.test(configKey)) {
			res.status(HttpStatusCodes.BAD_REQUEST).json({
				code: 3,
				message:
					'Config key contains invalid characters. Only alphanumeric, underscore, and hyphen are allowed',
			});
			return;
		}

		// Execute the config key (use trimmed version)
		await executeLocalConfig(req, res, configKey, 'POST');
	} catch (error) {
		const errorMessage = getErrorMessage(error);
		logger.error(`Local config execution error: ${errorMessage}`);
		res.status(HttpStatusCodes.INTERNAL_SERVER_ERROR).json({
			code: 3,
			message: 'Internal server error',
		});
	}
};
