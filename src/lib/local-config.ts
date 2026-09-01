import * as fs from 'fs';
import * as path from 'path';
import {env} from '../config/env';
import {getErrorMessage} from './error-message';
import {validateUnixFileSecurity} from './file-security';
import {logger} from './logger';
import {hashPluginFile as hashPluginFileImpl} from './plugin-whitelist';

// Maximum allowed config file size (100KB)
const MAX_CONFIG_FILE_SIZE = 100 * 1024;

// Hash function - can be overridden in tests
let hashPluginFileFn: (path: string) => string = hashPluginFileImpl;

// File security check function - can be overridden in tests
let checkConfigFileSecurityFn: (
	filePath: string,
	expectedUid: number,
) => boolean = (filePath: string, expectedUid: number): boolean => {
	try {
		const fileStat = fs.statSync(filePath);
		return validateUnixFileSecurity(fileStat, expectedUid).ok;
	} catch {
		return false;
	}
};

/**
 * Set the hash function (for testing purposes)
 * @param fn The hash function to use
 */
export const setHashFunction = (fn: (path: string) => string): void => {
	hashPluginFileFn = fn;
};

/**
 * Set the file security check function (for testing purposes)
 * @param fn The file security check function to use
 */
export const setCheckConfigFileSecurityFn = (
	fn: (filePath: string, expectedUid: number) => boolean,
): void => {
	checkConfigFileSecurityFn = fn;
};

/**
 * Reset module state (for testing purposes)
 */
export const resetModuleState = (): void => {
	hashPluginFileFn = hashPluginFileImpl;
	checkConfigFileSecurityFn = (
		filePath: string,
		expectedUid: number,
	): boolean => {
		try {
			const fileStat = fs.statSync(filePath);
			return validateUnixFileSecurity(fileStat, expectedUid).ok;
		} catch {
			return false;
		}
	};
	cachedWhitelistEntries = null;
	cachedConfig = null;
	approvedConfigContent = null;
	startupLoadingCompleted = false;
	startupValidationFailed = false;
};

/**
 * Represents a parsed local config entry
 */
export interface LocalConfigEntry {
	/** The plugin command to execute */
	command: string;
	/** Key-value parameters for the plugin */
	params: Record<string, string>;
}

const CONFIG_FILE_NAME = 'local-presets.conf';

/**
 * Key this file is registered under in `plugins/plugin-whitelist.txt`.
 */
const WHITELIST_RELATIVE_PATH = 'configs/local-presets.conf';

/**
 * Cached whitelist entries for runtime verification
 * Populated at startup, used for runtime hash checks
 */
let cachedWhitelistEntries: Map<string, string> | null = null;

/**
 * Cached config loaded at startup (memory-only after initial load)
 */
let cachedConfig: Map<string, LocalConfigEntry> | null = null;

/**
 * Exact bytes of the whitelist-approved config file, captured at startup.
 *
 * The admin editor offers a revert action that restores these bytes, which is
 * the escape hatch for an operator who saved a file they then chose not to
 * whitelist. Without it they would have to hand-edit the file to get back to a
 * restart-safe state.
 */
let approvedConfigContent: string | null = null;

/**
 * Flag to track if startup loading completed successfully
 */
let startupLoadingCompleted = false;

/**
 * Flag to track if startup validation failed
 */
let startupValidationFailed = false;

/**
 * Set cached whitelist entries (called at startup)
 *
 * @param entries Whitelist entries to cache
 */
export const setWhitelistCache = (entries: Map<string, string>): void => {
	cachedWhitelistEntries = entries;
};

/**
 * Validate config file path for security
 * Prevents path traversal and ensures file is in allowed directory
 *
 * @param configPath Absolute path to validate
 * @throws Error if path is insecure
 */
export const validateConfigFilePath = (configPath: string): void => {
	// Reject paths containing path traversal sequences
	if (configPath.includes('..')) {
		throw new Error('Config file path contains path traversal sequence');
	}

	// Resolve to absolute path for consistent validation
	const absolutePath = path.resolve(configPath);

	// Define allowed base directories
	const allowedBaseDirs = [path.resolve(process.cwd(), env.PLUGINS_DIR)];

	// Check if path is within allowed directories
	const isAllowed = allowedBaseDirs.some((baseDir) => {
		return (
			absolutePath.startsWith(baseDir + path.sep) || absolutePath === baseDir
		);
	});

	if (!isAllowed) {
		throw new Error(
			`Config file path not in allowed directory: ${absolutePath}`,
		);
	}
};

/**
 * Validate config file security (type, size)
 *
 * @param configPath Absolute path to validate
 * @throws Error if file security is unacceptable
 */
export const validateConfigFileSecurity = (configPath: string): void => {
	const stats = fs.statSync(configPath);

	// Verify it's a regular file
	if (!stats.isFile()) {
		throw new Error('Config file is not a regular file');
	}

	// Check file size
	if (stats.size > MAX_CONFIG_FILE_SIZE) {
		throw new Error(
			`Config file exceeds maximum size limit (${MAX_CONFIG_FILE_SIZE} bytes)`,
		);
	}
};

