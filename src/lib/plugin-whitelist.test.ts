import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {parsePluginWhitelist, verifyPluginWhitelist} from './plugin-whitelist';

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

	test('warns when a plugin cannot be hashed', () => {
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
		expect(result.warnings[0]).toContain('could not hash');
		expect(result.warnings[0]).toContain('Skipping plugin registration');
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
				statSync: () => ({uid: 1000, mode: 0o100600, isFile: () => true}),
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
			statSync: () => ({uid: 1000, mode: 0o100600, isFile: () => true}),
		}));

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
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain('is new or not whitelisted');
		});

		jest.dontMock('fs');
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
});
