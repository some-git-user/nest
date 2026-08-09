import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	parsePluginWhitelist,
	verifyConfigFiles,
	verifyFileAgainstWhitelist,
	verifyPluginWhitelist,
} from './plugin-whitelist';

describe('plugin whitelist verification', () => {
	test('parses filename-hash entries and ignores comments', () => {
		const result = parsePluginWhitelist(
			'# comment\ncheck_test.ts abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd\n',
			'plugins/plugin-whitelist.txt',
		);

		expect(result.entries.get('check_test.ts')).toBe(
			'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
		);
		expect(result.warnings).toEqual([]);
	});

	test('parses hash-first entries and warns on malformed lines', () => {
		const result = parsePluginWhitelist(
			[
				'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd check_test.ts',
				'invalid line here',
			].join('\n'),
			'plugins/plugin-whitelist.txt',
		);

		expect(result.entries.get('check_test.ts')).toBe(
			'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
		);
		expect(result.warnings).toEqual([
			'Plugin trust warning: invalid line 2 in plugins/plugin-whitelist.txt. Expected "<filename> <sha256>" or "<sha256> <filename>".',
		]);
	});

	test('warns when both whitelist tokens look like hashes', () => {
		const result = parsePluginWhitelist(
			'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd 1111111111111111111111111111111111111111111111111111111111111111',
			'plugins/plugin-whitelist.txt',
		);

		expect(result.entries.size).toBe(0);
		expect(result.warnings).toEqual([
			'Plugin trust warning: invalid line 1 in plugins/plugin-whitelist.txt. Expected "<filename> <sha256>" or "<sha256> <filename>".',
		]);
	});

	test('warns on duplicate entries and uses the last hash', () => {
		const result = parsePluginWhitelist(
			[
				'check_test.ts abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
				'check_test.ts 1111111111111111111111111111111111111111111111111111111111111111',
			].join('\n'),
			'plugins/plugin-whitelist.txt',
		);

		expect(result.entries.get('check_test.ts')).toBe(
			'1111111111111111111111111111111111111111111111111111111111111111',
		);
		expect(result.warnings).toEqual([
			'Plugin trust warning: duplicate whitelist entry for check_test.ts in plugins/plugin-whitelist.txt. Using the last hash value.',
		]);
	});

	test('approves whitelisted plugins and warns on changed and new plugins', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const approvedFilePath = path.join(pluginsDir, 'approved.ts');
		const changedFilePath = path.join(pluginsDir, 'changed.ts');
		const newFilePath = path.join(pluginsDir, 'new.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');

		fs.writeFileSync(approvedFilePath, 'export const approved = true;');
		fs.writeFileSync(changedFilePath, 'export const changed = true;');
		fs.writeFileSync(newFilePath, 'export const fresh = true;');

		const approvedHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(approvedFilePath))
			.digest('hex');

		fs.writeFileSync(
			whitelistPath,
			[
				`approved.ts ${approvedHash}`,
				'changed.ts 2222222222222222222222222222222222222222222222222222222222222222',
			].join('\n'),
		);
		fs.chmodSync(whitelistPath, 0o600);

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['approved.ts', 'changed.ts', 'new.ts'],
			whitelistPath,
		});

		expect(result.approvedFiles).toEqual(new Set(['approved.ts']));
		expect(result.warnings).toHaveLength(2);
		expect(result.warnings[0]).toContain('changed.ts hash changed');
		expect(result.warnings[1]).toContain('new.ts is new or not whitelisted');
	});

	test('uses fallback display paths when relative paths are empty', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const pluginPath = path.join(pluginsDir, 'fresh.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
		fs.writeFileSync(pluginPath, 'export const fresh = true;');

		const relativeSpy = jest.spyOn(path, 'relative').mockReturnValue('');
		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['fresh.ts'],
			whitelistPath,
		});
		relativeSpy.mockRestore();

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings).toHaveLength(2);
		expect(result.warnings[0]).toContain(whitelistPath);
		expect(result.warnings[1]).toContain(pluginPath);
	});

	test('creates a missing whitelist file with secure mode', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const pluginPath = path.join(pluginsDir, 'fresh.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
		fs.writeFileSync(pluginPath, 'export const fresh = true;');

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['fresh.ts'],
			whitelistPath,
		});

		expect(fs.existsSync(whitelistPath)).toBe(true);
		expect(fs.readFileSync(whitelistPath, 'utf8')).toContain(
			'# filename sha256',
		);
		expect(fs.statSync(whitelistPath).mode & 0o777).toBe(0o600);
		expect(result.warnings[0]).toContain('was missing and has been created');
		expect(result.warnings[1]).toContain('is new or not whitelisted');
	});

	test('warns when a plugin file is missing', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
		fs.writeFileSync(
			whitelistPath,
			'missing.ts 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o600);

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['missing.ts'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('is missing');
	});

	test('warns when whitelist file cannot be created', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const pluginPath = path.join(pluginsDir, 'fresh.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
		fs.writeFileSync(pluginPath, 'export const fresh = true;');

		const writeFileSyncSpy = jest
			.spyOn(fs, 'writeFileSync')
			.mockImplementationOnce(() => undefined)
			.mockImplementationOnce(() => {
				throw new Error('permission denied');
			});

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['fresh.ts'],
			whitelistPath,
		});
		writeFileSyncSpy.mockRestore();

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('could not create whitelist file');
		expect(result.warnings[1]).toContain('is new or not whitelisted');
	});

	test('handles whitelist creation race when file appears after write failure', () => {
		jest.resetModules();

		const pluginPath = '/tmp/plugins/fresh.ts';
		const whitelistPath = '/tmp/plugins/plugin-whitelist.txt';
		let whitelistExists = false;

		jest.doMock('fs', () => ({
			__esModule: true,
			default: {
				existsSync: (filePath: string) => {
					if (filePath === whitelistPath) {
						return whitelistExists;
					}
					return true;
				},
				mkdirSync: () => undefined,
				writeFileSync: (filePath: string) => {
					if (filePath === whitelistPath) {
						whitelistExists = true;
						throw new Error('EEXIST');
					}
				},
				chmodSync: () => undefined,
				readFileSync: (filePath: string) => {
					if (filePath === whitelistPath) {
						return '# filename sha256\n';
					}
					if (filePath === pluginPath) {
						return 'export const fresh = true;';
					}
					return '';
				},
				statSync: () => ({
					uid: typeof process.getuid === 'function' ? process.getuid() : 1000,
					mode: 0o100600,
					isFile: () => true,
				}),
			},
			existsSync: (filePath: string) => {
				if (filePath === whitelistPath) {
					return whitelistExists;
				}
				return true;
			},
			mkdirSync: () => undefined,
			writeFileSync: (filePath: string) => {
				if (filePath === whitelistPath) {
					whitelistExists = true;
					throw new Error('EEXIST');
				}
			},
			chmodSync: () => undefined,
			readFileSync: (filePath: string) => {
				if (filePath === whitelistPath) {
					return '# filename sha256\n';
				}
				if (filePath === pluginPath) {
					return 'export const fresh = true;';
				}
				return '';
			},
			statSync: () => ({
				uid: typeof process.getuid === 'function' ? process.getuid() : 1000,
				mode: 0o100600,
				isFile: () => true,
			}),
		}));

		try {
			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const isolated = require('./plugin-whitelist') as {
					verifyPluginWhitelist: typeof verifyPluginWhitelist;
				};

				const result = isolated.verifyPluginWhitelist({
					pluginsDir: '/tmp/plugins',
					pluginFiles: ['fresh.ts'],
					whitelistPath,
				});

				expect(result.approvedFiles.size).toBe(0);
				expect(result.warnings.join('\n')).not.toContain(
					'could not create whitelist file',
				);
				expect(result.warnings.join('\n')).toContain(
					'is new or not whitelisted',
				);
			});
		} finally {
			// Always unmock/reset even if assertions fail to avoid leaking mocked fs into other suites.
			jest.dontMock('fs');
			jest.resetModules();
		}
	});

	test('refuses whitelist entries when whitelist file owner does not match process uid', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const approvedFilePath = path.join(pluginsDir, 'approved.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
		fs.writeFileSync(approvedFilePath, 'export const approved = true;');
		fs.writeFileSync(
			whitelistPath,
			'approved.ts 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o600);

		if (typeof process.getuid !== 'function') {
			return;
		}
		const getUidSpy = jest
			.spyOn(process, 'getuid' as never)
			.mockReturnValue((process.getuid() + 1) as never);

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['approved.ts'],
			whitelistPath,
		});
		getUidSpy.mockRestore();

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('insecure ownership');
		expect(result.warnings[0]).toContain('Refusing to trust whitelist entries');
	});

	test('refuses whitelist entries when whitelist file is group writable', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const approvedFilePath = path.join(pluginsDir, 'approved.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
		fs.writeFileSync(approvedFilePath, 'export const approved = true;');
		fs.writeFileSync(
			whitelistPath,
			'approved.ts 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o660);

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['approved.ts'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('insecure permissions');
		expect(result.warnings[0]).toContain('Refusing to trust whitelist entries');
	});

	test('accepts user-owned whitelist file when running as root in development mode', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-dev-root-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const approvedFilePath = path.join(pluginsDir, 'approved.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');

		fs.writeFileSync(approvedFilePath, 'export const approved = true;');

		const approvedHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(approvedFilePath))
			.digest('hex');

		fs.writeFileSync(whitelistPath, `approved.ts ${approvedHash}`);
		fs.chmodSync(whitelistPath, 0o600);
		try {
			fs.chownSync(whitelistPath, 1000, 1000); // File owned by uid 1000
		} catch (error) {
			// Skip chown if not permitted (e.g., in CI environments)
			if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
				throw error;
			}
		}

		const originalEnv = process.env.NODE_ENV;
		const originalUid = process.getuid;

		process.env.NODE_ENV = 'development';
		process.getuid = () => 0 as unknown as number; // Process running as root

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['approved.ts'],
			whitelistPath,
		});

		process.env.NODE_ENV = originalEnv;
		process.getuid = originalUid;

		// In dev mode with root, user-owned whitelist files are accepted
		expect(result.approvedFiles.size).toBe(1);
		expect(result.warnings).toHaveLength(0);
	});

	test('passes security checks when whitelist ownership matches process uid', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-success-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const approvedFilePath = path.join(pluginsDir, 'approved.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');

		fs.writeFileSync(approvedFilePath, 'export const approved = true;');

		const approvedHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(approvedFilePath))
			.digest('hex');

		fs.writeFileSync(whitelistPath, `approved.ts ${approvedHash}`);
		fs.chmodSync(whitelistPath, 0o600);

		if (typeof process.getuid !== 'function') {
			return;
		}
		const realUid = process.getuid();

		// Make whitelist file owned by the same uid as the process
		fs.chownSync(whitelistPath, realUid, realUid);

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['approved.ts'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(1);
		expect(result.approvedFiles.has('approved.ts')).toBe(true);
		expect(result.warnings).toHaveLength(0);
	});

	test('refuses plugins when whitelist ownership does not match process uid', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-owner-mismatch-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const approvedFilePath = path.join(pluginsDir, 'approved.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');

		fs.writeFileSync(approvedFilePath, 'export const approved = true;');

		const approvedHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(approvedFilePath))
			.digest('hex');

		fs.writeFileSync(whitelistPath, `approved.ts ${approvedHash}`);
		fs.chmodSync(whitelistPath, 0o600);

		if (typeof process.getuid !== 'function') {
			return;
		}
		const realUid = process.getuid();
		const mockUid = realUid + 1;

		// Mock statSync to return different uid for whitelist file
		const originalStatSync = fs.statSync;
		const statSyncSpy = jest
			.spyOn(fs, 'statSync')
			.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
				const stat = originalStatSync.call(fs, filePath as fs.PathLike) as
					| fs.Stats
					| fs.BigIntStats;
				if (String(filePath).endsWith('plugin-whitelist.txt')) {
					return {
						...(stat as fs.Stats),
						uid: mockUid,
					} as fs.Stats;
				}
				return stat;
			});

		const getUidSpy = jest
			.spyOn(process, 'getuid' as never)
			.mockReturnValue(realUid as never);

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['approved.ts'],
			whitelistPath,
		});

		statSyncSpy.mockRestore();
		getUidSpy.mockRestore();

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('insecure ownership');
		expect(result.warnings[0]).toContain('Refusing to trust whitelist entries');
	});

	test('returns empty entries when whitelist file is missing', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-missing-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');

		// parsePluginWhitelist takes content, not file path
		// When file is missing, caller passes empty string
		const result = parsePluginWhitelist('', whitelistPath);

		expect(result.entries.size).toBe(0);
		expect(result.warnings).toHaveLength(0);
	});

	test('skips security check when process.getuid is unavailable', () => {
		jest.resetModules();

		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-plugin-whitelist-nogetuid-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const approvedFilePath = path.join(pluginsDir, 'approved.ts');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');

		fs.writeFileSync(approvedFilePath, 'export const approved = true;');
		fs.chmodSync(approvedFilePath, 0o600);

		const approvedHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(approvedFilePath))
			.digest('hex');

		fs.writeFileSync(whitelistPath, `approved.ts ${approvedHash}`);
		fs.chmodSync(whitelistPath, 0o600);

		// Remove getuid to simulate environment without it
		const originalGetuid = process.getuid;
		Object.defineProperty(process, 'getuid', {
			value: undefined,
			writable: true,
			configurable: true,
		});

		// Re-import after mocking
		const {verifyPluginWhitelist} = require('./plugin-whitelist');

		const result = verifyPluginWhitelist({
			pluginsDir,
			pluginFiles: ['approved.ts'],
			whitelistPath,
		});

		// Restore getuid
		if (originalGetuid) {
			Object.defineProperty(process, 'getuid', {
				value: originalGetuid,
				writable: true,
				configurable: true,
			});
		}

		// Should still work without getuid - skips security check
		expect(result.approvedFiles.size).toBe(1);
		expect(result.approvedFiles.has('approved.ts')).toBe(true);
	});
});

