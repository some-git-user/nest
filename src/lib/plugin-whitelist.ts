import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {getErrorMessage} from './error-message';
import {validateUnixFileSecurity} from './file-security';

type ParsedWhitelistResult = {
	entries: Map<string, string>;
	warnings: string[];
};

type VerifyPluginWhitelistOptions = {
	pluginsDir: string;
	pluginFiles: string[];
	whitelistPath: string;
};

type VerifyPluginWhitelistResult = {
	approvedFiles: Set<string>;
	warnings: string[];
	whitelistEntries: Map<string, string>;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const toDisplayPath = (filePath: string): string => {
	const relativePath = path.relative(process.cwd(), filePath);
	return relativePath.length > 0 ? relativePath : filePath;
};

const normalizeHash = (hash: string): string => hash.toLowerCase();

export const hashPluginFile = (filePath: string): string => {
	const fileContent = fs.readFileSync(filePath, 'utf8');
	return crypto.createHash('sha256').update(fileContent).digest('hex');
};

export const parsePluginWhitelist = (
	content: string,
	whitelistPath: string,
): ParsedWhitelistResult => {
	const entries = new Map<string, string>();
	const warnings: string[] = [];

	for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith('#')) {
			continue;
		}

		const parts = line.split(/\s+/);
		if (parts.length !== 2) {
			warnings.push(
				`Plugin trust warning: invalid line ${index + 1} in ${whitelistPath}. Expected "<filename> <sha256>" or "<sha256> <filename>".`,
			);
			continue;
		}

		const [first, second] = parts;
		let fileName: string | undefined;
		let hash: string | undefined;

		if (SHA256_PATTERN.test(first) && !SHA256_PATTERN.test(second)) {
			fileName = second;
			hash = normalizeHash(first);
		} else if (!SHA256_PATTERN.test(first) && SHA256_PATTERN.test(second)) {
			fileName = first;
			hash = normalizeHash(second);
		}

		if (!fileName || !hash) {
			warnings.push(
				`Plugin trust warning: invalid line ${index + 1} in ${whitelistPath}. Expected "<filename> <sha256>" or "<sha256> <filename>".`,
			);
			continue;
		}

		if (entries.has(fileName)) {
			warnings.push(
				`Plugin trust warning: duplicate whitelist entry for ${fileName} in ${whitelistPath}. Using the last hash value.`,
			);
		}

		entries.set(fileName, hash);
	}

	return {entries, warnings};
};

/**
 * Shared helper to load whitelist with auto-creation for plugins
 * Plugins get auto-creation with secure defaults, configs do not
 */
const loadWhitelistEntriesWithAutoCreate = (
	whitelistPath: string,
): {entries: Map<string, string>; warnings: string[]} => {
	const warnings: string[] = [];
	const displayWhitelistPath = toDisplayPath(whitelistPath);

	if (!fs.existsSync(whitelistPath)) {
		try {
			fs.mkdirSync(path.dirname(whitelistPath), {recursive: true});
			fs.writeFileSync(whitelistPath, '# filename sha256\n', {
				encoding: 'utf8',
				mode: 0o600,
				flag: 'wx',
			});
			// Enforce restrictive mode even when process umask is permissive.
			fs.chmodSync(whitelistPath, 0o600);
			warnings.push(
				`Plugin trust warning: whitelist file ${displayWhitelistPath} was missing and has been created with secure permissions (0600). Review plugin hashes and whitelist approved plugins before use.`,
			);
		} catch (err) {
			if (!fs.existsSync(whitelistPath)) {
				warnings.push(
					`Plugin trust warning: could not create whitelist file ${displayWhitelistPath}. Error: ${getErrorMessage(err)}.`,
				);
			}
			return {entries: new Map(), warnings};
		}
	}

	// Load whitelist with development-mode uid handling
	if (typeof process.getuid === 'function') {
		const whitelistStat = fs.statSync(whitelistPath);
		const processUid = process.getuid();

		// In development mode, accept either current user or root ownership
		// This allows running with sudo for plugin testing without breaking regular dev mode
		const expectedUid =
			process.env.NODE_ENV === 'development' && processUid === 0
				? whitelistStat.uid // Accept the actual file owner in dev mode
				: processUid;

		const validation = validateUnixFileSecurity(whitelistStat, expectedUid);

		if (!validation.ok && validation.reason === 'owner-mismatch') {
			warnings.push(
				`Plugin trust warning: whitelist file ${displayWhitelistPath} has insecure ownership (uid ${validation.actualUid}); expected uid ${validation.expectedUid}. Refusing to trust whitelist entries.`,
			);
			return {entries: new Map(), warnings};
		}

		if (!validation.ok && validation.reason === 'group-or-other-writable') {
			warnings.push(
				`Plugin trust warning: whitelist file ${displayWhitelistPath} has insecure permissions; it must not be writable by group or others. Refusing to trust whitelist entries.`,
			);
			return {entries: new Map(), warnings};
		}
	}

	const parsed = parsePluginWhitelist(
		fs.readFileSync(whitelistPath, 'utf8'),
		displayWhitelistPath,
	);
	return {entries: parsed.entries, warnings: [...warnings, ...parsed.warnings]};
};

