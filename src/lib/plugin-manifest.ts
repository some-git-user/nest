import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {getErrorMessage} from './error-message';
import {isRecord} from './is-record';

/**
 * Per-plugin manifest.
 *
 * Each plugin `check_test.ts` carries its trust metadata in a sidecar manifest
 * `check_test.manifest.json` sitting next to it. The manifest holds the plugin's
 * identity and an optional SHA-256 of its entry file, so trust is decentralized:
 * each plugin declares its own hash instead of every plugin sharing one
 * whitelist file. This lets third parties drop their own plugin + manifest into
 * the directory without editing a file the package manager owns.
 */
export type PluginManifest = {
	name: string;
	version: string;
	/**
	 * Entry file, relative to the plugins directory. When omitted in the JSON it
	 * is derived from the manifest's base name, so `check_test.manifest.json`
	 * implies `check_test.ts`.
	 */
	entry: string;
	author?: string;
	description?: string;
	/** Optional SHA-256 (hex) of the entry file. When present it is verified. */
	hash?: string;
	/** Minimum nest version required to load this plugin. */
	minNestVersion?: string;
};

/**
 * Suffix used for a sidecar manifest. A plugin `check_test.ts` carries its
 * trust metadata in `check_test.manifest.json` next to it, so each plugin owns
 * its own hash instead of every plugin sharing one whitelist file. This lets
 * third parties drop their own plugin + manifest into the directory without
 * editing a file the package manager owns.
 */
export const PLUGIN_MANIFEST_SUFFIX = '.manifest.json';