describe('verifyConfigFiles', () => {
	test('approves matching config files and warns on missing whitelist', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(configPath, 'key = value');
		fs.chmodSync(configPath, 0o600);

		const configHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(configPath))
			.digest('hex');

		fs.writeFileSync(whitelistPath, `local-presets.conf ${configHash}`);
		fs.chmodSync(whitelistPath, 0o600);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});

		expect(result.approvedFiles).toEqual(new Set(['local-presets.conf']));
		expect(result.warnings).toHaveLength(0);
	});

	test('warns when whitelist file is missing', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(configPath, 'key = value');

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('is missing');
	});

	test('does not warn when config file is missing (optional)', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(
			whitelistPath,
			'missing.conf 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o600);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['missing.conf'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings.length).toBe(0);
	});

	test('warns when config file hash changed', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(configPath, 'key = value');
		fs.chmodSync(configPath, 0o600);

		fs.writeFileSync(
			whitelistPath,
			'local-presets.conf 2222222222222222222222222222222222222222222222222222222222222222',
		);
		fs.chmodSync(whitelistPath, 0o600);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('hash changed');
	});

	test('warns when config file is new or not whitelisted', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(configPath, 'key = value');
		fs.chmodSync(configPath, 0o600);

		fs.writeFileSync(whitelistPath, '# filename sha256\n');
		fs.chmodSync(whitelistPath, 0o600);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('is new or not whitelisted');
	});

	test('warns when config file cannot be hashed', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(configPath, 'key = value');
		fs.chmodSync(configPath, 0o600);

		fs.writeFileSync(
			whitelistPath,
			'local-presets.conf 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o600);

		const originalReadFileSync = fs.readFileSync;
		const readFileSyncSpy = jest
			.spyOn(fs, 'readFileSync')
			.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
				if (String(filePath).endsWith('.conf')) {
					throw new Error('read error');
				}
				return originalReadFileSync.call(fs, filePath, 'utf8');
			});

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});
		readFileSyncSpy.mockRestore();

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('could not hash');
	});

	test('refuses config files when whitelist owner does not match process uid', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(configPath, 'key = value');
		fs.writeFileSync(
			whitelistPath,
			'local-presets.conf 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o600);

		if (typeof process.getuid !== 'function') {
			return;
		}
		const getUidSpy = jest
			.spyOn(process, 'getuid' as never)
			.mockReturnValue((process.getuid() + 1) as never);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});
		getUidSpy.mockRestore();

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('insecure ownership');
	});

	test('refuses config files when whitelist is group writable', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(configPath, 'key = value');
		fs.writeFileSync(
			whitelistPath,
			'local-presets.conf 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o660);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('insecure permissions');
	});

	test('refuses config file with insecure ownership', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(configPath, 'key = value');

		const configHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(configPath))
			.digest('hex');

		fs.writeFileSync(whitelistPath, `local-presets.conf ${configHash}`);
		fs.chmodSync(whitelistPath, 0o600);

		if (typeof process.getuid !== 'function') {
			return;
		}
		const realUid = process.getuid();
		const mockUid = realUid + 1;

		// Mock statSync so whitelist is owned by mockUid (passes whitelist check)
		// but config file is owned by realUid (fails config check)
		const originalStatSync = fs.statSync;
		const statSyncSpy = jest
			.spyOn(fs, 'statSync')
			.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
				const stat = originalStatSync.call(fs, filePath as fs.PathLike) as
					| fs.Stats
					| fs.BigIntStats;
				if (String(filePath).endsWith('config-whitelist.txt')) {
					return {
						...(stat as fs.Stats),
						uid: mockUid,
					} as fs.Stats;
				}
				if (String(filePath).endsWith('.conf')) {
					return {
						...(stat as fs.Stats),
						uid: realUid,
					} as fs.Stats;
				}
				return stat;
			});

		const getUidSpy = jest
			.spyOn(process, 'getuid' as never)
			.mockReturnValue(mockUid as never);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});
		getUidSpy.mockRestore();
		statSyncSpy.mockRestore();

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('insecure ownership');
	});

	test('refuses config file with insecure permissions', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-config-whitelist-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');
		fs.writeFileSync(configPath, 'key = value');

		const configHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(configPath))
			.digest('hex');

		fs.writeFileSync(whitelistPath, `local-presets.conf ${configHash}`);
		fs.chmodSync(whitelistPath, 0o600);

		// Make config file group-writable
		fs.chmodSync(configPath, 0o660);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings[0]).toContain('insecure permissions');
		expect(result.warnings[0]).toMatch(/\(0660\)/);
	});

	test('returns early with empty approvedFiles when whitelist has security error', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-verify-config-security-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		const configDir = path.join(pluginsDir, 'configs');
		fs.mkdirSync(configDir, {recursive: true});

		const configPath = path.join(configDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');

		// Create config file
		fs.writeFileSync(configPath, 'test=check-test');

		// Create whitelist with wrong ownership
		fs.writeFileSync(
			whitelistPath,
			'local-presets.conf 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o600);

		if (typeof process.getuid !== 'function') {
			return;
		}
		const getUidSpy = jest
			.spyOn(process, 'getuid' as never)
			.mockReturnValue((process.getuid() + 1) as never);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});
		getUidSpy.mockRestore();

		expect(result.approvedFiles.size).toBe(0);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('insecure ownership');
		expect(result.warnings[0]).toContain('Refusing to trust whitelist entries');
	});

	test('approves config files when whitelist passes security checks', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-verify-config-success-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');

		// Create config file
		fs.writeFileSync(configPath, 'key = value');
		fs.chmodSync(configPath, 0o600);

		// Create whitelist with correct hash
		const configHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(configPath))
			.digest('hex');
		fs.writeFileSync(whitelistPath, `local-presets.conf ${configHash}`);
		fs.chmodSync(whitelistPath, 0o600);

		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});

		expect(result.approvedFiles.size).toBe(1);
		expect(result.approvedFiles.has('local-presets.conf')).toBe(true);
		expect(result.warnings).toHaveLength(0);
	});

	test('continues processing when whitelist has no security errors', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-verify-config-noerrors-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const configPath = path.join(pluginsDir, 'local-presets.conf');
		const whitelistPath = path.join(pluginsDir, 'config-whitelist.txt');

		// Create config file
		fs.writeFileSync(configPath, 'key = value');
		fs.chmodSync(configPath, 0o600);

		// Create whitelist with correct hash and proper permissions
		const configHash = crypto
			.createHash('sha256')
			.update(fs.readFileSync(configPath))
			.digest('hex');
		fs.writeFileSync(whitelistPath, `local-presets.conf ${configHash}`);
		fs.chmodSync(whitelistPath, 0o600);

		// This test ensures hasSecurityError === false branch is covered
		// by verifying that processing continues normally when there are no security warnings
		const result = verifyConfigFiles({
			pluginsDir,
			configFiles: ['local-presets.conf'],
			whitelistPath,
		});

		// Should approve the config file (not return early)
		expect(result.approvedFiles.size).toBe(1);
		expect(result.approvedFiles.has('local-presets.conf')).toBe(true);
	});

	test('verifyFileAgainstWhitelist with isOptional=true does not warn when file is missing', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-verify-file-optional-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
		fs.writeFileSync(
			whitelistPath,
			'missing.conf 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o600);

		const whitelistEntries = new Map([
			[
				'missing.conf',
				'1111111111111111111111111111111111111111111111111111111111111111',
			],
		]);

		const result = verifyFileAgainstWhitelist(
			path.join(pluginsDir, 'missing.conf'),
			'missing.conf',
			'Test warning',
			whitelistEntries,
			whitelistPath,
			undefined,
			true, // isOptional = true
		);

		expect(result.approved).toBe(false);
		expect(result.warnings.length).toBe(0);
	});

	test('verifyFileAgainstWhitelist with isOptional=false warns when file is missing', () => {
		const tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'nest-verify-file-required-'),
		);
		const pluginsDir = path.join(tempDir, 'plugins');
		fs.mkdirSync(pluginsDir, {recursive: true});

		const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
		fs.writeFileSync(
			whitelistPath,
			'missing.conf 1111111111111111111111111111111111111111111111111111111111111111',
		);
		fs.chmodSync(whitelistPath, 0o600);

		const whitelistEntries = new Map([
			[
				'missing.conf',
				'1111111111111111111111111111111111111111111111111111111111111111',
			],
		]);

		const result = verifyFileAgainstWhitelist(
			path.join(pluginsDir, 'missing.conf'),
			'missing.conf',
			'Test warning',
			whitelistEntries,
			whitelistPath,
			undefined,
			false, // isOptional = false
		);

		expect(result.approved).toBe(false);
		expect(result.warnings.length).toBe(1);
		expect(result.warnings[0]).toContain('is missing');
	});
});
