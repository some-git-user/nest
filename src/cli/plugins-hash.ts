import fs from 'fs';
import path from 'path';
import {getErrorMessage} from '../lib/error-message';
import {
	hashPluginEntryFile,
	loadPluginManifest,
	manifestPathForEntry,
} from '../lib/plugin-manifest';

const isIgnoredPluginFile = (file: string): boolean =>
	file.endsWith('.test.ts') ||
	file.endsWith('.spec.ts') ||
	file.endsWith('.test.js') ||
	file.endsWith('.spec.js') ||
	file.endsWith('.d.ts') ||
	file.endsWith('.manifest.json');

const isSupportedPluginFile = (file: string): boolean => {
	if (isIgnoredPluginFile(file)) {
		return false;
	}

	return file.endsWith('.ts') || file.endsWith('.js');
};

export type ManifestUpdate = {
	name: string;
	status: 'updated' | 'unchanged' | 'unhashed';
	hash: string;
};

/**
 * Update the `hash` field of a sidecar manifest in memory. Returns the new JSON
 * text and whether the hash changed. A manifest that declares no hash is
 * reported as `unhashed` and left untouched (two-tier trust: editing a plugin in
 * place with nano never requires a hash).
 */
export const buildManifestContent = (
	manifestPath: string,
): {content?: string; update?: ManifestUpdate; warning?: string} => {
	const {manifest} = loadPluginManifest(manifestPath);
	if (!manifest) {
		return {warning: `Skipping ${manifestPath}: invalid manifest.`};
	}

	const entryPath = path.join(path.dirname(manifestPath), manifest.entry);
	let currentHash: string;
	try {
		currentHash = hashPluginEntryFile(entryPath);
	} catch (err) {
		return {
			warning: `Skipping ${manifest.name}: could not hash ${entryPath}. Error: ${getErrorMessage(err)}.`,
		};
	}

	if (!manifest.hash) {
		return {
			update: {name: manifest.name, status: 'unhashed', hash: currentHash},
		};
	}

	if (manifest.hash === currentHash) {
		return {
			update: {name: manifest.name, status: 'unchanged', hash: currentHash},
		};
	}

	const raw = fs.readFileSync(manifestPath, 'utf8');
	let parsed: Record<string, unknown>;
	// istanbul ignore next - loadPluginManifest already parsed this file
	// successfully above, so re-parsing the same bytes cannot fail here.
	try {
		parsed = JSON.parse(raw) as Record<string, unknown>;
	} catch (err) {
		return {
			warning: `Skipping ${manifestPath}: could not reparse JSON. Error: ${getErrorMessage(err)}.`,
		};
	}

	parsed.hash = currentHash;
	// Tab-indented to match the repository's Prettier style for JSON files.
	return {
		content: `${JSON.stringify(parsed, null, '\t')}\n`,
		update: {name: manifest.name, status: 'updated', hash: currentHash},
	};
};

export type ConfigHashUpdate = {
	content: string;
	status: 'updated' | 'added' | 'unchanged';
	hash: string;
};

/**
 * Set the LOCAL_CONFIG_HASH line in a config file's text. Preserves every other
 * line verbatim; appends the line when it is absent. Returns the new content and
 * whether it changed.
 */
export const buildConfigHashContent = (
	existingContent: string,
	hash: string,
): ConfigHashUpdate => {
	const lines = existingContent.split(/\r?\n/);
	let found = false;
	let changed = false;

	const rewritten = lines.map((line) => {
		const trimmed = line.trim();
		if (trimmed.startsWith('#') || !trimmed.startsWith('LOCAL_CONFIG_HASH=')) {
			return line;
		}

		found = true;
		const currentValue = trimmed.slice('LOCAL_CONFIG_HASH='.length).trim();
		if (currentValue === hash) {
			return line;
		}

		changed = true;
		return `LOCAL_CONFIG_HASH=${hash}`;
	});

	if (!found) {
		let content = existingContent;
		if (content.length > 0 && !content.endsWith('\n')) {
			content += '\n';
		}

		return {
			content: `${content}LOCAL_CONFIG_HASH=${hash}\n`,
			status: 'added',
			hash,
		};
	}

	return {
		content: rewritten.join('\n'),
		status: changed ? 'updated' : 'unchanged',
		hash,
	};
};

export type PluginsHashResult = {
	manifests: ManifestUpdate[];
	configHash?: ConfigHashUpdate;
	warnings: string[];
	changes: number;
};

/**
 * Recompute and persist hashes for every plugin in `pluginsDir` (each plugin's
 * sidecar manifest) and refresh the LOCAL_CONFIG_HASH line in `configFilePath`.
 *
 * This is the implementation behind `nest plugins hash`. It needs write access
 * to the plugins directory and the config file (root in a packaged install,
 * since the service runs as root and both are root-owned).
 */
export const runPluginsHash = (
	pluginsDir: string,
	configFilePath: string,
): PluginsHashResult => {
	const warnings: string[] = [];
	const manifests: ManifestUpdate[] = [];

	const dirEntries = fs.readdirSync(pluginsDir);

	// Sidecar manifests: update each plugin file's manifest hash.
	const pluginFiles = dirEntries.filter(
		(entry) =>
			isSupportedPluginFile(entry) &&
			fs.statSync(path.join(pluginsDir, entry)).isFile(),
	);

	for (const file of pluginFiles) {
		const manifestPath = manifestPathForEntry(path.join(pluginsDir, file));
		if (!fs.existsSync(manifestPath)) {
			continue;
		}

		const result = buildManifestContent(manifestPath);
		if (result.warning) {
			warnings.push(result.warning);
			continue;
		}

		// buildManifestContent always returns an update when there is no warning.
		manifests.push(result.update as ManifestUpdate);

		if (result.content) {
			fs.writeFileSync(manifestPath, result.content);
		}
	}

	// Config presets hash: refresh LOCAL_CONFIG_HASH in the config file.
	let configHash: ConfigHashUpdate | undefined;
	const presetsPath = path.join(pluginsDir, 'configs', 'local-presets.conf');
	if (fs.existsSync(presetsPath) && fs.existsSync(configFilePath)) {
		try {
			const presetsHash = hashPluginEntryFile(presetsPath);
			const existing = fs.readFileSync(configFilePath, 'utf8');
			configHash = buildConfigHashContent(existing, presetsHash);
			if (configHash.status !== 'unchanged') {
				fs.writeFileSync(configFilePath, configHash.content);
			}
		} catch (err) {
			warnings.push(
				`Could not update config hash. Error: ${getErrorMessage(err)}.`,
			);
		}
	}

	const manifestChanges = manifests.filter(
		(update) => update.status === 'updated',
	).length;
	const configChanges = configHash && configHash.status !== 'unchanged' ? 1 : 0;

	return {
		manifests,
		configHash,
		warnings,
		changes: manifestChanges + configChanges,
	};
};
