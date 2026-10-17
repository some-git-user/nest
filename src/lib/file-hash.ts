import crypto from 'crypto';
import fs from 'fs';

/**
 * Compute the SHA-256 hex digest of a file's contents (read as UTF-8).
 *
 * Used by the local-config presets loader to compare the presets file against
 * its approved hash (supplied via the LOCAL_CONFIG_HASH config value). The
 * algorithm intentionally matches `hashPluginEntryFile` in `plugin-manifest.ts`
 * so a hash produced by `nest plugins hash` is interchangeable between a
 * sidecar manifest and the presets file.
 *
 * NOTE: this duplicates the manifest hashing on purpose. This project forbids
 * re-exports (`custom/no-re-export`): each module imports the symbol from the
 * module that defines it rather than forwarding it through a stub.
 */
export const hashFile = (filePath: string): string => {
	const fileContent = fs.readFileSync(filePath, 'utf8');
	return crypto.createHash('sha256').update(fileContent).digest('hex');
};
