import {createHash} from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {getErrorMessage} from './error-message';
import {getConfigFilePath, validateConfigFilePath} from './local-config';
import {logger} from './logger';

/**
 * Allowed characters for a config preset key. Shared with the request validation
 * in `controllers/local-config.ts` so the editor cannot produce a key that the
 * execution endpoint would later reject.
 */
export const CONFIG_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const MAX_CONFIG_KEY_LENGTH = 128;

/**
 * Allowed characters for a plugin command name and for a parameter key.
 *
 * A command is turned into a route path by `commandToRoutePath()` and a
 * parameter key is the left-hand side of a `key=value` token, so both have to
 * stay clear of the characters the line parser splits or stops on.
 */
export const COMMAND_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const PARAM_KEY_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/**
 * Upper bound for the rendered document. `validateConfigFileSecurity()` rejects
 * a config file above this size at startup, so writing one larger would take
 * every preset down on the next restart.
 */
export const MAX_CONFIG_DOCUMENT_BYTES = 100 * 1024;

/**
 * Identity of a document revision, used for optimistic concurrency.
 *
 * The editor sends back the hash it was served with; if the file changed on disk
 * in the meantime - a manual edit, another operator - the save is rejected
 * instead of silently dropping those edits.
 */
export const hashConfigContent = (content: string): string =>
	createHash('sha256').update(content, 'utf8').digest('hex');

/**
 * A single `key=command p1=v1 p2=v2` preset, in the shape the editor works with.
 * Structurally identical to `LocalConfigEntry` but with the key attached.
 */
export type PresetEntry = {
	key: string;
	command: string;
	params: Record<string, string>;
};

export type ConfigDocument = {
	/** Comment and blank lines, kept verbatim and in their original order. */
	preservedLines: string[];
	/** The parsed presets, in file order. */
	entries: PresetEntry[];
};

/**
 * Reject anything that would change how the line parser splits the file.
 *
 * `parseConfigLine()` splits on whitespace with no quoting support, so a value
 * containing a space would silently become an extra parameter, and a `#` or a
 * newline would let one preset inject a second config line. The `+` character
 * is the established escape for spaces (see `Test+message` in the shipped
 * example file) and is deliberately allowed.
 */
const INVALID_VALUE_CHARACTERS = /[\s#]/;

export const validateConfigKey = (key: string): string | undefined => {
	if (key.length === 0) {
		return 'Config key must not be empty';
	}
	if (key.length > MAX_CONFIG_KEY_LENGTH) {
		return `Config key must be at most ${MAX_CONFIG_KEY_LENGTH} characters`;
	}
	if (!CONFIG_KEY_PATTERN.test(key)) {
		return 'Config key may only contain letters, digits, underscore and hyphen';
	}
	return undefined;
};

export const validateCommand = (command: string): string | undefined => {
	if (command.length === 0) {
		return 'Plugin command must not be empty';
	}
	if (!COMMAND_PATTERN.test(command)) {
		return 'Plugin command may only contain letters, digits, underscore and hyphen';
	}
	return undefined;
};

export const validateParamKey = (paramKey: string): string | undefined => {
	if (paramKey.length === 0) {
		return 'Parameter name must not be empty';
	}
	if (!PARAM_KEY_PATTERN.test(paramKey)) {
		return `Invalid parameter name "${paramKey}". Use letters, digits, underscore, dot and hyphen.`;
	}
	return undefined;
};

export const validateParamValue = (
	paramKey: string,
	value: string,
): string | undefined => {
	if (INVALID_VALUE_CHARACTERS.test(value)) {
		return `Parameter "${paramKey}" may not contain whitespace or "#". Use "+" for spaces.`;
	}
	return undefined;
};

/**
 * Validate a whole preset the way the file parser would accept it.
 *
 * @returns A list of human readable problems; empty when the preset is valid.
 */
export const validatePresetEntry = (entry: PresetEntry): string[] => {
	const problems: string[] = [];

	const keyProblem = validateConfigKey(entry.key);
	if (keyProblem) {
		problems.push(keyProblem);
	}

	const commandProblem = validateCommand(entry.command);
	if (commandProblem) {
		problems.push(commandProblem);
	}

	for (const [paramKey, value] of Object.entries(entry.params)) {
		const paramKeyProblem = validateParamKey(paramKey);
		if (paramKeyProblem) {
			problems.push(paramKeyProblem);
			continue;
		}
		const valueProblem = validateParamValue(paramKey, value);
		if (valueProblem) {
			problems.push(valueProblem);
		}
	}

	return problems;
};

/**
 * Render one preset back into its file representation.
 *
 * Parameter order is `Object.keys()` order, which is insertion order for the
 * string keys this format allows, so an unchanged preset round-trips byte for
 * byte.
 */
export const buildConfigLine = (entry: PresetEntry): string => {
	const params = Object.entries(entry.params).map(
		([key, value]) => `${key}=${value}`,
	);
	return [entry.key, [entry.command, ...params].join(' ')].join('=');
};

/**
 * Split the file into the lines that must survive a rewrite verbatim (comments
 * and blanks, which carry the setup instructions shipped with the package) and
 * the presets themselves.
 *
 * Anything that is neither a comment nor a parseable preset is kept verbatim so
 * a save can never silently destroy content the editor does not understand.
 */
export const parseConfigDocument = (content: string): ConfigDocument => {
	const preservedLines: string[] = [];
	const entries: PresetEntry[] = [];

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith('#')) {
			preservedLines.push(rawLine);
			continue;
		}

		const eqIndex = line.indexOf('=');
		if (eqIndex === -1) {
			preservedLines.push(rawLine);
			continue;
		}

		const key = line.slice(0, eqIndex);
		const rest = line.slice(eqIndex + 1).trim();
		if (key.length === 0 || rest.length === 0) {
			preservedLines.push(rawLine);
			continue;
		}

		const tokens = rest.split(/\s+/);
		const params: Record<string, string> = {};
		let malformed = false;
		for (const token of tokens.slice(1)) {
			const tokenEq = token.indexOf('=');
			if (tokenEq === -1) {
				malformed = true;
				break;
			}
			params[token.slice(0, tokenEq)] = token.slice(tokenEq + 1);
		}

		if (malformed) {
			preservedLines.push(rawLine);
			continue;
		}

		entries.push({key, command: tokens[0], params});
	}

	return {preservedLines, entries};
};

