import fs from 'fs';
import os from 'os';
import path from 'path';
import {hashPluginEntryFile} from '../lib/plugin-manifest';
import {
	buildConfigHashContent,
	buildManifestContent,
	runPluginsHash,
} from './plugins-hash';

describe('plugins-hash', () => {
	describe('buildManifestContent', () => {
		let dir: string;

		beforeEach(() => {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-hash-manifest-'));
		});

		afterEach(() => {
			fs.rmSync(dir, {recursive: true, force: true});
		});

		const writePlugin = (name: string, source: string): string => {
			fs.writeFileSync(path.join(dir, `${name}.ts`), source);
			return path.join(dir, `${name}.manifest.json`);
		};

		test('reports unhashed when no hash declared', () => {
			const manifestPath = writePlugin('p', 'export const x = 1');
			fs.writeFileSync(
				manifestPath,
				JSON.stringify({name: 'p', version: '1', entry: 'p.ts'}),
			);

			const result = buildManifestContent(manifestPath);

			expect(result.update?.status).toBe('unhashed');
			expect(result.content).toBeUndefined();
		});

		test('reports unchanged when hash matches', () => {
			const manifestPath = writePlugin('p', 'export const x = 1');
			const hash = hashPluginEntryFile(path.join(dir, 'p.ts'));
			fs.writeFileSync(
				manifestPath,
				JSON.stringify({name: 'p', version: '1', entry: 'p.ts', hash}),
			);

			const result = buildManifestContent(manifestPath);

			expect(result.update?.status).toBe('unchanged');
			expect(result.content).toBeUndefined();
		});

		test('rewrites the hash when it changed', () => {
			const manifestPath = writePlugin('p', 'export const x = 1');
			fs.writeFileSync(
				manifestPath,
				JSON.stringify({
					name: 'p',
					version: '1',
					entry: 'p.ts',
					hash: 'b'.repeat(64),
				}),
			);

			const result = buildManifestContent(manifestPath);

			expect(result.update?.status).toBe('updated');
			expect(result.content).toBeDefined();
			expect(JSON.parse(result.content as string).hash).toBe(
				result.update?.hash,
			);
		});

		test('preserves other fields when rewriting', () => {
			const manifestPath = writePlugin('p', 'export const x = 1');
			fs.writeFileSync(
				manifestPath,
				JSON.stringify({
					name: 'p',
					version: '1',
					entry: 'p.ts',
					author: 'acme',
					hash: 'b'.repeat(64),
				}),
			);

			const result = buildManifestContent(manifestPath);

			expect(JSON.parse(result.content as string).author).toBe('acme');
		});

		test('warns when the manifest is invalid', () => {
			const manifestPath = path.join(dir, 'p.manifest.json');
			fs.writeFileSync(manifestPath, '{ bad json');

			const result = buildManifestContent(manifestPath);

			expect(result.warning).toContain('invalid manifest');
		});

		test('warns when the entry file is missing', () => {
			const manifestPath = path.join(dir, 'p.manifest.json');
			fs.writeFileSync(
				manifestPath,
				JSON.stringify({name: 'p', version: '1', entry: 'missing.ts'}),
			);

			const result = buildManifestContent(manifestPath);

			expect(result.warning).toContain('could not hash');
		});
	});

	describe('buildConfigHashContent', () => {
		test('updates an existing LOCAL_CONFIG_HASH line', () => {
			const existing =
				'NODE_ENV=production\nLOCAL_CONFIG_HASH=old\nPORT=5000\n';
			const result = buildConfigHashContent(existing, 'newhash');

			expect(result.status).toBe('updated');
			expect(result.content).toBe(
				'NODE_ENV=production\nLOCAL_CONFIG_HASH=newhash\nPORT=5000\n',
			);
		});

		test('reports unchanged when the hash already matches', () => {
			const existing = 'LOCAL_CONFIG_HASH=same\n';
			const result = buildConfigHashContent(existing, 'same');

			expect(result.status).toBe('unchanged');
			expect(result.content).toBe(existing);
		});

		test('appends the line when absent', () => {
			const existing = 'NODE_ENV=production\n';
			const result = buildConfigHashContent(existing, 'newhash');

			expect(result.status).toBe('added');
			expect(result.content).toBe(
				'NODE_ENV=production\nLOCAL_CONFIG_HASH=newhash\n',
			);
		});

		test('adds a newline before appending when content has none', () => {
			const existing = 'NODE_ENV=production';
			const result = buildConfigHashContent(existing, 'newhash');

			expect(result.status).toBe('added');
			expect(result.content).toBe(
				'NODE_ENV=production\nLOCAL_CONFIG_HASH=newhash\n',
			);
		});

		test('ignores a commented-out LOCAL_CONFIG_HASH line', () => {
			const existing = '# LOCAL_CONFIG_HASH=old\n';
			const result = buildConfigHashContent(existing, 'newhash');

			expect(result.status).toBe('added');
			expect(result.content).toContain('# LOCAL_CONFIG_HASH=old');
			expect(result.content).toContain('LOCAL_CONFIG_HASH=newhash');
		});
	});

	describe('runPluginsHash', () => {
		let dir: string;
		let configPath: string;

		beforeEach(() => {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-hash-run-'));
			configPath = path.join(dir, 'nest.conf');
		});

		afterEach(() => {
			fs.rmSync(dir, {recursive: true, force: true});
		});

		test('updates a sidecar manifest hash', () => {
			fs.writeFileSync(path.join(dir, 'check_a.ts'), 'export const a = 1');
			fs.writeFileSync(
				path.join(dir, 'check_a.manifest.json'),
				JSON.stringify({
					name: 'check_a',
					version: '1',
					entry: 'check_a.ts',
					hash: 'b'.repeat(64),
				}),
			);

			const result = runPluginsHash(dir, configPath);

			expect(result.manifests[0].status).toBe('updated');
			expect(result.changes).toBe(1);
		});

		test('skips a plugin file with no manifest', () => {
			fs.writeFileSync(path.join(dir, 'check_a.ts'), 'export const a = 1');

			const result = runPluginsHash(dir, configPath);

			expect(result.manifests).toEqual([]);
			expect(result.changes).toBe(0);
		});

		test('does nothing when there are no plugins', () => {
			const result = runPluginsHash(dir, configPath);

			expect(result.changes).toBe(0);
			expect(result.manifests).toEqual([]);
			expect(result.configHash).toBeUndefined();
		});

		test('skips test files and manifest files', () => {
			fs.writeFileSync(path.join(dir, 'check_a.test.ts'), 'test');
			fs.writeFileSync(path.join(dir, 'check_a.manifest.json'), '{}');

			const result = runPluginsHash(dir, configPath);

			expect(result.changes).toBe(0);
		});

		test('collects a warning for an invalid manifest', () => {
			fs.writeFileSync(path.join(dir, 'check_a.ts'), 'export const a = 1');
			fs.writeFileSync(path.join(dir, 'check_a.manifest.json'), '{ bad');

			const result = runPluginsHash(dir, configPath);

			expect(result.warnings.join('\n')).toContain('invalid manifest');
			expect(result.manifests).toEqual([]);
		});

		test('records an unhashed manifest without rewriting it', () => {
			fs.writeFileSync(path.join(dir, 'manual.ts'), 'export const m = 1');
			const manifestPath = path.join(dir, 'manual.manifest.json');
			fs.writeFileSync(
				manifestPath,
				JSON.stringify({name: 'manual', version: '1', entry: 'manual.ts'}),
			);

			const result = runPluginsHash(dir, configPath);

			expect(result.manifests[0].status).toBe('unhashed');
			expect(result.changes).toBe(0);
			expect(fs.readFileSync(manifestPath, 'utf8')).not.toContain('hash');
		});

		test('updates the config hash when presets exist', () => {
			fs.mkdirSync(path.join(dir, 'configs'));
			fs.writeFileSync(
				path.join(dir, 'configs', 'local-presets.conf'),
				'a=1\n',
			);
			fs.writeFileSync(configPath, 'NODE_ENV=production\n');

			const result = runPluginsHash(dir, configPath);

			expect(result.configHash?.status).toBe('added');
			expect(fs.readFileSync(configPath, 'utf8')).toContain(
				'LOCAL_CONFIG_HASH=',
			);
			expect(result.changes).toBe(1);
		});

		test('leaves the config untouched when the hash already matches', () => {
			fs.mkdirSync(path.join(dir, 'configs'));
			fs.writeFileSync(
				path.join(dir, 'configs', 'local-presets.conf'),
				'a=1\n',
			);
			const hash = hashPluginEntryFile(
				path.join(dir, 'configs', 'local-presets.conf'),
			);
			fs.writeFileSync(configPath, `LOCAL_CONFIG_HASH=${hash}\n`);

			const result = runPluginsHash(dir, configPath);

			expect(result.configHash?.status).toBe('unchanged');
			expect(result.changes).toBe(0);
		});

		test('skips the config update when the config file is absent', () => {
			fs.mkdirSync(path.join(dir, 'configs'));
			fs.writeFileSync(
				path.join(dir, 'configs', 'local-presets.conf'),
				'a=1\n',
			);

			const result = runPluginsHash(dir, path.join(dir, 'missing.conf'));

			expect(result.configHash).toBeUndefined();
		});

		test('warns when the config hash cannot be updated', () => {
			fs.mkdirSync(path.join(dir, 'configs'));
			fs.writeFileSync(
				path.join(dir, 'configs', 'local-presets.conf'),
				'a=1\n',
			);
			// A directory passes existsSync but readFileSync throws EISDIR,
			// exercising the failure path for the config hash update.
			const configDir = path.join(dir, 'conf-is-dir');
			fs.mkdirSync(configDir);

			const result = runPluginsHash(dir, configDir);

			expect(result.configHash).toBeUndefined();
			expect(result.warnings.join('\n')).toContain(
				'Could not update config hash',
			);
		});
	});
});