/**
 * Get the full path to the local config file
 * Uses PLUGINS_DIR from environment configuration
 *
 * @returns Absolute path to the config file
 */
export const getConfigFilePath = (): string => {
	const pluginsDir = path.resolve(process.cwd(), env.PLUGINS_DIR);
	return path.join(pluginsDir, 'configs', CONFIG_FILE_NAME);
};

/**
 * Parse a single config line into command and parameters
 * Format: <key>=<command> <param1>=<value1> <param2>=<value2> ...
 *
 * @param line The config line to parse (without the key= prefix)
 * @returns Parsed command and parameters
 * @throws Error if line format is invalid
 */
export const parseConfigLine = (line: string): LocalConfigEntry => {
	const trimmedLine = line.trim();

	if (!trimmedLine) {
		throw new Error('Empty config line');
	}

	// Split by spaces to get tokens
	const tokens = trimmedLine.split(/\s+/);

	// First token is the command
	const command = tokens[0];

	// Remaining tokens are parameters
	const params: Record<string, string> = {};
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i];
		const eqIndex = token.indexOf('=');

		if (eqIndex === -1) {
			throw new Error(
				`Invalid parameter format: "${token}". Expected key=value format.`,
			);
		}

		const key = token.slice(0, eqIndex);
		const value = token.slice(eqIndex + 1);

		if (!key) {
			throw new Error(`Empty parameter key in: "${token}"`);
		}

		params[key] = value;
	}

	return {command, params};
};

/**
 * Internal parser for config file (used only at startup - contains disk I/O)
 *
 * @param configPath Absolute path to the config file
 * @returns Map of config key to LocalConfigEntry
 * @throws Error if config file has invalid format
 */
const parseConfigFileInternal = (
	configPath: string,
): Map<string, LocalConfigEntry> => {
	// Validate path security before reading
	validateConfigFilePath(configPath);

	// Validate file security (type, size)
	validateConfigFileSecurity(configPath);

	const configs = new Map<string, LocalConfigEntry>();
	const content = fs.readFileSync(configPath, 'utf-8');
	const lines = content.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line || line.startsWith('#')) {
			continue;
		}

		const eqIndex = line.indexOf('=');
		if (eqIndex === -1) {
			throw new Error(`Invalid format at line ${i + 1}`);
		}

		const key = line.slice(0, eqIndex);
		const value = line.slice(eqIndex + 1);

		if (!key) {
			throw new Error(`Empty key at line ${i + 1}`);
		}
		if (configs.has(key)) {
			throw new Error(`Duplicate key "${key}" at line ${i + 1}`);
		}

		configs.set(key, parseConfigLine(value));
	}

	return configs;
};

/**
 * Load and validate config once at startup (only disk I/O point)
 * This should be called after setWhitelistCache
 */
export const loadConfigAtStartup = (): void => {
	// Prevent double-loading
	if (startupLoadingCompleted) {
		return;
	}

	// Whitelist cache must be set before loading config
	if (!cachedWhitelistEntries) {
		logger.error(
			'Whitelist cache not populated before config validation - this is a bug',
		);
		startupValidationFailed = true;
		startupLoadingCompleted = true;
		return;
	}

	const configPath = getConfigFilePath();
	const relativePath = WHITELIST_RELATIVE_PATH;

	// File is optional - empty cache if missing
	if (!fs.existsSync(configPath)) {
		cachedConfig = new Map();
		startupLoadingCompleted = true;
		return;
	}

	// File security check (permissions/ownership)
	const expectedUid =
		typeof process.getuid === 'function' ? process.getuid() : undefined;
	if (expectedUid !== undefined) {
		if (!checkConfigFileSecurityFn(configPath, expectedUid)) {
			const fileStat = fs.statSync(configPath);
			const mode = ((fileStat.mode & 0o7777) >>> 0)
				.toString(8)
				.padStart(4, '0');
			logger.warn(
				`Config file ${relativePath} has insecure permissions (${mode}); it must not be writable by group or others. ` +
					`Restart the service after fixing the file permissions.`,
			);
			startupValidationFailed = true;
			startupLoadingCompleted = true;
			return;
		}
	}

	// Hash validation (only at startup)
	const approvedHash = cachedWhitelistEntries.get(relativePath);
	if (approvedHash) {
		const currentHash = hashPluginFileFn(configPath);
		if (currentHash !== approvedHash) {
			logger.warn(
				`Config file ${relativePath} hash changed from whitelisted value. ` +
					`Whitelist expects ${approvedHash}, current sha256 is ${currentHash}. ` +
					`Restart the service after updating the whitelist.`,
			);
			startupValidationFailed = true;
			startupLoadingCompleted = true;
			return;
		}
	} else {
		// Config file exists but is not whitelisted — fail secure
		logger.warn(
			`Config file ${relativePath} is not whitelisted. ` +
				`Add the hash to the whitelist to approve this config file.`,
		);
		startupValidationFailed = true;
		startupLoadingCompleted = true;
		return;
	}

	// Load and parse config (only disk I/O point)
	try {
		cachedConfig = parseConfigFileInternal(configPath);
		// Remember the exact bytes the whitelist hash covers. This is the restore
		// target for the admin editor's revert action, and it is only ever captured
		// here, from a file that passed the security and hash checks above.
		approvedConfigContent = fs.readFileSync(configPath, 'utf-8');
		startupLoadingCompleted = true;
	} catch (error) {
		const errorMessage = getErrorMessage(error);
		logger.error(`Failed to parse config file: ${errorMessage}`);
		startupValidationFailed = true;
		startupLoadingCompleted = true;
	}
};