export const verifyPluginWhitelist = ({
	pluginsDir,
	pluginFiles,
	whitelistPath,
}: VerifyPluginWhitelistOptions): VerifyPluginWhitelistResult => {
	const approvedFiles = new Set<string>();
	const warnings: string[] = [];
	const warningPrefix = 'Plugin trust warning';

	// Load whitelist with auto-creation (plugins get this, configs don't)
	const {entries: whitelistEntries, warnings: whitelistWarnings} =
		loadWhitelistEntriesWithAutoCreate(whitelistPath);
	warnings.push(...whitelistWarnings);

	// If whitelist is insecure (not just missing), return early
	// Check for security warnings (ownership/permission issues)
	const hasSecurityError = whitelistWarnings.some(
		(w) =>
			w.includes('insecure ownership') ||
			w.includes('insecure permissions') ||
			w.includes('Refusing to trust'),
	);
	if (hasSecurityError) {
		return {approvedFiles, warnings, whitelistEntries};
	}

	// Verify each plugin file (no file security check for plugins - only whitelist hash check)
	for (const fileName of pluginFiles) {
		const filePath = path.join(pluginsDir, fileName);
		const {approved, warnings: fileWarnings} = verifyFileAgainstWhitelist(
			filePath,
			fileName,
			warningPrefix,
			whitelistEntries,
			whitelistPath,
			undefined, // No expectedUid for plugins - skip file security check
			false, // Plugins are required, not optional
		);
		warnings.push(...fileWarnings);

		if (approved) {
			approvedFiles.add(fileName);
		}
	}

	return {approvedFiles, warnings, whitelistEntries};
};

/**
 * Shared helper to load and validate whitelist file
 * Returns parsed entries and warnings, or empty result if whitelist is missing/insecure
 */
const loadWhitelistEntries = (
	whitelistPath: string,
	warningPrefix: string,
): {entries: Map<string, string>; warnings: string[]} => {
	const warnings: string[] = [];
	const displayWhitelistPath = toDisplayPath(whitelistPath);

	if (!fs.existsSync(whitelistPath)) {
		warnings.push(
			`${warningPrefix}: whitelist file ${displayWhitelistPath} is missing. Cannot verify files.`,
		);
		return {entries: new Map(), warnings};
	}

	// Check whitelist file security
	/* istanbul ignore next - process.getuid is Unix-specific and may not exist on Windows. The branch where getuid exists is tested on Unix systems, but the false branch (getuid undefined) is unreachable in the test environment. Kept for cross-platform compatibility. */
	if (typeof process.getuid === 'function') {
		const whitelistStat = fs.statSync(whitelistPath);
		const processUid = process.getuid();

		const validation = validateUnixFileSecurity(whitelistStat, processUid);

		// Handle security validation results
		if (!validation.ok && validation.reason === 'owner-mismatch') {
			warnings.push(
				`${warningPrefix}: whitelist file ${displayWhitelistPath} has insecure ownership (uid ${validation.actualUid}); expected uid ${validation.expectedUid}. Refusing to trust whitelist entries.`,
			);
			return {entries: new Map(), warnings};
		}

		if (!validation.ok && validation.reason === 'group-or-other-writable') {
			warnings.push(
				`${warningPrefix}: whitelist file ${displayWhitelistPath} has insecure permissions; it must not be writable by group or others. Refusing to trust whitelist entries.`,
			);
			return {entries: new Map(), warnings};
		}
	}

	// Parse whitelist
	const parsed = parsePluginWhitelist(
		fs.readFileSync(whitelistPath, 'utf8'),
		displayWhitelistPath,
	);
	return {entries: parsed.entries, warnings: [...warnings, ...parsed.warnings]};
};

/**
 * Shared helper to verify a single file against whitelist
 * For plugins: only checks hash against whitelist (no file security)
 * For configs: can optionally check file security via expectedUid parameter
 */
