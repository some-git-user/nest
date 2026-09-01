import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Mock env module before importing local-config
const mockPluginsDir = path.join(__dirname, '../../test/fixtures/plugins');
const mockConfigDir = path.join(mockPluginsDir, 'configs');
const mockConfigPath = path.join(mockConfigDir, 'local-presets.conf');

jest.mock('../config/env', () => ({
	env: {
		PLUGINS_DIR: mockPluginsDir,
	},
}));

// Import after mock
const {
	configKeyExists,
	getConfigDrift,
	getConfigFilePath,
	getConfigKeys,
	getApprovedConfigContent,
	loadConfigAtStartup,
	lookupConfig,
	parseConfigFile,
	parseConfigLine,
	safeLookupConfig,
	setWhitelistCache,
	setHashFunction,
	setCheckConfigFileSecurityFn,
	resetModuleState,
	validateConfigFilePath,
	validateConfigFileSecurity,
} = require('./local-config');

describe('local-config', () => {
	beforeEach(() => {
		// Setup test fixtures - ensure parent directory exists first
		fs.mkdirSync(mockPluginsDir, {recursive: true});
		fs.mkdirSync(mockConfigDir, {recursive: true});
	});

	afterEach(() => {
		// Cleanup - remove everything we created
		if (fs.existsSync(mockConfigDir)) {
			fs.rmSync(mockConfigDir, {recursive: true, force: true});
		}
		if (fs.existsSync(mockPluginsDir)) {
			fs.rmSync(mockPluginsDir, {recursive: true, force: true});
		}
		// Remove parent fixtures directory if empty
		const fixturesDir = path.join(__dirname, '../../test/fixtures');
		if (
			fs.existsSync(fixturesDir) &&
			fs.readdirSync(fixturesDir).length === 0
		) {
			fs.rmSync(fixturesDir, {recursive: true, force: true});
		}
	});

	describe('parseConfigLine', () => {
		it('should parse a simple config line with command only', () => {
			const result = parseConfigLine('check-test');
			expect(result).toEqual({
				command: 'check-test',
				params: {},
			});
		});

		it('should parse a config line with command and one parameter', () => {
			const result = parseConfigLine('check-test nagiosReturnMessage=Test');
			expect(result).toEqual({
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test'},
			});
		});

		it('should parse a config line with multiple parameters', () => {
			const result = parseConfigLine(
				'check-test nagiosReturnMessage=Test nagiosReturnValue=0 performanceData=false',
			);
			expect(result).toEqual({
				command: 'check-test',
				params: {
					nagiosReturnMessage: 'Test',
					nagiosReturnValue: '0',
					performanceData: 'false',
				},
			});
		});

		it('should handle URL-encoded values with + signs', () => {
			const result = parseConfigLine(
				'check-test nagiosReturnMessage=Test+message',
			);
			expect(result).toEqual({
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test+message'},
			});
		});

		it('should throw error for empty line', () => {
			expect(() => parseConfigLine('')).toThrow('Empty config line');
		});

		it('should throw error for invalid parameter format', () => {
			expect(() => parseConfigLine('check-test invalidParam')).toThrow(
				'Invalid parameter format',
			);
		});

		it('should throw error for empty parameter key', () => {
			expect(() => parseConfigLine('check-test =value')).toThrow(
				'Empty parameter key',
			);
		});

		it('should throw error for line with only whitespace', () => {
			expect(() => parseConfigLine('   ')).toThrow('Empty config line');
		});

		it('should throw error for line with no command (tokens.length === 0)', () => {
			expect(() => parseConfigLine('')).toThrow('Empty config line');
		});

		it('should fail to load config with duplicate key', () => {
			resetModuleState();
			const configContent = `test=check-test
test=check-dmesg`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Set mock hash function
			setHashFunction(() => 'abc123hash');

			const whitelist = new Map([['configs/local-presets.conf', 'abc123hash']]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			// Validation should fail due to duplicate key
			expect(() => parseConfigFile()).toThrow(
				'Config unavailable - startup loading failed or not completed',
			);
		});

		it('should fail to load config with invalid format (no equals sign)', () => {
			resetModuleState();
			const configContent = `test=check-test
invalidLineWithoutEquals`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Set mock hash function
			setHashFunction(() => 'abc123hash');

			const whitelist = new Map([['configs/local-presets.conf', 'abc123hash']]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			// Validation should fail due to invalid format
			expect(() => parseConfigFile()).toThrow(
				'Config unavailable - startup loading failed or not completed',
			);
		});

		it('should fail to load config with empty key', () => {
			resetModuleState();
			const configContent = `test=check-test
=check-dmesg`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Set mock hash function
			setHashFunction(() => 'abc123hash');

			const whitelist = new Map([['configs/local-presets.conf', 'abc123hash']]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			// Validation should fail due to empty key
			expect(() => parseConfigFile()).toThrow(
				'Config unavailable - startup loading failed or not completed',
			);
		});
	});

	describe('parseConfigFile', () => {
		beforeEach(() => {
			resetModuleState();
			const configContent = `test=check-test nagiosReturnMessage=Test
test_perfdata=check-test nagiosReturnValue=0`;
			fs.writeFileSync(mockConfigPath, configContent);

			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');

			// Set mock hash function to return the correct hash
			setHashFunction(() => configHash);

			// Set whitelist cache and load config for tests
			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);
			// Mock file security check to always pass
			setCheckConfigFileSecurityFn(() => true);
			loadConfigAtStartup();
		});

		it('should return cached config from memory (not re-parse)', () => {
			const result = parseConfigFile();
			expect(result.size).toBe(2);
			expect(result.get('test')).toEqual({
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test'},
			});
			expect(result.get('test_perfdata')).toEqual({
				command: 'check-test',
				params: {nagiosReturnValue: '0'},
			});
		});

		it('should return empty map if config file not found (optional config)', () => {
			jest.isolateModules(() => {
				// Remove config file
				const mockFs = {
					readFileSync: jest.fn(),
					existsSync: jest.fn(() => false),
					mkdirSync: jest.fn(),
					rmSync: jest.fn(),
					writeFileSync: jest.fn(),
				};
				jest.doMock('fs', () => mockFs);

				jest.doMock('../config/env', () => ({
					env: {PLUGINS_DIR: mockPluginsDir},
				}));

				jest.doMock('../lib/logger', () => ({
					logger: {
						error: jest.fn(),
						warn: jest.fn(),
						info: jest.fn(),
						debug: jest.fn(),
					},
				}));

				const {
					parseConfigFile: parseConfigFileFresh,
				} = require('./local-config');
				const {
					setWhitelistCache: setWhitelistCacheFresh,
				} = require('./local-config');
				const {
					loadConfigAtStartup: loadConfigAtStartupFresh,
				} = require('./local-config');

				setWhitelistCacheFresh(new Map());
				loadConfigAtStartupFresh();

				const result = parseConfigFileFresh();
				expect(result.size).toBe(0);
			});
		});

		it('should throw error if startup validation failed', () => {
			// Simulate validation failure
			jest.isolateModules(() => {
				const mockFs = {
					readFileSync: jest.fn(() => {
						throw new Error('Parse error');
					}),
					existsSync: jest.fn(() => true),
					mkdirSync: jest.fn(),
					rmSync: jest.fn(),
					writeFileSync: jest.fn(),
					statSync: jest.fn(() => ({
						mode: 0o100644,
					})),
				};
				jest.doMock('fs', () => mockFs);

				jest.doMock('../config/env', () => ({
					env: {PLUGINS_DIR: mockPluginsDir},
				}));

				jest.doMock('../lib/logger', () => ({
					logger: {
						error: jest.fn(),
						warn: jest.fn(),
						info: jest.fn(),
						debug: jest.fn(),
					},
				}));

				const {
					parseConfigFile: parseConfigFileMocked,
					loadConfigAtStartup: loadConfigAtStartupMocked,
					setWhitelistCache: setWhitelistCacheMocked,
				} = require('./local-config');

				setWhitelistCacheMocked(new Map());
				loadConfigAtStartupMocked();

				expect(() => parseConfigFileMocked()).toThrow(
					'Config unavailable - startup loading failed or not completed',
				);
			});
		});

		it('should return same cached reference on multiple calls (no disk I/O)', () => {
			resetModuleState();
			// Create config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Calculate hash dynamically
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');

			setHashFunction(() => configHash);

			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);
			// Mock file security check to always pass
			setCheckConfigFileSecurityFn(() => true);
			loadConfigAtStartup();

			const result1 = parseConfigFile();
			const result2 = parseConfigFile();
			expect(result1).toBe(result2); // Same reference
		});
	});

	describe('lookupConfig', () => {
		beforeEach(() => {
			resetModuleState();
			// Mock file security check to always pass
			setCheckConfigFileSecurityFn(() => true);
		});

		it('should return config entry for valid key', () => {
			// Create config file
			const configContent = `test=check-test nagiosReturnMessage=Test
test_perfdata=check-test nagiosReturnValue=0`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Calculate hash dynamically
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');

			setHashFunction(() => configHash);

			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			const result = lookupConfig('test');
			expect(result).toEqual({
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test'},
			});
		});

		it('should throw error for non-existent key', () => {
			// Create config file
			const configContent = `test=check-test nagiosReturnMessage=Test
test_perfdata=check-test nagiosReturnValue=0`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Calculate hash dynamically
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');

			setHashFunction(() => configHash);

			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			expect(() => lookupConfig('nonexistent')).toThrow(
				'Config key "nonexistent" not found',
			);
		});

		it('should throw error with available keys when key not found', () => {
			// Create config file
			const configContent = `test=check-test
test2=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Calculate hash dynamically
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');

			setHashFunction(() => configHash);

			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			expect(() => lookupConfig('nonexistent')).toThrow(
				'Config key "nonexistent" not found. Available keys: test, test2',
			);
		});

		it('should throw error with no config file message when file does not exist', () => {
			resetModuleState();
			// Ensure file doesn't exist
			fs.rmSync(mockConfigPath, {force: true});

			// Set mock hash function for empty file
			setHashFunction(() => {
				return crypto.createHash('sha256').update('').digest('hex');
			});

			const whitelist = new Map([
				[
					'configs/local-presets.conf',
					crypto.createHash('sha256').update('').digest('hex'),
				],
			]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			expect(() => lookupConfig('nonexistent')).toThrow(
				'Config key "nonexistent" not found. No local config presets available',
			);
		});

		it('should throw error when startup loading has not completed', () => {
			resetModuleState();

			expect(() => lookupConfig('test')).toThrow(
				'Config unavailable - startup loading failed or not completed',
			);
		});

		it('should throw error when startup validation failed', () => {
			// Create config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Set mock hash function with wrong hash to trigger validation failure
			setHashFunction(() => 'wronghash123');

			const whitelist = new Map([
				['configs/local-presets.conf', 'correcthash456'],
			]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			expect(() => lookupConfig('test')).toThrow(
				'Config unavailable - startup loading failed or not completed',
			);
		});

		it('should throw error with no config presets message when config is empty', () => {
			// Create empty config file
			const configContent = '';
			fs.writeFileSync(mockConfigPath, configContent);

			// Calculate hash dynamically
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');

			setHashFunction(() => configHash);

			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			expect(() => lookupConfig('nonexistent')).toThrow(
				'Config key "nonexistent" not found. No local config presets available',
			);
		});

		afterEach(() => {
			resetModuleState();
		});
	});

	describe('safeLookupConfig', () => {
		beforeEach(() => {
			resetModuleState();
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Calculate hash dynamically
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');

			setHashFunction(() => configHash);
			setWhitelistCache(new Map([['configs/local-presets.conf', configHash]]));
			// Mock file security check to always pass
			setCheckConfigFileSecurityFn(() => true);
			loadConfigAtStartup();
		});

		it('should return undefined when startup loading has not completed', () => {
			resetModuleState();

			expect(safeLookupConfig('test')).toBeUndefined();
		});

		it('should return undefined when startup validation failed', () => {
			resetModuleState();

			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			setHashFunction(() => 'wronghash123');

			const whitelist = new Map([
				['configs/local-presets.conf', 'correcthash456'],
			]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			expect(safeLookupConfig('test')).toBeUndefined();
		});

		it('should return undefined for non-existent key', () => {
			expect(safeLookupConfig('nonexistent')).toBeUndefined();
		});

		it('should return config entry for existing key', () => {
			const result = safeLookupConfig('test');
			expect(result).toBeDefined();
			expect(result?.command).toBe('check-test');
		});

		afterEach(() => {
			resetModuleState();
		});
	});

	describe('configKeyExists', () => {
		beforeEach(() => {
			resetModuleState();
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);
			// Calculate hash dynamically
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');
			setHashFunction(() => configHash);
			setWhitelistCache(new Map([['configs/local-presets.conf', configHash]]));
			// Mock file security check to always pass
			setCheckConfigFileSecurityFn(() => true);
			loadConfigAtStartup();
		});

		it('should return true for existing key', () => {
			expect(configKeyExists('test')).toBe(true);
		});

		it('should return false for non-existent key', () => {
			expect(configKeyExists('nonexistent')).toBe(false);
		});

		it('should return false if config file does not exist', () => {
			jest.resetModules();
			fs.rmSync(mockConfigPath, {force: true});

			const {configKeyExists: configKeyExistsFresh} = require('./local-config');
			const {
				setWhitelistCache: setWhitelistCacheFresh,
			} = require('./local-config');
			const {
				loadConfigAtStartup: loadConfigAtStartupFresh,
			} = require('./local-config');

			setWhitelistCacheFresh(new Map());
			loadConfigAtStartupFresh();

			expect(configKeyExistsFresh('test')).toBe(false);
		});

		it('should return false when startup validation failed', () => {
			resetModuleState();

			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Use wrong hash to trigger validation failure
			setHashFunction(() => 'wronghash123');
			setWhitelistCache(
				new Map([['configs/local-presets.conf', 'correcthash456']]),
			);
			loadConfigAtStartup();

			expect(configKeyExists('test')).toBe(false);
		});

		afterEach(() => {
			resetModuleState();
		});
	});

	describe('getConfigKeys', () => {
		beforeEach(() => {
			resetModuleState();
			const configContent = `test=check-test
test_perfdata=check-test
debian_eol=check-debian-eol`;
			fs.writeFileSync(mockConfigPath, configContent);
			// Mock file security check to always pass
			setCheckConfigFileSecurityFn(() => true);
		});

		afterEach(() => {
			resetModuleState();
		});

		it('should return all config keys', () => {
			// Read file and calculate hash dynamically
			const configContent = fs.readFileSync(mockConfigPath, 'utf-8');
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');

			setHashFunction(() => configHash);

			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			const keys = getConfigKeys();
			expect(keys.sort()).toEqual(
				['debian_eol', 'test', 'test_perfdata'].sort(),
			);
		});

		it('should return empty array when startup validation failed', () => {
			jest.isolateModules(() => {
				const mockFs = {
					readFileSync: jest.fn(() => {
						throw new Error('Failed to read config file');
					}),
					existsSync: jest.fn(() => true),
					mkdirSync: jest.fn(),
					rmSync: jest.fn(),
					writeFileSync: jest.fn(),
					statSync: jest.fn(() => ({
						mode: 0o100644,
					})),
				};
				jest.doMock('fs', () => mockFs);

				jest.doMock('../config/env', () => ({
					env: {PLUGINS_DIR: mockPluginsDir},
				}));

				jest.doMock('../lib/logger', () => ({
					logger: {
						error: jest.fn(),
						warn: jest.fn(),
						info: jest.fn(),
						debug: jest.fn(),
					},
				}));

				const {
					getConfigKeys: getConfigKeysMocked,
					loadConfigAtStartup: loadConfigAtStartupMocked,
					setWhitelistCache: setWhitelistCacheMocked,
				} = require('./local-config');

				setWhitelistCacheMocked(new Map());
				loadConfigAtStartupMocked();

				const keys = getConfigKeysMocked();
				expect(keys).toEqual([]);
			});
		});

		it('should return empty array if config file does not exist', () => {
			resetModuleState();
			// Ensure file doesn't exist
			fs.rmSync(mockConfigPath, {force: true});

			setWhitelistCache(new Map());
			loadConfigAtStartup();

			const keys = getConfigKeys();
			expect(keys).toEqual([]);
		});

		it('should return empty array when config file exists but is not whitelisted', () => {
			resetModuleState();

			// Create config file
			fs.writeFileSync(mockConfigPath, 'test=check-test');

			// Set mock hash function
			setHashFunction(() => 'somehash');

			// Empty whitelist - file exists but not whitelisted
			setWhitelistCache(new Map());
			loadConfigAtStartup();

			const keys = getConfigKeys();
			expect(keys).toEqual([]);
		});

		it('should return empty array when startup validation failed', () => {
			resetModuleState();

			// Create config file
			fs.writeFileSync(mockConfigPath, 'test=check-test');

			// Set wrong hash to trigger validation failure
			setHashFunction(() => 'wronghash');
			setWhitelistCache(
				new Map([['configs/local-presets.conf', 'correcthash']]),
			);
			loadConfigAtStartup();

			const keys = getConfigKeys();
			expect(keys).toEqual([]);
		});
	});

	describe('getConfigFilePath', () => {
		it('should return correct path based on PLUGINS_DIR', () => {
			process.env.NEST_PLUGINS_DIR = mockPluginsDir;
			const expectedPath = path.join(
				mockPluginsDir,
				'configs',
				'local-presets.conf',
			);
			expect(getConfigFilePath()).toBe(expectedPath);
		});
	});

	describe('loadConfigAtStartup', () => {
		beforeEach(() => {
			jest.resetModules();
		});

		it('should fail secure when whitelist cache is not populated', () => {
			// Mock fs
			const mockFs = {
				readFileSync: jest.fn(),
				existsSync: jest.fn(),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn(() => ({
					mode: 0o100644,
				})),
			};
			jest.doMock('fs', () => mockFs);

			// Mock env
			jest.doMock('../config/env', () => ({
				env: {PLUGINS_DIR: mockPluginsDir},
			}));

			// Mock logger
			const mockLogger = {
				error: jest.fn(),
				warn: jest.fn(),
				info: jest.fn(),
				debug: jest.fn(),
			};
			jest.doMock('../lib/logger', () => ({
				logger: mockLogger,
			}));

			const {
				loadConfigAtStartup,
				hasRuntimeValidationFailed,
			} = require('./local-config');

			// Don't call setWhitelistCache - simulate bug scenario
			loadConfigAtStartup();

			expect(mockLogger.error).toHaveBeenCalledWith(
				'Whitelist cache not populated before config validation - this is a bug',
			);
			expect(hasRuntimeValidationFailed()).toBe(true);
		});

		it('should load config successfully when whitelist cache is set and hash matches', () => {
			// Create actual config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Mock plugin-whitelist to return a fixed hash
			const mockHash = 'abc123';
			jest.doMock('./plugin-whitelist', () => ({
				hashPluginFile: jest.fn(() => mockHash),
			}));

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				hasRuntimeValidationFailed,
			} = require('./local-config');

			// Create whitelist with correct hash
			const whitelist = new Map([['configs/local-presets.conf', mockHash]]);
			setWhitelistCache(whitelist);

			loadConfigAtStartup();

			expect(hasRuntimeValidationFailed()).toBe(false);
		});

		it('should fail validation when config hash does not match whitelist', () => {
			// Mock fs
			const mockFs = {
				readFileSync: jest.fn(),
				existsSync: jest.fn(() => true),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn(() => ({
					mode: 0o100644,
				})),
			};
			jest.doMock('fs', () => mockFs);

			// Mock env
			jest.doMock('../config/env', () => ({
				env: {PLUGINS_DIR: mockPluginsDir},
			}));

			// Mock logger
			const mockLogger = {
				error: jest.fn(),
				warn: jest.fn(),
				info: jest.fn(),
				debug: jest.fn(),
			};
			jest.doMock('../lib/logger', () => ({
				logger: mockLogger,
			}));

			// Mock plugin-whitelist to return a different hash
			const mockHash = 'currenthash123';
			jest.doMock('./plugin-whitelist', () => ({
				hashPluginFile: jest.fn(() => mockHash),
			}));

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				hasRuntimeValidationFailed,
			} = require('./local-config');

			// Create whitelist with wrong hash
			const wrongHash = 'wronghash123';
			const whitelist = new Map([['configs/local-presets.conf', wrongHash]]);
			setWhitelistCache(whitelist);

			loadConfigAtStartup();

			expect(mockLogger.warn).toHaveBeenCalled();
			expect(hasRuntimeValidationFailed()).toBe(true);
		});

		it('should load empty config when config file does not exist', () => {
			// Mock fs
			const mockFs = {
				readFileSync: jest.fn(),
				existsSync: jest.fn(() => false),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn(() => ({
					mode: 0o100644,
				})),
			};
			jest.doMock('fs', () => mockFs);

			// Mock env
			jest.doMock('../config/env', () => ({
				env: {PLUGINS_DIR: mockPluginsDir},
			}));

			// Mock logger
			jest.doMock('../lib/logger', () => ({
				logger: {
					error: jest.fn(),
					warn: jest.fn(),
					info: jest.fn(),
					debug: jest.fn(),
				},
			}));

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				hasRuntimeValidationFailed,
				parseConfigFile,
			} = require('./local-config');

			// Don't create config file
			const whitelist = new Map();
			setWhitelistCache(whitelist);

			loadConfigAtStartup();

			expect(hasRuntimeValidationFailed()).toBe(false);
		});

		describe('validateConfigFilePath', () => {
			it('should throw on path traversal sequences', () => {
				expect(() =>
					validateConfigFilePath('/etc/nest/../../evil.conf'),
				).toThrow(/path traversal/i);
			});

			it('should throw when path is not in allowed directory', () => {
				expect(() => validateConfigFilePath('/tmp/outside.conf')).toThrow(
					/not in allowed directory/i,
				);
			});

			it('should accept a valid path inside the plugins directory', () => {
				const validPath = path.join(
					mockPluginsDir,
					'configs',
					'local-presets.conf',
				);
				expect(() => validateConfigFilePath(validPath)).not.toThrow();
			});
		});

		describe('validateConfigFileSecurity', () => {
			it('should throw when path is not a regular file', () => {
				// mockPluginsDir is a directory, not a regular file
				expect(() => validateConfigFileSecurity(mockPluginsDir)).toThrow(
					/not a regular file/i,
				);
			});

			it('should throw when file exceeds maximum size limit', () => {
				// Write a file larger than 100KB
				fs.writeFileSync(mockConfigPath, 'x'.repeat(200 * 1024));
				expect(() => validateConfigFileSecurity(mockConfigPath)).toThrow(
					/maximum size/i,
				);
			});

			it('should accept a regular file within the size limit', () => {
				fs.writeFileSync(mockConfigPath, 'test=check-test\n');
				expect(() => validateConfigFileSecurity(mockConfigPath)).not.toThrow();
			});
		});

		it('should fail validation when config file exists but is not in whitelist', () => {
			// Create actual config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Mock fs so existsSync returns true (file exists)
			const mockFs = {
				readFileSync: jest.fn(() => configContent),
				existsSync: jest.fn(() => true),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn(() => ({
					mode: 0o100644,
				})),
			};
			jest.doMock('fs', () => mockFs);

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				hasRuntimeValidationFailed,
			} = require('./local-config');

			// Create whitelist without the config file (file is not whitelisted)
			const whitelist = new Map([['other-file.txt', 'somehash']]);
			setWhitelistCache(whitelist);

			loadConfigAtStartup();

			expect(hasRuntimeValidationFailed()).toBe(true);
		});

		it('should fail validation when config file security check fails (statSync throws)', () => {
			jest.isolateModules(() => {
				// Create actual config file
				const configContent = `test=check-test`;
				fs.writeFileSync(mockConfigPath, configContent);

				// Mock fs - statSync should return valid mode for the warning message
				const mockFs = {
					readFileSync: jest.fn(() => configContent),
					existsSync: jest.fn(() => true),
					mkdirSync: jest.fn(),
					rmSync: jest.fn(),
					writeFileSync: jest.fn(),
					statSync: jest.fn(() => ({
						mode: 0o100644,
					})),
				};
				jest.doMock('fs', () => mockFs);

				// Mock env
				jest.doMock('../config/env', () => ({
					env: {PLUGINS_DIR: mockPluginsDir},
				}));

				// Mock logger
				const mockLogger = {
					error: jest.fn(),
					warn: jest.fn(),
					info: jest.fn(),
					debug: jest.fn(),
				};
				jest.doMock('../lib/logger', () => ({
					logger: mockLogger,
				}));

				const {
					loadConfigAtStartup,
					setWhitelistCache,
					hasRuntimeValidationFailed,
					setCheckConfigFileSecurityFn,
				} = require('./local-config');

				// Set correct hash
				const configHash = crypto
					.createHash('sha256')
					.update(configContent)
					.digest('hex');

				const whitelist = new Map([['configs/local-presets.conf', configHash]]);
				setWhitelistCache(whitelist);

				// Mock security check to fail (return false)
				setCheckConfigFileSecurityFn(() => false);

				loadConfigAtStartup();

				expect(mockLogger.warn).toHaveBeenCalledWith(
					expect.stringContaining('has insecure permissions'),
				);
				expect(hasRuntimeValidationFailed()).toBe(true);
			});
		});

		it('should handle parse error with invalid format (no equals sign)', () => {
			jest.isolateModules(() => {
				// Mock fs with proper isFile method and invalid content
				const configContent = `test=check-test
invalidLineWithoutEquals`;
				const mockFs = {
					readFileSync: jest.fn(() => configContent),
					existsSync: jest.fn(() => true),
					mkdirSync: jest.fn(),
					rmSync: jest.fn(),
					writeFileSync: jest.fn(),
					statSync: jest.fn(() => ({
						mode: 0o100644,
						size: configContent.length,
						isFile: () => true,
						uid: process.getuid?.() ?? 0,
					})),
				};
				jest.doMock('fs', () => mockFs);

				// Mock env
				jest.doMock('../config/env', () => ({
					env: {PLUGINS_DIR: mockPluginsDir},
				}));

				// Mock logger
				const mockLogger = {
					error: jest.fn(),
					warn: jest.fn(),
					info: jest.fn(),
					debug: jest.fn(),
				};
				jest.doMock('../lib/logger', () => ({
					logger: mockLogger,
				}));

				// Set correct hash
				const configHash = crypto
					.createHash('sha256')
					.update(configContent)
					.digest('hex');

				// Mock plugin-whitelist to return the correct hash
				jest.doMock('./plugin-whitelist', () => ({
					hashPluginFile: jest.fn(() => configHash),
				}));

				const {
					loadConfigAtStartup,
					setWhitelistCache,
					hasRuntimeValidationFailed,
					setCheckConfigFileSecurityFn,
				} = require('./local-config');

				const whitelist = new Map([['configs/local-presets.conf', configHash]]);
				setWhitelistCache(whitelist);

				// Mock security check to pass
				setCheckConfigFileSecurityFn(() => true);

				loadConfigAtStartup();

				expect(mockLogger.error).toHaveBeenCalledWith(
					expect.stringContaining('Failed to parse config file'),
				);
				expect(hasRuntimeValidationFailed()).toBe(true);
			});
		});

		it('should handle parse error with empty key', () => {
			jest.isolateModules(() => {
				// Mock fs with proper isFile method and invalid content
				const configContent = `test=check-test
=emptyKey`;
				const mockFs = {
					readFileSync: jest.fn(() => configContent),
					existsSync: jest.fn(() => true),
					mkdirSync: jest.fn(),
					rmSync: jest.fn(),
					writeFileSync: jest.fn(),
					statSync: jest.fn(() => ({
						mode: 0o100644,
						size: configContent.length,
						isFile: () => true,
						uid: process.getuid?.() ?? 0,
					})),
				};
				jest.doMock('fs', () => mockFs);

				// Mock env
				jest.doMock('../config/env', () => ({
					env: {PLUGINS_DIR: mockPluginsDir},
				}));

				// Mock logger
				const mockLogger = {
					error: jest.fn(),
					warn: jest.fn(),
					info: jest.fn(),
					debug: jest.fn(),
				};
				jest.doMock('../lib/logger', () => ({
					logger: mockLogger,
				}));

				// Set correct hash
				const configHash = crypto
					.createHash('sha256')
					.update(configContent)
					.digest('hex');

				// Mock plugin-whitelist to return the correct hash
				jest.doMock('./plugin-whitelist', () => ({
					hashPluginFile: jest.fn(() => configHash),
				}));

				const {
					loadConfigAtStartup,
					setWhitelistCache,
					hasRuntimeValidationFailed,
					setCheckConfigFileSecurityFn,
				} = require('./local-config');

				const whitelist = new Map([['configs/local-presets.conf', configHash]]);
				setWhitelistCache(whitelist);

				// Mock security check to pass
				setCheckConfigFileSecurityFn(() => true);

				loadConfigAtStartup();

				expect(mockLogger.error).toHaveBeenCalledWith(
					expect.stringContaining('Failed to parse config file'),
				);
				expect(hasRuntimeValidationFailed()).toBe(true);
			});
		});

		it('should handle parse error with duplicate key', () => {
			jest.isolateModules(() => {
				// Mock fs with proper isFile method and invalid content
				const configContent = `test=check-test
test=duplicate`;
				const mockFs = {
					readFileSync: jest.fn(() => configContent),
					existsSync: jest.fn(() => true),
					mkdirSync: jest.fn(),
					rmSync: jest.fn(),
					writeFileSync: jest.fn(),
					statSync: jest.fn(() => ({
						mode: 0o100644,
						size: configContent.length,
						isFile: () => true,
						uid: process.getuid?.() ?? 0,
					})),
				};
				jest.doMock('fs', () => mockFs);

				// Mock env
				jest.doMock('../config/env', () => ({
					env: {PLUGINS_DIR: mockPluginsDir},
				}));

				// Mock logger
				const mockLogger = {
					error: jest.fn(),
					warn: jest.fn(),
					info: jest.fn(),
					debug: jest.fn(),
				};
				jest.doMock('../lib/logger', () => ({
					logger: mockLogger,
				}));

				// Set correct hash
				const configHash = crypto
					.createHash('sha256')
					.update(configContent)
					.digest('hex');

				// Mock plugin-whitelist to return the correct hash
				jest.doMock('./plugin-whitelist', () => ({
					hashPluginFile: jest.fn(() => configHash),
				}));

				const {
					loadConfigAtStartup,
					setWhitelistCache,
					hasRuntimeValidationFailed,
					setCheckConfigFileSecurityFn,
				} = require('./local-config');

				const whitelist = new Map([['configs/local-presets.conf', configHash]]);
				setWhitelistCache(whitelist);

				// Mock security check to pass
				setCheckConfigFileSecurityFn(() => true);

				loadConfigAtStartup();

				expect(mockLogger.error).toHaveBeenCalledWith(
					expect.stringContaining('Failed to parse config file'),
				);
				expect(hasRuntimeValidationFailed()).toBe(true);
			});
		});

		it('should log specific hash mismatch warning message', () => {
			// Create actual config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Mock fs
			const mockFs = {
				readFileSync: jest.fn(() => configContent),
				existsSync: jest.fn(() => true),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn(() => ({
					mode: 0o100644,
				})),
			};
			jest.doMock('fs', () => mockFs);

			// Mock env
			jest.doMock('../config/env', () => ({
				env: {PLUGINS_DIR: mockPluginsDir},
			}));

			// Mock logger
			const mockLogger = {
				error: jest.fn(),
				warn: jest.fn(),
				info: jest.fn(),
				debug: jest.fn(),
			};
			jest.doMock('../lib/logger', () => ({
				logger: mockLogger,
			}));

			// Mock plugin-whitelist to return current hash
			const currentHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');
			jest.doMock('./plugin-whitelist', () => ({
				hashPluginFile: jest.fn(() => currentHash),
			}));

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				setCheckConfigFileSecurityFn,
			} = require('./local-config');

			// Set whitelist with different hash
			const approvedHash = 'approvedHash123';
			const whitelist = new Map([['configs/local-presets.conf', approvedHash]]);
			setWhitelistCache(whitelist);

			// Mock security check to pass
			setCheckConfigFileSecurityFn(() => true);

			loadConfigAtStartup();

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining(
					`Whitelist expects ${approvedHash}, current sha256 is ${currentHash}`,
				),
			);
		});

		it('should log specific not whitelisted warning message', () => {
			// Create actual config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Mock fs
			const mockFs = {
				readFileSync: jest.fn(() => configContent),
				existsSync: jest.fn(() => true),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn(() => ({
					mode: 0o100644,
				})),
			};
			jest.doMock('fs', () => mockFs);

			// Mock env
			jest.doMock('../config/env', () => ({
				env: {PLUGINS_DIR: mockPluginsDir},
			}));

			// Mock logger
			const mockLogger = {
				error: jest.fn(),
				warn: jest.fn(),
				info: jest.fn(),
				debug: jest.fn(),
			};
			jest.doMock('../lib/logger', () => ({
				logger: mockLogger,
			}));

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				setCheckConfigFileSecurityFn,
			} = require('./local-config');

			// Set whitelist without this config file
			const whitelist = new Map([['other-config.conf', 'somehash']]);
			setWhitelistCache(whitelist);

			// Mock security check to pass
			setCheckConfigFileSecurityFn(() => true);

			loadConfigAtStartup();

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining(
					`Config file configs/local-presets.conf is not whitelisted`,
				),
			);
		});

		it('should handle double-loading gracefully (prevent duplicate execution)', () => {
			// Create actual config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Mock fs
			const mockFs = {
				readFileSync: jest.fn(() => configContent),
				existsSync: jest.fn(() => true),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn(() => ({
					mode: 0o100644,
					size: configContent.length,
					isFile: () => true,
					uid: process.getuid?.() ?? 0,
				})),
			};
			jest.doMock('fs', () => mockFs);

			// Mock env
			jest.doMock('../config/env', () => ({
				env: {PLUGINS_DIR: mockPluginsDir},
			}));

			// Mock logger
			const mockLogger = {
				error: jest.fn(),
				warn: jest.fn(),
				info: jest.fn(),
				debug: jest.fn(),
			};
			jest.doMock('../lib/logger', () => ({
				logger: mockLogger,
			}));

			// Mock plugin-whitelist
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');
			jest.doMock('./plugin-whitelist', () => ({
				hashPluginFile: jest.fn(() => configHash),
			}));

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				setCheckConfigFileSecurityFn,
				resetModuleState,
			} = require('./local-config');

			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);
			setCheckConfigFileSecurityFn(() => true);

			// Call twice - second call should be a no-op
			loadConfigAtStartup();
			loadConfigAtStartup();

			// Should not throw or error on second call
			expect(mockLogger.error).not.toHaveBeenCalled();
			expect(mockLogger.warn).not.toHaveBeenCalled();

			// Reset module state
			resetModuleState();
		});

		it('should handle statSync error in default checkConfigFileSecurityFn (line 24)', () => {
			// Create actual config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Mock fs - statSync throws on first call (inside checkConfigFileSecurityFn), returns valid on second (line 304)
			const mockStats = {
				isFile: jest.fn(() => true),
				mode: 0o644,
				uid: 1000,
			};
			let statCallCount = 0;
			const mockFs = {
				readFileSync: jest.fn(() => configContent),
				existsSync: jest.fn(() => true),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn((filePath: string) => {
					statCallCount++;
					// First call (inside checkConfigFileSecurityFn) throws to test line 24
					if (statCallCount === 1) {
						throw new Error('stat error');
					}
					// Second call (line 304) returns valid stats
					return mockStats;
				}),
			};
			jest.doMock('fs', () => mockFs);

			// Mock env
			jest.doMock('../config/env', () => ({
				env: {PLUGINS_DIR: mockPluginsDir},
			}));

			// Mock logger
			const mockLogger = {
				error: jest.fn(),
				warn: jest.fn(),
				info: jest.fn(),
				debug: jest.fn(),
			};
			jest.doMock('../lib/logger', () => ({
				logger: mockLogger,
			}));

			// Mock plugin-whitelist
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');
			jest.doMock('./plugin-whitelist', () => ({
				hashPluginFile: jest.fn(() => configHash),
			}));

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				hasRuntimeValidationFailed,
				resetModuleState,
			} = require('./local-config');

			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);

			// Use default checkConfigFileSecurityFn (not overridden)
			loadConfigAtStartup();

			// Should fail validation due to stat error
			expect(hasRuntimeValidationFailed()).toBe(true);

			// Reset module state
			resetModuleState();
		});

		it('should handle statSync error in resetModuleState default function (line 59)', () => {
			// Mock fs - statSync throws error
			const mockStats = {
				isFile: jest.fn(() => true),
				mode: 0o644,
				uid: 1000,
			};
			let statCallCount = 0;
			const mockFs = {
				readFileSync: jest.fn(() => 'test=check-test'),
				existsSync: jest.fn(() => true),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn((filePath: string) => {
					statCallCount++;
					// First call (inside checkConfigFileSecurityFn after reset) throws to test line 59
					if (statCallCount === 1) {
						throw new Error('stat error');
					}
					// Subsequent calls return valid stats
					return mockStats;
				}),
			};
			jest.doMock('fs', () => mockFs);

			// Mock env
			jest.doMock('../config/env', () => ({
				env: {PLUGINS_DIR: mockPluginsDir},
			}));

			// Mock logger
			const mockLogger = {
				error: jest.fn(),
				warn: jest.fn(),
				info: jest.fn(),
				debug: jest.fn(),
			};
			jest.doMock('../lib/logger', () => ({
				logger: mockLogger,
			}));

			// Mock plugin-whitelist
			jest.doMock('./plugin-whitelist', () => ({
				hashPluginFile: jest.fn(() => 'testhash'),
			}));

			const {
				resetModuleState,
				loadConfigAtStartup,
				setWhitelistCache,
				hasRuntimeValidationFailed,
			} = require('./local-config');

			// Reset module state to set default checkConfigFileSecurityFn
			resetModuleState();

			// Set whitelist cache
			const whitelist = new Map([['configs/local-presets.conf', 'testhash']]);
			setWhitelistCache(whitelist);

			// Call loadConfigAtStartup - this will use the default function from resetModuleState
			// which should catch the stat error at line 59 and return false
			loadConfigAtStartup();

			// Should fail validation due to stat error caught in line 59
			expect(hasRuntimeValidationFailed()).toBe(true);
		});

		it('should handle when process.getuid is not available (lines 301-302)', () => {
			// Create actual config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Mock fs
			const mockStats = {
				isFile: jest.fn(() => true),
				mode: 0o644,
				uid: 1000,
			};
			const mockFs = {
				readFileSync: jest.fn(() => configContent),
				existsSync: jest.fn(() => true),
				mkdirSync: jest.fn(),
				rmSync: jest.fn(),
				writeFileSync: jest.fn(),
				statSync: jest.fn(() => mockStats),
			};
			jest.doMock('fs', () => mockFs);

			// Mock env
			jest.doMock('../config/env', () => ({
				env: {PLUGINS_DIR: mockPluginsDir},
			}));

			// Mock logger
			const mockLogger = {
				error: jest.fn(),
				warn: jest.fn(),
				info: jest.fn(),
				debug: jest.fn(),
			};
			jest.doMock('../lib/logger', () => ({
				logger: mockLogger,
			}));

			// Mock plugin-whitelist
			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');
			jest.doMock('./plugin-whitelist', () => ({
				hashPluginFile: jest.fn(() => configHash),
			}));

			// Mock process.getuid to be undefined (not a function)
			const originalGetuid = process.getuid;
			process.getuid = undefined as any;

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				hasRuntimeValidationFailed,
				resetModuleState,
			} = require('./local-config');

			const whitelist = new Map([['configs/local-presets.conf', configHash]]);
			setWhitelistCache(whitelist);

			// Should load successfully without checking uid when getuid is not available
			loadConfigAtStartup();

			// Should succeed since uid check is skipped
			expect(hasRuntimeValidationFailed()).toBe(false);

			// Restore original getuid
			process.getuid = originalGetuid;

			// Reset module state
			resetModuleState();
		});
	});

	describe('getConfigDrift', () => {
		afterEach(() => {
			resetModuleState();
		});

		it('reports no drift when the file is missing and nothing is approved', () => {
			setWhitelistCache(new Map());
			setHashFunction(() => 'unused');

			const status = getConfigDrift();

			expect(status).toEqual({
				approvedHash: undefined,
				currentHash: undefined,
				drifted: false,
			});
		});

		it('reports drift when the file is missing but a hash is approved', () => {
			setWhitelistCache(
				new Map([['configs/local-presets.conf', 'approved-hash']]),
			);
			setHashFunction(() => 'unused');

			const status = getConfigDrift();

			expect(status).toEqual({
				approvedHash: 'approved-hash',
				currentHash: undefined,
				drifted: true,
			});
		});

		it('reports no drift when the on-disk hash matches the approved hash', () => {
			fs.writeFileSync(mockConfigPath, 'test=check-test');
			setWhitelistCache(new Map([['configs/local-presets.conf', 'same-hash']]));
			setHashFunction(() => 'same-hash');

			const status = getConfigDrift();

			expect(status).toEqual({
				approvedHash: 'same-hash',
				currentHash: 'same-hash',
				drifted: false,
			});
		});

		it('reports drift when the on-disk hash differs from the approved hash', () => {
			fs.writeFileSync(mockConfigPath, 'test=check-test');
			setWhitelistCache(
				new Map([['configs/local-presets.conf', 'approved-hash']]),
			);
			setHashFunction(() => 'current-hash');

			const status = getConfigDrift();

			expect(status).toEqual({
				approvedHash: 'approved-hash',
				currentHash: 'current-hash',
				drifted: true,
			});
		});
	});

	describe('getApprovedConfigContent', () => {
		afterEach(() => {
			resetModuleState();
		});

		it('returns null before an approved file has been loaded', () => {
			resetModuleState();

			expect(getApprovedConfigContent()).toBeNull();
		});

		it('captures the exact bytes when startup loads an approved file', () => {
			const configContent = 'test=check-test';
			fs.writeFileSync(mockConfigPath, configContent);

			const configHash = crypto
				.createHash('sha256')
				.update(configContent)
				.digest('hex');
			jest.resetModules();
			jest.doMock('./plugin-whitelist', () => ({
				hashPluginFile: jest.fn(() => configHash),
			}));

			const fresh = require('./local-config');
			fresh.setWhitelistCache(
				new Map([['configs/local-presets.conf', configHash]]),
			);
			fresh.loadConfigAtStartup();

			expect(fresh.getApprovedConfigContent()).toBe(configContent);

			fresh.resetModuleState();
			jest.resetModules();
		});
	});
});