/**
 * Render a document back to file content: preserved lines first, then presets.
 *
 * Reordering presets therefore does not reorder the comment block, and a preset
 * that was never touched comes out identical.
 */
export const serializeConfigDocument = (doc: ConfigDocument): string => {
	const header = doc.preservedLines
		.filter((line) => line.trim().length > 0)
		.join('\n');
	const body = doc.entries.map(buildConfigLine).join('\n');

	if (header.length === 0) {
		return body.length === 0 ? '' : `${body}\n`;
	}
	if (body.length === 0) {
		return `${header}\n`;
	}
	return `${header}\n\n${body}\n`;
};

export type ReadConfigDocumentResult = {
	doc: ConfigDocument;
	/** Exact bytes on disk, used for optimistic concurrency and for revert. */
	rawContent: string;
	exists: boolean;
};

/**
 * Read the presets file from disk for editing.
 *
 * Deliberately independent of the startup cache: the editor has to see what is
 * actually on disk, including changes that were never whitelist-approved.
 */
export const readConfigDocument = (): ReadConfigDocumentResult => {
	const configPath = getConfigFilePath();
	validateConfigFilePath(configPath);

	if (!fs.existsSync(configPath)) {
		return {
			doc: {preservedLines: [], entries: []},
			rawContent: '',
			exists: false,
		};
	}

	const rawContent = fs.readFileSync(configPath, 'utf-8');
	return {doc: parseConfigDocument(rawContent), rawContent, exists: true};
};

/**
 * Write the presets file atomically.
 *
 * A partial write would leave a file whose hash matches nothing and that may not
 * even parse, so the content is staged in a sibling temp file with the final
 * permissions and then renamed over the target.
 */
export const writeConfigDocument = (content: string): void => {
	const configPath = getConfigFilePath();
	validateConfigFilePath(configPath);

	const directory = path.dirname(configPath);
	const tempPath = path.join(
		directory,
		`.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`,
	);

	try {
		fs.writeFileSync(tempPath, content, {
			encoding: 'utf-8',
			mode: 0o640,
			flag: 'wx',
		});
		// umask can raise the mode requested above; enforce it explicitly so the
		// file never lands group- or world-writable, which startup would reject.
		fs.chmodSync(tempPath, 0o640);
		fs.renameSync(tempPath, configPath);
	} catch (error) {
		try {
			if (fs.existsSync(tempPath)) {
				fs.unlinkSync(tempPath);
			}
		} catch (cleanupError) {
			logger.warn(
				`Could not remove temporary config file ${tempPath}: ${getErrorMessage(cleanupError)}`,
			);
		}
		throw error;
	}
};

/**
 * Merge an edited preset with the stored one so that masked secrets survive a save.
 *
 * The editor never receives secret values back, so an untouched secret arrives as
 * an empty string. Treating empty as "keep what is stored" means an operator can
 * change a threshold without retyping a password.
 */
export const mergeMaskedParams = (
	secretNames: Set<string>,
	existing: Record<string, string> | undefined,
	incoming: Record<string, string>,
): Record<string, string> => {
	if (!existing) {
		return {...incoming};
	}

	const merged: Record<string, string> = {};
	for (const [key, value] of Object.entries(incoming)) {
		if (value === '' && secretNames.has(key) && key in existing) {
			merged[key] = existing[key];
			continue;
		}
		merged[key] = value;
	}
	return merged;
};

/**
 * Names that look like credentials and must never be sent to the browser.
 *
 * Used as a fallback for presets whose command is unknown (plugin removed or
 * renamed), where the example field schema is unavailable.
 */
const SECRET_NAME_PATTERN =
	/(password|passwd|secret|token|apikey|api_key|credential)/i;

export const isSecretParamName = (name: string): boolean =>
	SECRET_NAME_PATTERN.test(name);