export const verifyFileAgainstWhitelist = (
	filePath: string,
	relativePath: string,
	warningPrefix: string,
	whitelistEntries: Map<string, string>,
	whitelistPath: string,
	expectedUid?: number, // Optional: check uid (for config files, not plugins)
	/* istanbul ignore next - default parameter value branch is inherently untestable by coverage tools */
	isOptional: boolean = false, // Whether the file is optional (no warning if missing)
): {approved: boolean; warnings: string[]} => {
	const warnings: string[] = [];
	const displayFilePath = toDisplayPath(filePath);

	// Check file exists - optional files don't generate warnings when missing
	if (!fs.existsSync(filePath)) {
		if (!isOptional) {
			warnings.push(
				`${warningPrefix}: config file ${displayFilePath} is missing.`,
			);
		}
		return {approved: false, warnings};
	}

	// Check file security only if expectedUid is provided (config files only)
	if (expectedUid !== undefined && typeof process.getuid === 'function') {
		const fileStat = fs.statSync(filePath);

		const validation = validateUnixFileSecurity(fileStat, expectedUid);

		if (!validation.ok && validation.reason === 'owner-mismatch') {
			warnings.push(
				`${warningPrefix}: ${displayFilePath} has insecure ownership (uid ${validation.actualUid}); expected uid ${validation.expectedUid}.`,
			);
			return {approved: false, warnings};
		}

		if (!validation.ok && validation.reason === 'group-or-other-writable') {
			const mode = ((fileStat.mode & 0o7777) >>> 0)
				.toString(8)
				.padStart(4, '0');
			warnings.push(
				`${warningPrefix}: ${displayFilePath} has insecure permissions (${mode}); it must not be writable by group or others.`,
			);
			return {approved: false, warnings};
		}
	}

	// Hash and verify
	let currentHash = '';
	try {
		currentHash = hashPluginFile(filePath);
	} catch (err) {
		warnings.push(
			`${warningPrefix}: could not hash ${displayFilePath}. Error: ${getErrorMessage(err)}.`,
		);
		return {approved: false, warnings};
	}

	const approvedHash = whitelistEntries.get(relativePath);
	if (!approvedHash) {
		warnings.push(
			`${warningPrefix}: ${displayFilePath} is new or not whitelisted. Current sha256: ${currentHash}. Add "${relativePath} ${currentHash}" to ${toDisplayPath(whitelistPath)}.`,
		);
		return {approved: false, warnings};
	}

	if (approvedHash !== currentHash) {
		warnings.push(
			`${warningPrefix}: ${displayFilePath} hash changed. Whitelist expects ${approvedHash}, current sha256 is ${currentHash}. Update "${relativePath} ${currentHash}" in ${toDisplayPath(whitelistPath)}.`,
		);
		return {approved: false, warnings};
	}

	return {approved: true, warnings};
};

type VerifyConfigFilesOptions = {
	pluginsDir: string;
	configFiles: string[];
	whitelistPath: string;
};

type VerifyConfigFilesResult = {
	approvedFiles: Set<string>;
	warnings: string[];
	whitelistEntries: Map<string, string>;
};

/**
 * Verify config files against the whitelist
 * Uses shared helpers to avoid code duplication with verifyPluginWhitelist
 *
 * @param options - Configuration options
 * @returns Verification result with approved files and warnings
 */
export const verifyConfigFiles = ({
	pluginsDir,
	configFiles,
	whitelistPath,
}: VerifyConfigFilesOptions): VerifyConfigFilesResult => {
	const approvedFiles = new Set<string>();
	const warnings: string[] = [];
	const warningPrefix = 'Config warning';

	// Load and validate whitelist
	const {entries: whitelistEntries, warnings: whitelistWarnings} =
		loadWhitelistEntries(whitelistPath, warningPrefix);
	warnings.push(...whitelistWarnings);

	// If whitelist is insecure (not just missing), return early
	// Check for security warnings (ownership/permission issues)
	const hasSecurityError = whitelistWarnings.some(
		(w) =>
			w.includes('insecure ownership') ||
			w.includes('insecure permissions') ||
			w.includes('Refusing to trust'),
	);
	if (hasSecurityError) {
		return {approvedFiles, warnings, whitelistEntries};
	}

	// Verify each config file (with file security check for config files)
	/* istanbul ignore next - ternary creates two branches for process.getuid existence. The false branch (getuid undefined) is unreachable in Unix test environment but necessary for Windows compatibility. Coverage tool counts both branches separately. */
	const getUidIfExists = () =>
		typeof process.getuid === 'function' ? process.getuid() : undefined;
	const expectedUid = getUidIfExists();
	for (const configFile of configFiles) {
		const filePath = path.join(pluginsDir, configFile);
		const {approved, warnings: fileWarnings} = verifyFileAgainstWhitelist(
			filePath,
			configFile,
			warningPrefix,
			whitelistEntries,
			whitelistPath,
			expectedUid,
			true, // Config files are optional
		);
		warnings.push(...fileWarnings);

		if (approved) {
			approvedFiles.add(configFile);
		}
	}

	return {approvedFiles, warnings, whitelistEntries};
};
