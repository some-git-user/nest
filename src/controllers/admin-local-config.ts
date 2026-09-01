import {Request, Response} from 'express';
import {env} from '../config/env';
import {
	ADMIN_PASSWORD_HEADER,
	ADMIN_UI_MOUNT_PATH,
	adminPasswordMatches,
	buildAdminSessionClearCookie,
	buildAdminSessionCookie,
	createAdminSessionCookieValue,
	hasValidAdminPassword,
	hasValidAdminSession,
} from '../lib/admin-auth';
import {
	applyAdminPageSecurityHeaders,
	renderAdminConfigPage,
	renderAdminLoginPage,
	renderAdminNotConfiguredPage,
} from '../lib/admin-page';
import {getErrorMessage} from '../lib/error-message';
import {HttpStatusCodes} from '../lib/http-status-codes';
import {makeInternalRequest} from '../lib/internal-http-client';
import {
	getApprovedConfigContent,
	getConfigDrift,
	hasRuntimeValidationFailed,
} from '../lib/local-config';
import {
	MAX_CONFIG_DOCUMENT_BYTES,
	type PresetEntry,
	hashConfigContent,
	isSecretParamName,
	mergeMaskedParams,
	readConfigDocument,
	serializeConfigDocument,
	validatePresetEntry,
	writeConfigDocument,
} from '../lib/local-config-store';
import {logger} from '../lib/logger';
import {commandToRoutePath} from '../lib/plugin-utils';
import {
	registeredPluginRouteExamples,
	registeredPluginRoutes,
} from '../routes/dynamic-routes';
import type {PluginExampleField} from '../types/plugin';

/**
 * Header a JSON API caller must send.
 *
 * A custom header turns every API call into a CORS preflighted request, which a
 * cross-site page cannot perform silently. Together with the `SameSite=Strict`
 * session cookie this means a foreign document cannot ride an operator's admin
 * session.
 */
export const ADMIN_API_HEADER = 'x-nest-admin';

const MAX_ENTRIES_PER_REQUEST = 500;
const MAX_PARAM_KEYS_PER_ENTRY = 100;

type AdminPresetPayload = {
	key: string;
	command: string;
	params: Record<string, string>;
};

