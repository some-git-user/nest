import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	PLUGIN_MANIFEST_SUFFIX,
	compareVersions,
	deriveEntryFromManifestName,
	hashPluginEntryFile,
	loadPluginManifest,
	manifestPathForEntry,
	parsePluginManifest,
	satisfiesMinVersion,
	verifyManifestHash,
} from './plugin-manifest';

describe('plugin-manifest', () => {
	describe('deriveEntryFromManifestName', () => {
		test('derives a .ts entry from the manifest suffix', () => {
			expect(deriveEntryFromManifestName('check_test.manifest.json')).toBe(
				'check_test.ts',
			);
		});

		test('appends .ts when the suffix is absent', () => {
			expect(deriveEntryFromManifestName('check_test')).toBe('check_test.ts');
		});
	});

	describe('manifestPathForEntry', () => {
		test('maps a .ts entry to its sidecar manifest', () => {
			expect(manifestPathForEntry('/p/check_test.ts')).toBe(
				'/p/check_test.manifest.json',
			);
		});

		test('maps a .js entry to its sidecar manifest', () => {
			expect(manifestPathForEntry('/p/check_test.js')).toBe(
				'/p/check_test.manifest.json',
			);
		});

		test('appends the suffix when the entry has no extension', () => {
			expect(manifestPathForEntry('/p/check_test')).toBe(
				'/p/check_test.manifest.json',
			);
		});
	});

	describe('parsePluginManifest', () => {
		const manifestPath = '/plugins/acme_disk.manifest.json';

		test('parses a valid manifest with all fields', () => {
			const result = parsePluginManifest(
				JSON.stringify({
					name: 'acme_disk',
					version: '1.2.3',
					entry: 'acme_disk.ts',
					author: 'acme',
					description: 'disk check',
					hash: 'A'.repeat(64),
					minNestVersion: '1.0.0',
				}),
				manifestPath,
			);

			expect(result.warnings).toEqual([]);
			expect(result.manifest).toEqual({
				name: 'acme_disk',
				version: '1.2.3',
				entry: 'acme_disk.ts',
				author: 'acme',
				description: 'disk check',
				hash: 'a'.repeat(64),
				minNestVersion: '1.0.0',
			});
		});

		test('derives entry from the manifest name when omitted', () => {
			const result = parsePluginManifest(
				JSON.stringify({name: 'acme_disk', version: '1'}),
				manifestPath,
			);

			expect(result.warnings).toEqual([]);
			expect(result.manifest?.entry).toBe('acme_disk.ts');
		});

		test('rejects invalid JSON', () => {
			const result = parsePluginManifest('{ not json', manifestPath);

			expect(result.manifest).toBeUndefined();
			expect(result.warnings[0]).toContain('not valid JSON');
		});

		test('rejects a non-object manifest', () => {
			const result = parsePluginManifest('[1,2]', manifestPath);

			expect(result.manifest).toBeUndefined();
			expect(result.warnings[0]).toContain('must be a JSON object');
		});

		test('warns when name and version are missing', () => {
			const result = parsePluginManifest(JSON.stringify({}), manifestPath);

			expect(result.manifest).toBeUndefined();
			expect(result.warnings.join('\n')).toContain('"name"');
			expect(result.warnings.join('\n')).toContain('"version"');
		});

		test('rejects a path-traversal entry', () => {
			const result = parsePluginManifest(
				JSON.stringify({name: 'p', version: '1', entry: '../../etc/x.ts'}),
				manifestPath,
			);

			expect(result.manifest).toBeUndefined();
			expect(result.warnings[0]).toContain('unsafe "entry" path');
		});

		test('rejects an absolute entry', () => {
			const result = parsePluginManifest(
				JSON.stringify({name: 'p', version: '1', entry: '/etc/x.ts'}),
				manifestPath,
			);

			expect(result.manifest).toBeUndefined();
			expect(result.warnings[0]).toContain('unsafe "entry" path');
		});

		test('warns when hash is not a SHA-256 digest', () => {
			const result = parsePluginManifest(
				JSON.stringify({name: 'p', version: '1', entry: 'p.ts', hash: 'zzz'}),
				manifestPath,
			);

			expect(result.manifest).toBeUndefined();
			expect(result.warnings[0]).toContain('not a SHA-256 hex digest');
		});

		test('uses the absolute path in warnings when relative path is empty', () => {
			const result = parsePluginManifest('{ bad', process.cwd());

			expect(result.warnings[0]).toContain(process.cwd());
		});
	});

	describe('loadPluginManifest', () => {
		let dir: string;

		beforeEach(() => {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-manifest-'));
		});

		afterEach(() => {
			fs.rmSync(dir, {recursive: true, force: true});
		});

		test('returns empty result when no manifest exists', () => {
			const result = loadPluginManifest(
				path.join(dir, `p${PLUGIN_MANIFEST_SUFFIX}`),
			);

			expect(result.manifest).toBeUndefined();
			expect(result.warnings).toEqual([]);
		});

		test('loads a manifest from disk', () => {
			const manifestPath = path.join(dir, 'p.manifest.json');
			fs.writeFileSync(
				manifestPath,
				JSON.stringify({name: 'p', version: '1', entry: 'p.ts'}),
			);

			const result = loadPluginManifest(manifestPath);

			expect(result.manifest?.name).toBe('p');
		});

		test('warns when the manifest cannot be read', () => {
			const manifestPath = path.join(dir, 'p.manifest.json');
			fs.mkdirSync(manifestPath);

			const result = loadPluginManifest(manifestPath);

			expect(result.manifest).toBeUndefined();
			expect(result.warnings[0]).toContain('could not read');
		});
	});

	describe('compareVersions', () => {
		test('compares equal versions', () => {
			expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
		});

		test('treats missing segments as zero', () => {
			expect(compareVersions('1.2', '1.2.0')).toBe(0);
		});

		test('detects older', () => {
			expect(compareVersions('1.1.9', '1.2.0')).toBeLessThan(0);
		});

		test('detects newer', () => {
			expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
		});

		test('treats non-numeric segments as zero', () => {
			expect(compareVersions('1.x', '1.0')).toBe(0);
		});

		test('treats a missing second-version segment as zero', () => {
			expect(compareVersions('1.2.0', '1.2')).toBe(0);
		});

		test('treats a non-numeric second-version segment as zero', () => {
			expect(compareVersions('1.0', '1.x')).toBe(0);
		});
	});

	describe('satisfiesMinVersion', () => {
		test('always satisfies when no minimum', () => {
			expect(satisfiesMinVersion('1.0.0', undefined)).toBe(true);
		});

		test('satisfies when app is newer', () => {
			expect(satisfiesMinVersion('2.0.0', '1.0.0')).toBe(true);
		});

		test('fails when app is older', () => {
			expect(satisfiesMinVersion('0.9.0', '1.0.0')).toBe(false);
		});
	});

	describe('verifyManifestHash', () => {
		let dir: string;
		let entryPath: string;

		beforeEach(() => {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-manifest-hash-'));
			entryPath = path.join(dir, 'p.ts');
			fs.writeFileSync(entryPath, 'export const x = 1');
		});

		afterEach(() => {
			fs.rmSync(dir, {recursive: true, force: true});
		});

		test('approves and warns when no hash declared', () => {
			const result = verifyManifestHash(
				{name: 'p', version: '1', entry: 'p.ts'},
				entryPath,
			);

			expect(result.approved).toBe(true);
			expect(result.warnings[0]).toContain('no "hash"');
		});

		test('approves when hash matches', () => {
			const hash = hashPluginEntryFile(entryPath);
			const result = verifyManifestHash(
				{name: 'p', version: '1', entry: 'p.ts', hash},
				entryPath,
			);

			expect(result.approved).toBe(true);
			expect(result.warnings).toEqual([]);
		});

		test('rejects when hash differs', () => {
			const result = verifyManifestHash(
				{name: 'p', version: '1', entry: 'p.ts', hash: 'b'.repeat(64)},
				entryPath,
			);

			expect(result.approved).toBe(false);
			expect(result.warnings[0]).toContain('hash changed');
		});

		test('rejects when the entry cannot be hashed', () => {
			const result = verifyManifestHash(
				{name: 'p', version: '1', entry: 'p.ts', hash: 'b'.repeat(64)},
				path.join(dir, 'missing.ts'),
			);

			expect(result.approved).toBe(false);
			expect(result.warnings[0]).toContain('could not hash');
		});
	});
});
