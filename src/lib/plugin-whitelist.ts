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
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const toDisplayPath = (filePath: string): string => {
	const relativePath = path.relative(process.cwd(), filePath);
	return relativePath.length > 0 ? relativePath : filePath;
};

const normalizeHash = (hash: string): string => hash.toLowerCase();

export const hashPluginFile = (filePath: string): string => {
	const fileContent = fs.readFileSync(filePath);
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

export const verifyPluginWhitelist = ({
	pluginsDir,
	pluginFiles,
	whitelistPath,
}: VerifyPluginWhitelistOptions): VerifyPluginWhitelistResult => {
	const approvedFiles = new Set<string>();
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
		}
	}

	let whitelistEntries = new Map<string, string>();
	if (fs.existsSync(whitelistPath)) {
		if (typeof process.getuid === 'function') {
			const whitelistStat = fs.statSync(whitelistPath);
			const validation = validateUnixFileSecurity(
				whitelistStat,
				process.getuid(),
			);

			if (!validation.ok && validation.reason === 'owner-mismatch') {
				warnings.push(
					`Plugin trust warning: whitelist file ${displayWhitelistPath} has insecure ownership (uid ${validation.actualUid}); expected uid ${validation.expectedUid}. Refusing to trust whitelist entries.`,
				);
				return {approvedFiles, warnings};
			}

			if (!validation.ok && validation.reason === 'group-or-other-writable') {
				warnings.push(
					`Plugin trust warning: whitelist file ${displayWhitelistPath} has insecure permissions; it must not be writable by group or others. Refusing to trust whitelist entries.`,
				);
				return {approvedFiles, warnings};
			}
		}

		const parsed = parsePluginWhitelist(
			fs.readFileSync(whitelistPath, 'utf8'),
			displayWhitelistPath,
		);
		whitelistEntries = parsed.entries;
		warnings.push(...parsed.warnings);
	}

	for (const fileName of pluginFiles) {
		const filePath = path.join(pluginsDir, fileName);
		const displayPluginPath = toDisplayPath(filePath);

		let currentHash = '';
		try {
			currentHash = hashPluginFile(filePath);
		} catch (err) {
			warnings.push(
				`Plugin trust warning: could not hash ${displayPluginPath}. Error: ${getErrorMessage(err)}. Skipping plugin registration.`,
			);
			continue;
		}

		const approvedHash = whitelistEntries.get(fileName);
		if (!approvedHash) {
			warnings.push(
				`Plugin trust warning: ${displayPluginPath} is new or not whitelisted. Current sha256: ${currentHash}. Review it and add "${fileName} ${currentHash}" to ${displayWhitelistPath} before enabling it.`,
			);
			continue;
		}

		if (approvedHash !== currentHash) {
			warnings.push(
				`Plugin trust warning: ${displayPluginPath} hash changed. Whitelist expects ${approvedHash}, current sha256 is ${currentHash}. Review it and update ${displayWhitelistPath} before enabling it.`,
			);
			continue;
		}

		approvedFiles.add(fileName);
	}

	return {approvedFiles, warnings};
};