/** A preset as served to the browser: secrets replaced by empty strings. */
type AdminPresetResponse = AdminPresetPayload & {
	/** Names whose stored value was masked, so the form can label them. */
	secretParams: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringRecord = (value: unknown): value is Record<string, string> =>
	isRecord(value) && Object.values(value).every((v) => typeof v === 'string');

/**
 * Command names offered by the editor.
 *
 * Derived from the registered routes rather than from the plugin file names: a
 * route path is what the loader actually produced, and `commandToRoutePath()`
 * maps the kebab-case name back onto the very same route, so a preset written
 * with this name resolves correctly.
 */
export const listAdminCommands = (): {
	command: string;
	routePath: string;
	fields: PluginExampleField[];
}[] => {
	return registeredPluginRoutes.map((routePath) => {
		const fieldsByName = new Map<string, PluginExampleField>();
		for (const example of registeredPluginRouteExamples[routePath] ?? []) {
			if (example.kind !== 'interactive') {
				continue;
			}
			for (const field of example.fields) {
				if (!fieldsByName.has(field.name)) {
					fieldsByName.set(field.name, field);
				}
			}
		}

		return {
			command: routePath.replace(/^\/plugins\//, ''),
			routePath,
			fields: Array.from(fieldsByName.values()),
		};
	});
};

/**
 * Parameter names of a command that must never be sent to the browser.
 *
 * The plugin's own field metadata is authoritative when the command is loaded;
 * the name heuristic covers presets whose command is unknown, e.g. after a
 * plugin was removed.
 */
export const secretParamNamesForCommand = (command: string): Set<string> => {
	const routePath = commandToRoutePath(command);
	const names = new Set<string>();
	for (const info of listAdminCommands()) {
		if (info.routePath !== routePath) {
			continue;
		}
		for (const field of info.fields) {
			if (field.type === 'password') {
				names.add(field.name);
			}
		}
	}
	return names;
};

const maskEntry = (
	entry: PresetEntry,
	secretNames: Set<string>,
): AdminPresetResponse => {
	const params: Record<string, string> = {};
	const secretParams: string[] = [];

	for (const [name, value] of Object.entries(entry.params)) {
		if (secretNames.has(name) || isSecretParamName(name)) {
			secretParams.push(name);
			params[name] = '';
			continue;
		}
		params[name] = value;
	}

	return {key: entry.key, command: entry.command, params, secretParams};
};

const sendAdminJson = (
	res: Response,
	status: number,
	body: Record<string, unknown>,
): Response => res.status(status).json(body);

const driftPayload = () => {
	const drift = getConfigDrift();
	return {
		approvedHash: drift.approvedHash ?? null,
		currentHash: drift.currentHash ?? null,
		drifted: drift.drifted,
	};
};

const readEntriesPayload = (
	body: unknown,
): {entries: AdminPresetPayload[]} | {problems: string[]} => {
	if (!isRecord(body) || !Array.isArray(body.entries)) {
		return {problems: ['Request body must contain an "entries" array.']};
	}
	if (body.entries.length > MAX_ENTRIES_PER_REQUEST) {
		return {
			problems: [
				`Too many presets: at most ${MAX_ENTRIES_PER_REQUEST} are accepted.`,
			],
		};
	}

	const problems: string[] = [];
	const entries: AdminPresetPayload[] = [];

	body.entries.forEach((rawEntry, index) => {
		if (!isRecord(rawEntry)) {
			problems.push(`Preset ${index + 1}: must be an object.`);
			return;
		}
		if (
			typeof rawEntry.key !== 'string' ||
			typeof rawEntry.command !== 'string'
		) {
			problems.push(`Preset ${index + 1}: key and command must be strings.`);
			return;
		}
		if (rawEntry.params !== undefined && !isStringRecord(rawEntry.params)) {
			problems.push(`Preset ${index + 1}: params must be string values.`);
			return;
		}
		const params = rawEntry.params ?? {};
		if (Object.keys(params).length > MAX_PARAM_KEYS_PER_ENTRY) {
			problems.push(
				`Preset ${index + 1}: at most ${MAX_PARAM_KEYS_PER_ENTRY} parameters are accepted.`,
			);
			return;
		}
		entries.push({key: rawEntry.key, command: rawEntry.command, params});
	});

	if (problems.length > 0) {
		return {problems};
	}
	return {entries};
};

/**
 * Validate the presets the browser submitted.
 *
 * Runs the same syntax rules the file parser implies, plus the duplicate-key
 * rule that startup treats as a fatal parse error. Secrets are merged in first,
 * because a masked secret that arrives empty is valid once restored.
 */
const validateEntries = (
	entries: AdminPresetPayload[],
	storedEntriesByKey: Map<string, PresetEntry>,
): string[] => {
	const problems: string[] = [];
	const seenKeys = new Set<string>();

	entries.forEach((entry, index) => {
		const label = entry.key.length > 0 ? `"${entry.key}"` : `#${index + 1}`;
		const merged = mergeMaskedParams(
			secretParamNamesForCommand(entry.command),
			storedEntriesByKey.get(entry.key)?.params,
			entry.params,
		);
		const entryProblems = validatePresetEntry({
			key: entry.key,
			command: entry.command,
			params: merged,
		});
		for (const problem of entryProblems) {
			problems.push(`Preset ${label}: ${problem}`);
		}

		if (entry.key.length > 0) {
			if (seenKeys.has(entry.key)) {
				problems.push(`Preset ${label}: duplicate key.`);
			}
			seenKeys.add(entry.key);
		}
	});

	return problems;
};

const buildDocument = (
	entries: AdminPresetPayload[],
	storedEntriesByKey: Map<string, PresetEntry>,
): string => {
	const {doc} = readConfigDocument();
	const mergedEntries: PresetEntry[] = entries.map((entry) => ({
		key: entry.key,
		command: entry.command,
		params: mergeMaskedParams(
			secretParamNamesForCommand(entry.command),
			storedEntriesByKey.get(entry.key)?.params,
			entry.params,
		),
	}));

	return serializeConfigDocument({
		preservedLines: doc.preservedLines,
		entries: mergedEntries,
	});
};

const storedEntriesByKeyFrom = (
	presets: PresetEntry[],
): Map<string, PresetEntry> => {
	const map = new Map<string, PresetEntry>();
	for (const preset of presets) {
		map.set(preset.key, preset);
	}
	return map;
};

/**
 * POST /admin/login
 *
 * Exchanges the admin password for a short-lived signed session cookie. The
 * password is accepted from the form body (browser) or the admin password header
 * (script), and a successful login rotates the credential by issuing a fresh
 * cookie rather than reusing a long-lived one.
 */
export const postAdminLogin = (req: Request, res: Response): void => {
	if (env.ADMIN_UI_PASSWORD.length === 0) {
		applyAdminPageSecurityHeaders(res);
		res
			.status(HttpStatusCodes.FORBIDDEN)
			.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.send(renderAdminNotConfiguredPage());
		return;
	}

	const bodyPassword =
		isRecord(req.body) && typeof req.body.adminPassword === 'string'
			? req.body.adminPassword
			: '';
	const headerPassword = (() => {
		const raw = req.headers[ADMIN_PASSWORD_HEADER];
		return Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '');
	})();
	const provided = bodyPassword.length > 0 ? bodyPassword : headerPassword;

	// Never report whether the password was wrong or the feature unconfigured,
	// and never echo the submitted password back into the page.
	if (!adminPasswordMatches(provided)) {
		logger.warn('Rejected admin login attempt: invalid admin password');
		applyAdminPageSecurityHeaders(res);
		res
			.status(HttpStatusCodes.UNAUTHORIZED)
			.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.send(renderAdminLoginPage('Invalid admin password.'));
		return;
	}

	res.setHeader(
		'Set-Cookie',
		buildAdminSessionCookie(createAdminSessionCookieValue()),
	);
	res.redirect(`${ADMIN_UI_MOUNT_PATH}/local-config`);
};

/**
 * POST /admin/logout
 *
 * Clears the session cookie. A no-op for a header-authenticated caller, which
 * holds no server-side state to clear.
 */
export const postAdminLogout = (_req: Request, res: Response): void => {
	res.setHeader('Set-Cookie', buildAdminSessionClearCookie());
	sendAdminJson(res, HttpStatusCodes.OK, {ok: true});
};

/**
 * GET /admin/local-config
 *
 * The editor page. Unauthenticated browsers get the login form; a caller that
 * presents the key in a header instead of a cookie gets the same page, because
 * the page itself is not secret - every endpoint below still checks on its own.
 */
export const getAdminConfigPage = (req: Request, res: Response): void => {
	applyAdminPageSecurityHeaders(res);

	if (env.ADMIN_UI_PASSWORD.length === 0) {
		res
			.status(HttpStatusCodes.FORBIDDEN)
			.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.send(renderAdminNotConfiguredPage());
		return;
	}

	if (!hasValidAdminSession(req) && !hasValidAdminPassword(req)) {
		res
			.status(HttpStatusCodes.UNAUTHORIZED)
			.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.send(renderAdminLoginPage());
		return;
	}

	const {doc, rawContent} = readConfigDocument();
	const state = {
		commands: listAdminCommands(),
		entries: doc.entries.map((entry) =>
			maskEntry(entry, secretParamNamesForCommand(entry.command)),
		),
		contentHash: hashConfigContent(rawContent),
		drift: driftPayload(),
		startupValidationFailed: hasRuntimeValidationFailed(),
	};

	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.send(renderAdminConfigPage(state));
};

/**
 * GET /admin/api/commands
 *
 * Plugin commands with the field metadata needed to build a form, so the editor
 * reuses exactly what the overview page renders instead of hardcoding anything.
 */
export const getAdminCommands = (_req: Request, res: Response): void => {
	sendAdminJson(res, HttpStatusCodes.OK, {commands: listAdminCommands()});
};

/**
 * GET /admin/api/entries
 *
 * The presets currently on disk plus the drift status. Always read from disk so
 * a manual edit is visible without a restart.
 */
export const getAdminEntries = (_req: Request, res: Response): void => {
	try {
		const {doc, rawContent} = readConfigDocument();
		sendAdminJson(res, HttpStatusCodes.OK, {
			entries: doc.entries.map((entry) =>
				maskEntry(entry, secretParamNamesForCommand(entry.command)),
			),
			contentHash: hashConfigContent(rawContent),
			drift: driftPayload(),
			startupValidationFailed: hasRuntimeValidationFailed(),
		});
	} catch (error) {
		reportError(res, error, 'Could not read the config file');
	}
};

const reportError = (
	res: Response,
	error: unknown,
	message: string,
	status: number = HttpStatusCodes.INTERNAL_SERVER_ERROR,
): void => {
	logger.error(`${message}: ${getErrorMessage(error)}`);
	sendAdminJson(res, status, {message});
};

/**
 * POST /admin/api/validate
 *
 * Checks a draft without writing it, which is what makes "test before adding"
 * possible: the operator sees syntax and duplicate-key problems before the file
 * - and therefore the whitelist hash - is touched.
 */
export const postAdminValidate = (req: Request, res: Response): void => {
	const parsed = readEntriesPayload(req.body);
	if ('problems' in parsed) {
		sendAdminJson(res, HttpStatusCodes.BAD_REQUEST, {
			ok: false,
			problems: parsed.problems,
		});
		return;
	}

	const {doc} = readConfigDocument();
	const problems = validateEntries(
		parsed.entries,
		storedEntriesByKeyFrom(doc.entries),
	);
	sendAdminJson(res, HttpStatusCodes.OK, {ok: problems.length === 0, problems});
};

/**
 * POST /admin/api/test
 *
 * Runs one draft preset through the real plugin route without saving it.
 *
 * The request is dialed back into this same server with the configured API key:
 * a browser could not reach `/plugins/<name>` directly when `API_KEY` is set,
 * and the operator is already authenticated here, so no new authority is
 * granted. Nothing is persisted, so testing an unapproved preset is harmless.
 */
export const postAdminTest = async (
	req: Request,
	res: Response,
): Promise<void> => {
	const parsed = readEntriesPayload({entries: [readSingleEntry(req.body)]});
	if ('problems' in parsed) {
		sendAdminJson(res, HttpStatusCodes.BAD_REQUEST, {
			ok: false,
			problems: parsed.problems,
		});
		return;
	}

	const draft = parsed.entries[0];
	const problems = validatePresetEntry(draft);
	if (problems.length > 0) {
		sendAdminJson(res, HttpStatusCodes.BAD_REQUEST, {ok: false, problems});
		return;
	}

	const method =
		isRecord(req.body) && req.body.method === 'POST'
			? ('POST' as const)
			: ('GET' as const);
	const apiKey = env.API_KEY.length > 0 ? env.API_KEY : undefined;

	try {
		const internalResponse = await makeInternalRequest({
			method,
			path: commandToRoutePath(draft.command),
			params: method === 'GET' ? draft.params : undefined,
			body: method === 'POST' ? draft.params : undefined,
			apiKey,
			apiKeyHeader: env.API_KEY_HEADER,
			requireApiKey: env.API_KEY.length > 0,
		});

		sendAdminJson(res, HttpStatusCodes.OK, {
			ok: true,
			statusCode: internalResponse.statusCode,
			body: internalResponse.body,
		});
	} catch (error) {
		reportError(
			res,
			error,
			'Could not execute the plugin',
			HttpStatusCodes.BAD_GATEWAY,
		);
	}
};

const readSingleEntry = (body: unknown): unknown => {
	if (!isRecord(body) || !isRecord(body.entry)) {
		return {key: '', command: '', params: {}};
	}
	return body.entry;
};

/**
 * POST /admin/api/save
 *
 * Writes the draft to disk. The whitelist is deliberately never touched: the
 * file's hash changes, the running presets stay the approved ones, and the drift
 * banner tells the operator what to approve. `baseHash` is the revision the form
 * was built from, so a concurrent manual edit is rejected instead of overwritten.
 */
export const postAdminSave = (req: Request, res: Response): void => {
	const parsed = readEntriesPayload(req.body);
	if ('problems' in parsed) {
		sendAdminJson(res, HttpStatusCodes.BAD_REQUEST, {
			ok: false,
			problems: parsed.problems,
		});
		return;
	}

	const baseHash =
		isRecord(req.body) && typeof req.body.baseHash === 'string'
			? req.body.baseHash
			: '';

	try {
		const {doc, rawContent} = readConfigDocument();
		const stored = storedEntriesByKeyFrom(doc.entries);

		if (baseHash.length === 0 || baseHash !== hashConfigContent(rawContent)) {
			sendAdminJson(res, HttpStatusCodes.CONFLICT, {
				ok: false,
				message:
					'The file changed on disk since it was loaded. Reload the page and re-apply your edits.',
			});
			return;
		}

		const problems = validateEntries(parsed.entries, stored);
		if (problems.length > 0) {
			sendAdminJson(res, HttpStatusCodes.BAD_REQUEST, {ok: false, problems});
			return;
		}

		const content = buildDocument(parsed.entries, stored);
		if (Buffer.byteLength(content, 'utf8') > MAX_CONFIG_DOCUMENT_BYTES) {
			sendAdminJson(res, HttpStatusCodes.BAD_REQUEST, {
				ok: false,
				message: `The resulting file would exceed ${MAX_CONFIG_DOCUMENT_BYTES} bytes, which the server refuses to load.`,
			});
			return;
		}

		writeConfigDocument(content);
		const after = readConfigDocument();
		logger.warn(
			'Local config presets file was rewritten through the admin UI. A restart is required and the whitelist hash must be updated.',
		);

		sendAdminJson(res, HttpStatusCodes.OK, {
			ok: true,
			contentHash: hashConfigContent(after.rawContent),
			drift: driftPayload(),
		});
	} catch (error) {
		reportError(res, error, 'Could not write the config file');
	}
};

/**
 * POST /admin/api/revert
 *
 * Restores the exact bytes that were whitelist-approved at startup. This is the
 * escape hatch for the footgun the save flow creates: without it, an operator
 * who saved a file they never approved would have to hand-edit the file to get
 * back to a restart-safe state.
 */
export const postAdminRevert = (_req: Request, res: Response): void => {
	const approved = getApprovedConfigContent();
	if (approved === null) {
		sendAdminJson(res, HttpStatusCodes.CONFLICT, {
			ok: false,
			message:
				'There is no whitelist-approved version to restore: startup never loaded an approved config file.',
		});
		return;
	}

	try {
		writeConfigDocument(approved);
		const after = readConfigDocument();
		logger.warn(
			'Local config presets file was reverted to the approved version.',
		);

		sendAdminJson(res, HttpStatusCodes.OK, {
			ok: true,
			contentHash: hashConfigContent(after.rawContent),
			drift: driftPayload(),
			entries: after.doc.entries.map((entry) =>
				maskEntry(entry, secretParamNamesForCommand(entry.command)),
			),
		});
	} catch (error) {
		reportError(res, error, 'Could not write the config file');
	}
};
