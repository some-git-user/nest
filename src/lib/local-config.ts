import * as fs from 'fs';
import * as path from 'path';
import {env} from '../config/env';
import {getErrorMessage} from './error-message';
import {logger} from './logger';
import {hashPluginFile as hashPluginFileImpl} from './plugin-whitelist';

// Hash function - can be overridden in tests
let hashPluginFileFn: (path: string) => string = hashPluginFileImpl;

/**
 * Set the hash function (for testing purposes)
 * @param fn The hash function to use
 */
export const setHashFunction = (fn: (path: string) => string): void => {
	hashPluginFileFn = fn;
};

/**
 * Reset module state (for testing purposes)
 */
export const resetModuleState = (): void => {
	hashPluginFileFn = hashPluginFileImpl;
	cachedWhitelistEntries = null;
	cachedConfig = null;
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
 * Cached whitelist entries for runtime verification
 * Populated at startup, used for runtime hash checks
 */
let cachedWhitelistEntries: Map<string, string> | null = null;

/**
 * Cached config loaded at startup (memory-only after initial load)
 */
let cachedConfig: Map<string, LocalConfigEntry> | null = null;

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
	const relativePath = 'configs/local-presets.conf';

	// File is optional - empty cache if missing
	if (!fs.existsSync(configPath)) {
		cachedConfig = new Map();
		startupLoadingCompleted = true;
		return;
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
	}

	// Load and parse config (only disk I/O point)
	try {
		cachedConfig = parseConfigFileInternal(configPath);
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