export type ParseManifestResult = {
	manifest?: PluginManifest;
	warnings: string[];
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const toDisplayPath = (filePath: string): string => {
	const relativePath = path.relative(process.cwd(), filePath);
	return relativePath.length > 0 ? relativePath : filePath;
};

/**
 * Compute the SHA-256 of a plugin entry file. Mirrors the hashing used by the
 * shared whitelist so a hash produced by `nest plugins hash` is interchangeable
 * between a manifest and the legacy whitelist.
 */
export const hashPluginEntryFile = (filePath: string): string => {
	const fileContent = fs.readFileSync(filePath, 'utf8');
	return crypto.createHash('sha256').update(fileContent).digest('hex');
};

/**
 * Derive the default entry file name from a manifest file name:
 * `check_test.manifest.json` -> `check_test.ts`.
 */
export const deriveEntryFromManifestName = (
	manifestFileName: string,
): string => {
	const base = manifestFileName.endsWith(PLUGIN_MANIFEST_SUFFIX)
		? manifestFileName.slice(0, -PLUGIN_MANIFEST_SUFFIX.length)
		: manifestFileName;

	return `${base}.ts`;
};

/**
 * Build the sidecar manifest path for a plugin entry file:
 * `check_test.ts` -> `check_test.manifest.json`.
 */
export const manifestPathForEntry = (entryPath: string): string => {
	const ext = path.extname(entryPath);
	const base = ext.length > 0 ? entryPath.slice(0, -ext.length) : entryPath;
	return `${base}${PLUGIN_MANIFEST_SUFFIX}`;
};

/**
 * Parse and validate a manifest JSON string. Returns the manifest only when it
 * satisfies the required shape; otherwise it returns warnings describing why
 * the manifest was rejected. Malformed JSON never throws.
 */
export const parsePluginManifest = (
	content: string,
	manifestPath: string,
): ParseManifestResult => {
	const displayPath = toDisplayPath(manifestPath);
	let parsed: unknown;
	try {
		parsed = JSON.parse(content) as unknown;
	} catch (err) {
		return {
			warnings: [
				`Plugin manifest warning: ${displayPath} is not valid JSON. Error: ${getErrorMessage(err)}.`,
			],
		};
	}

	if (!isRecord(parsed)) {
		return {
			warnings: [
				`Plugin manifest warning: ${displayPath} must be a JSON object.`,
			],
		};
	}

	const warnings: string[] = [];
	const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
	const version =
		typeof parsed.version === 'string' ? parsed.version.trim() : '';
	// entry is optional: when absent it is derived from the manifest file name,
	// so `check_test.manifest.json` implies `check_test.ts`.
	const entry =
		typeof parsed.entry === 'string' && parsed.entry.trim().length > 0
			? parsed.entry.trim()
			: deriveEntryFromManifestName(path.basename(manifestPath));

	if (!name) {
		warnings.push(
			`Plugin manifest warning: ${displayPath} is missing a non-empty "name".`,
		);
	}

	if (!version) {
		warnings.push(
			`Plugin manifest warning: ${displayPath} is missing a non-empty "version".`,
		);
	}

	// Reject path traversal in the entry field: the entry must stay inside the
	// plugin directory.
	if (entry.includes('..') || path.isAbsolute(entry)) {
		warnings.push(
			`Plugin manifest warning: ${displayPath} has an unsafe "entry" path: ${entry}.`,
		);
	}

	let hash: string | undefined;
	if (typeof parsed.hash === 'string' && parsed.hash.length > 0) {
		if (SHA256_PATTERN.test(parsed.hash)) {
			hash = parsed.hash.toLowerCase();
		} else {
			warnings.push(
				`Plugin manifest warning: ${displayPath} has a "hash" that is not a SHA-256 hex digest.`,
			);
		}
	}

	if (warnings.length > 0) {
		return {warnings};
	}

	const manifest: PluginManifest = {name, version, entry};
	if (typeof parsed.author === 'string' && parsed.author.length > 0) {
		manifest.author = parsed.author;
	}

	if (typeof parsed.description === 'string' && parsed.description.length > 0) {
		manifest.description = parsed.description;
	}

	if (hash) {
		manifest.hash = hash;
	}

	if (
		typeof parsed.minNestVersion === 'string' &&
		parsed.minNestVersion.length > 0
	) {
		manifest.minNestVersion = parsed.minNestVersion;
	}

	return {manifest, warnings};
};

/**
 * Load a manifest from an explicit manifest file path. Returns an empty result
 * (no warnings) when the file does not exist, so callers can use this to probe
 * whether a plugin has a sidecar manifest.
 */
export const loadPluginManifest = (
	manifestPath: string,
): ParseManifestResult => {
	if (!fs.existsSync(manifestPath)) {
		return {warnings: []};
	}

	let content: string;
	try {
		content = fs.readFileSync(manifestPath, 'utf8');
	} catch (err) {
		return {
			warnings: [
				`Plugin manifest warning: could not read ${toDisplayPath(manifestPath)}. Error: ${getErrorMessage(err)}.`,
			],
		};
	}

	return parsePluginManifest(content, manifestPath);
};

/**
 * Compare two dotted numeric versions. Returns a negative number when `a` is
 * older, positive when newer, zero when equal. Non-numeric segments compare as
 * zero, so "1.2" == "1.2.0" and "1.x" is treated as "1.0".
 */
export const compareVersions = (a: string, b: string): number => {
	const partsA = a.split('.');
	const partsB = b.split('.');
	const length = Math.max(partsA.length, partsB.length);
	for (let i = 0; i < length; i += 1) {
		const numA = Number.parseInt(partsA[i] ?? '0', 10);
		const numB = Number.parseInt(partsB[i] ?? '0', 10);
		const safeA = Number.isNaN(numA) ? 0 : numA;
		const safeB = Number.isNaN(numB) ? 0 : numB;
		if (safeA !== safeB) {
			return safeA < safeB ? -1 : 1;
		}
	}

	return 0;
};

/**
 * Whether `appVersion` satisfies a plugin's `minNestVersion`. A plugin with no
 * minimum always satisfies.
 */
export const satisfiesMinVersion = (
	appVersion: string,
	minNestVersion?: string,
): boolean => {
	if (!minNestVersion) {
		return true;
	}

	return compareVersions(appVersion, minNestVersion) >= 0;
};

export type VerifyManifestHashResult = {
	approved: boolean;
	warnings: string[];
};

/**
 * Verify a manifest's entry file against its declared hash.
 *
 * Two-tier trust: when the manifest declares a hash it is enforced strictly
 * (a mismatch blocks loading). When it declares no hash the plugin is approved
 * but a warning is recorded — this is the path for operators who edit a plugin
 * in place with nano and never touch a hash. Filesystem ownership checks remain
 * the security boundary for that case.
 */
export const verifyManifestHash = (
	manifest: PluginManifest,
	entryPath: string,
): VerifyManifestHashResult => {
	const displayPath = toDisplayPath(entryPath);
	if (!manifest.hash) {
		return {
			approved: true,
			warnings: [
				`Plugin trust warning: ${manifest.name} has no "hash" in its manifest. Loading without integrity verification — run "nest plugins hash" to record the current hash.`,
			],
		};
	}

	let currentHash: string;
	try {
		currentHash = hashPluginEntryFile(entryPath);
	} catch (err) {
		return {
			approved: false,
			warnings: [
				`Plugin trust warning: could not hash ${displayPath}. Error: ${getErrorMessage(err)}.`,
			],
		};
	}

	if (currentHash !== manifest.hash) {
		return {
			approved: false,
			warnings: [
				`Plugin trust warning: ${displayPath} hash changed. Manifest expects ${manifest.hash}, current sha256 is ${currentHash}. Run "nest plugins hash" to update it.`,
			],
		};
	}

	return {approved: true, warnings: []};
};
