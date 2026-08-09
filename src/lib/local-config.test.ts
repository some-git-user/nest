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
	getConfigFilePath,
	getConfigKeys,
	loadConfigAtStartup,
	lookupConfig,
	parseConfigFile,
	parseConfigLine,
	safeLookupConfig,
	setWhitelistCache,
	setHashFunction,
	resetModuleState,
} = require('./local-config');

// Import the real hash function for resetting
const pluginWhitelist = require('./plugin-whitelist');
const hashPluginFileImpl = pluginWhitelist.hashPluginFile;

describe('local-config', () => {
	beforeEach(() => {
		// Setup test fixtures - ensure parent directory exists first
		fs.mkdirSync(mockPluginsDir, {recursive: true});
		fs.mkdirSync(mockConfigDir, {recursive: true});
	});

	afterEach(() => {
		// Cleanup
		if (fs.existsSync(mockConfigDir)) {
			fs.rmSync(mockConfigDir, {recursive: true, force: true});
		}
		if (fs.existsSync(mockPluginsDir)) {
			fs.rmSync(mockPluginsDir, {recursive: true, force: true});
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
			// Create config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Set mock hash function
			setHashFunction(
				() =>
					'f4571f210b9e74eee59a3e5aa1e9349295ddf9c53812dd5b05b2f84924913514',
			);

			const whitelist = new Map([
				[
					'configs/local-presets.conf',
					'f4571f210b9e74eee59a3e5aa1e9349295ddf9c53812dd5b05b2f84924913514',
				],
			]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			const result1 = parseConfigFile();
			const result2 = parseConfigFile();
			expect(result1).toBe(result2); // Same reference
		});
	});

	describe('lookupConfig', () => {
		beforeEach(() => {
			resetModuleState();
		});

		it('should return config entry for valid key', () => {
			// Create config file
			const configContent = `test=check-test nagiosReturnMessage=Test
test_perfdata=check-test nagiosReturnValue=0`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Set mock hash function
			setHashFunction(
				() =>
					'f4571f210b9e74eee59a3e5aa1e9349295ddf9c53812dd5b05b2f84924913514',
			);

			const whitelist = new Map([
				[
					'configs/local-presets.conf',
					'f4571f210b9e74eee59a3e5aa1e9349295ddf9c53812dd5b05b2f84924913514',
				],
			]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			const result = lookupConfig('test');
			expect(result).toEqual({
				command: 'check-test',
				params: {nagiosReturnMessage: 'Test'},
			});
		});

		afterEach(() => {
			resetModuleState();
		});

		it('should throw error for non-existent key', () => {
			// Create config file
			const configContent = `test=check-test nagiosReturnMessage=Test
test_perfdata=check-test nagiosReturnValue=0`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Set mock hash function
			setHashFunction(
				() =>
					'f4571f210b9e74eee59a3e5aa1e9349295ddf9c53812dd5b05b2f84924913514',
			);

			const whitelist = new Map([
				[
					'configs/local-presets.conf',
					'f4571f210b9e74eee59a3e5aa1e9349295ddf9c53812dd5b05b2f84924913514',
				],
			]);
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

			// Set mock hash function
			setHashFunction(
				() =>
					'e53327d02793bf67c13ed66ffe774a8028c1daba295d418b8e98f8eb31ecb3ec',
			);

			const whitelist = new Map([
				[
					'configs/local-presets.conf',
					'e53327d02793bf67c13ed66ffe774a8028c1daba295d418b8e98f8eb31ecb3ec',
				],
			]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			expect(() => lookupConfig('nonexistent')).toThrow(
				'Config key "nonexistent" not found. Available keys: test, test2',
			);
		});

		it('should throw error with no config file message when file does not exist', () => {
			// Ensure file doesn't exist
			fs.rmSync(mockConfigPath, {force: true});

			// Set mock hash function for empty file
			setHashFunction(
				() =>
					'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			);

			const whitelist = new Map([
				[
					'configs/local-presets.conf',
					'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
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

			// Set mock hash function
			setHashFunction(
				() =>
					'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			);

			const whitelist = new Map([
				[
					'configs/local-presets.conf',
					'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				],
			]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			expect(() => lookupConfig('nonexistent')).toThrow(
				'Config key "nonexistent" not found. No local config presets available',
			);
		});
	});

	describe('safeLookupConfig', () => {
		beforeEach(() => {
			resetModuleState();
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			// Use empty whitelist - no hash validation for happy path tests
			setWhitelistCache(new Map());
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
	});

	describe('configKeyExists', () => {
		beforeEach(() => {
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);
			// Set whitelist cache and load config for tests
			setWhitelistCache(new Map());
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
			jest.isolateModules(() => {
				const mockFs = {
					readFileSync: jest.fn(() => {
						throw new Error('Failed to read config file');
					}),
					existsSync: jest.fn(() => true),
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
					configKeyExists: configKeyExistsMocked,
					loadConfigAtStartup: loadConfigAtStartupMocked,
					setWhitelistCache: setWhitelistCacheMocked,
				} = require('./local-config');

				setWhitelistCacheMocked(new Map());
				loadConfigAtStartupMocked();

				expect(configKeyExistsMocked('test')).toBe(false);
			});
		});
	});

	describe('getConfigKeys', () => {
		beforeEach(() => {
			resetModuleState();
			const configContent = `test=check-test
test_perfdata=check-test
debian_eol=check-debian-eol`;
			fs.writeFileSync(mockConfigPath, configContent);
		});

		afterEach(() => {
			resetModuleState();
		});

		it('should return all config keys', () => {
			// Set mock hash function
			setHashFunction(
				() =>
					'f2a7ea5edb24913819489fe2a84333c5aa72c4cea87cc08cf25f1716c1f02b93',
			);

			const whitelist = new Map([
				[
					'configs/local-presets.conf',
					'f2a7ea5edb24913819489fe2a84333c5aa72c4cea87cc08cf25f1716c1f02b93',
				],
			]);
			setWhitelistCache(whitelist);
			loadConfigAtStartup();

			const keys = getConfigKeys();
			expect(keys).toEqual(['test', 'test_perfdata', 'debian_eol']);
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
			// Need to reset modules to get fresh instance
			jest.resetModules();
			fs.rmSync(mockConfigPath, {force: true});

			const {getConfigKeys: getConfigKeysFresh} = require('./local-config');
			const {
				setWhitelistCache: setWhitelistCacheFresh,
			} = require('./local-config');
			const {
				loadConfigAtStartup: loadConfigAtStartupFresh,
			} = require('./local-config');

			setWhitelistCacheFresh(new Map());
			loadConfigAtStartupFresh();

			const keys = getConfigKeysFresh();
			expect(keys).toEqual([]);
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

		it('should load config when file is not in whitelist (no hash check)', () => {
			// Create actual config file
			const configContent = `test=check-test`;
			fs.writeFileSync(mockConfigPath, configContent);

			const {
				loadConfigAtStartup,
				setWhitelistCache,
				hasRuntimeValidationFailed,
			} = require('./local-config');

			// Create whitelist without the config file (so no hash check is performed)
			const whitelist = new Map([['other-file.txt', 'somehash']]);
			setWhitelistCache(whitelist);

			loadConfigAtStartup();

			expect(hasRuntimeValidationFailed()).toBe(false);
		});
	});
});