/**
 * Parse the local config file and return all config entries (memory-only - returns cached data)
 *
 * @returns Map of config key to LocalConfigEntry (cached from startup)
 * @throws Error if startup loading failed or was not completed
 */
export const parseConfigFile = (): Map<string, LocalConfigEntry> => {
	// Check startup completion status
	if (!startupLoadingCompleted || startupValidationFailed) {
		throw new Error(
			'Config unavailable - startup loading failed or not completed',
		);
	}

	return cachedConfig!;
};

/**
 * Lookup a config entry by key (memory-only)
 *
 * @param configKey The config key to lookup
 * @returns LocalConfigEntry if found
 * @throws Error if startup loading failed/not completed, or if key not found in cache
 */
export const lookupConfig = (configKey: string): LocalConfigEntry => {
	// Check startup completion status
	if (!startupLoadingCompleted || startupValidationFailed) {
		throw new Error(
			'Config unavailable - startup loading failed or not completed',
		);
	}

	// Memory-only lookup
	const entry = cachedConfig!.get(configKey);
	if (!entry) {
		const availableKeys = Array.from(cachedConfig!.keys());
		const message =
			availableKeys.length > 0
				? `Config key "${configKey}" not found. Available keys: ${availableKeys.join(', ')}`
				: `Config key "${configKey}" not found. No local config presets available`;
		throw new Error(message);
	}

	return entry;
};

/**
 * Check if a config key exists in the cached config (memory-only)
 *
 * @param configKey The config key to check
 * @returns true if the key exists in cache, false if startup not completed or validation failed
 */
export const configKeyExists = (configKey: string): boolean => {
	// Check startup completion status
	if (!startupLoadingCompleted || startupValidationFailed) {
		return false;
	}

	// Memory-only check
	return cachedConfig!.has(configKey);
};

/**
 * Get all available config keys from cache (memory-only)
 *
 * @returns Array of config keys (empty array if startup not completed or validation failed)
 */
export const getConfigKeys = (): string[] => {
	// Check startup completion status
	if (!startupLoadingCompleted || startupValidationFailed) {
		return [];
	}

	// Memory-only operation
	return Array.from(cachedConfig!.keys());
};

/**
 * Check if startup validation has failed
 * When true, config presets should not be displayed or accessible
 *
 * @returns true if validation failed at startup
 */
export const hasRuntimeValidationFailed = (): boolean => {
	return startupLoadingCompleted && startupValidationFailed;
};

/**
 * Safely lookup a config entry by key without throwing
 * Returns undefined if validation failed or key not found
 *
 * @param configKey The config key to lookup
 * @returns LocalConfigEntry if found, undefined otherwise
 */
export const safeLookupConfig = (
	configKey: string,
): LocalConfigEntry | undefined => {
	// Check startup completion status
	if (!startupLoadingCompleted || startupValidationFailed) {
		return undefined;
	}

	// Memory-only lookup
	return cachedConfig!.get(configKey);
};

export type ConfigDriftStatus = {
	/** Hash recorded in the whitelist; undefined when the file is not whitelisted. */
	approvedHash: string | undefined;
	/** Hash of the file as it is on disk right now; undefined when it is missing. */
	currentHash: string | undefined;
	/** True when the file on disk is not the bytes the whitelist approves. */
	drifted: boolean;
};

/**
 * Compare the config file on disk against the whitelist-approved hash.
 *
 * Strictly read-only: it never touches `cachedConfig` and never clears
 * `startupValidationFailed`. Applying a changed file stays a restart, which is
 * what keeps the whitelist a real approval gate - editing the file through the
 * admin UI must not be able to make new presets executable on its own.
 *
 * Works regardless of the startup outcome, because a drifted file is exactly
 * the situation where the startup cache is disabled.
 */
export const getConfigDrift = (): ConfigDriftStatus => {
	const approvedHash = cachedWhitelistEntries?.get(WHITELIST_RELATIVE_PATH);
	const configPath = getConfigFilePath();

	if (!fs.existsSync(configPath)) {
		// A missing file is only a deviation when an approved hash expects content.
		return {
			approvedHash,
			currentHash: undefined,
			drifted: approvedHash !== undefined,
		};
	}

	const currentHash = hashPluginFileFn(configPath);
	return {approvedHash, currentHash, drifted: currentHash !== approvedHash};
};

/**
 * The exact bytes of the whitelist-approved config file, captured at startup.
 *
 * @returns The approved content, or null when startup never loaded an approved
 *   file - in that case there is nothing safe to restore and revert is refused.
 */
export const getApprovedConfigContent = (): string | null => {
	return approvedConfigContent;
};
