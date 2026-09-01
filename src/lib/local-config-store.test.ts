import * as crypto from 'crypto';
import * as fs from 'fs';
import {getErrorMessage} from './error-message';
import {getConfigFilePath, validateConfigFilePath} from './local-config';
import {
	MAX_CONFIG_DOCUMENT_BYTES,
	type PresetEntry,
	buildConfigLine,
	hashConfigContent,
	isSecretParamName,
	mergeMaskedParams,
	parseConfigDocument,
	readConfigDocument,
	serializeConfigDocument,
	validateCommand,
	validateConfigKey,
	validateParamKey,
	validateParamValue,
	validatePresetEntry,
	writeConfigDocument,
} from './local-config-store';
import {logger} from './logger';

jest.mock('fs');
jest.mock('./local-config');
jest.mock('./logger');

const mockedGetConfigFilePath = jest.mocked(getConfigFilePath);
const mockedValidateConfigFilePath = jest.mocked(validateConfigFilePath);
const mockedFs = jest.mocked(fs);
const mockedLoggerWarn = jest.mocked(logger.warn);

const CONFIG_PATH = '/etc/nest/plugins/configs/local-presets.conf';

describe('local-config-store', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedGetConfigFilePath.mockReturnValue(CONFIG_PATH);
		// validateConfigFilePath is a void guard; default mock does nothing,
		// which means "path is safe".
	});

	describe('hashConfigContent', () => {
		it('produces a sha256 hex digest of the content', () => {
			const expected = crypto
				.createHash('sha256')
				.update('content', 'utf8')
				.digest('hex');
			expect(hashConfigContent('content')).toBe(expected);
		});

		it('is stable across calls', () => {
			expect(hashConfigContent('a')).toBe(hashConfigContent('a'));
		});

		it('differs for different content', () => {
			expect(hashConfigContent('a')).not.toBe(hashConfigContent('b'));
		});
	});

	describe('validateConfigKey', () => {
		it('accepts a valid key', () => {
			expect(validateConfigKey('check_disk')).toBeUndefined();
		});

		it('rejects an empty key', () => {
			expect(validateConfigKey('')).toBe('Config key must not be empty');
		});

		it('rejects a key that is too long', () => {
			const longKey = 'a'.repeat(129);
			expect(validateConfigKey(longKey)).toBe(
				'Config key must be at most 128 characters',
			);
		});

		it('rejects a key with invalid characters', () => {
			expect(validateConfigKey('bad key')).toBe(
				'Config key may only contain letters, digits, underscore and hyphen',
			);
		});
	});

	describe('validateCommand', () => {
		it('accepts a valid command', () => {
			expect(validateCommand('check_disk')).toBeUndefined();
		});

		it('rejects an empty command', () => {
			expect(validateCommand('')).toBe('Plugin command must not be empty');
		});

		it('rejects a command with invalid characters', () => {
			expect(validateCommand('check disk')).toBe(
				'Plugin command may only contain letters, digits, underscore and hyphen',
			);
		});
	});

	describe('validateParamKey', () => {
		it('accepts a valid param key', () => {
			expect(validateParamKey('warn.80')).toBeUndefined();
		});

		it('rejects an empty param key', () => {
			expect(validateParamKey('')).toBe('Parameter name must not be empty');
		});

		it('rejects a param key with invalid characters', () => {
			expect(validateParamKey('bad key')).toBe(
				'Invalid parameter name "bad key". Use letters, digits, underscore, dot and hyphen.',
			);
		});
	});

	describe('validateParamValue', () => {
		it('accepts a value with a + escape', () => {
			expect(validateParamValue('msg', 'Test+message')).toBeUndefined();
		});

		it('rejects a value containing whitespace', () => {
			expect(validateParamValue('msg', 'has space')).toBe(
				'Parameter "msg" may not contain whitespace or "#". Use "+" for spaces.',
			);
		});

		it('rejects a value containing a hash', () => {
			expect(validateParamValue('msg', 'has#hash')).toBe(
				'Parameter "msg" may not contain whitespace or "#". Use "+" for spaces.',
			);
		});
	});

	describe('validatePresetEntry', () => {
		it('returns no problems for a valid entry', () => {
			const entry: PresetEntry = {
				key: 'check_disk',
				command: 'check_disk',
				params: {warn: '80', crit: '90'},
			};
			expect(validatePresetEntry(entry)).toEqual([]);
		});

		it('collects a key problem', () => {
			const entry: PresetEntry = {
				key: '',
				command: 'check_disk',
				params: {},
			};
			expect(validatePresetEntry(entry)).toEqual([
				'Config key must not be empty',
			]);
		});

		it('collects a command problem', () => {
			const entry: PresetEntry = {
				key: 'check_disk',
				command: '',
				params: {},
			};
			expect(validatePresetEntry(entry)).toEqual([
				'Plugin command must not be empty',
			]);
		});

		it('collects a param key problem and skips its value check', () => {
			const entry: PresetEntry = {
				key: 'check_disk',
				command: 'check_disk',
				params: {'bad key': 'has space'},
			};
			expect(validatePresetEntry(entry)).toEqual([
				'Invalid parameter name "bad key". Use letters, digits, underscore, dot and hyphen.',
			]);
		});

		it('collects a param value problem', () => {
			const entry: PresetEntry = {
				key: 'check_disk',
				command: 'check_disk',
				params: {warn: 'has space'},
			};
			expect(validatePresetEntry(entry)).toEqual([
				'Parameter "warn" may not contain whitespace or "#". Use "+" for spaces.',
			]);
		});
	});

	describe('buildConfigLine', () => {
		it('renders a command with no params', () => {
			const entry: PresetEntry = {
				key: 'check_test',
				command: 'check_test',
				params: {},
			};
			expect(buildConfigLine(entry)).toBe('check_test=check_test');
		});

		it('renders params in insertion order', () => {
			const entry: PresetEntry = {
				key: 'check_disk',
				command: 'check_disk',
				params: {warn: '80', crit: '90'},
			};
			expect(buildConfigLine(entry)).toBe(
				'check_disk=check_disk warn=80 crit=90',
			);
		});
	});

	describe('parseConfigDocument', () => {
		it('parses a valid preset line', () => {
			const doc = parseConfigDocument('check_disk=check_disk warn=80');
			expect(doc.entries).toEqual([
				{
					key: 'check_disk',
					command: 'check_disk',
					params: {warn: '80'},
				},
			]);
			expect(doc.preservedLines).toEqual([]);
		});

		it('keeps comment lines verbatim', () => {
			const doc = parseConfigDocument('# a comment\ncheck_test=check_test');
			expect(doc.preservedLines).toEqual(['# a comment']);
			expect(doc.entries).toHaveLength(1);
		});

		it('keeps blank lines verbatim', () => {
			const doc = parseConfigDocument('\n\n');
			expect(doc.preservedLines).toEqual(['', '', '']);
			expect(doc.entries).toEqual([]);
		});

		it('keeps a line without = verbatim', () => {
			const doc = parseConfigDocument('not a preset');
			expect(doc.preservedLines).toEqual(['not a preset']);
			expect(doc.entries).toEqual([]);
		});

		it('keeps a line with an empty key verbatim', () => {
			const doc = parseConfigDocument('=check_test');
			expect(doc.preservedLines).toEqual(['=check_test']);
			expect(doc.entries).toEqual([]);
		});

		it('keeps a line with an empty command verbatim', () => {
			const doc = parseConfigDocument('check_test=   ');
			expect(doc.preservedLines).toEqual(['check_test=   ']);
			expect(doc.entries).toEqual([]);
		});

		it('keeps a malformed param token verbatim', () => {
			const doc = parseConfigDocument('check_test=check_test orphan');
			expect(doc.preservedLines).toEqual(['check_test=check_test orphan']);
			expect(doc.entries).toEqual([]);
		});

		it('handles CRLF line endings', () => {
			const doc = parseConfigDocument('# c\r\ncheck_test=check_test\r\n');
			expect(doc.preservedLines).toEqual(['# c', '']);
			expect(doc.entries).toEqual([
				{key: 'check_test', command: 'check_test', params: {}},
			]);
		});
	});

	describe('serializeConfigDocument', () => {
		it('returns empty string when nothing to render', () => {
			expect(serializeConfigDocument({preservedLines: [], entries: []})).toBe(
				'',
			);
		});

		it('renders only a header', () => {
			expect(
				serializeConfigDocument({
					preservedLines: ['# header'],
					entries: [],
				}),
			).toBe('# header\n');
		});

		it('filters blank preserved lines from the header', () => {
			expect(
				serializeConfigDocument({
					preservedLines: ['', '  '],
					entries: [],
				}),
			).toBe('');
		});

		it('renders only a body', () => {
			expect(
				serializeConfigDocument({
					preservedLines: [],
					entries: [{key: 'check_test', command: 'check_test', params: {}}],
				}),
			).toBe('check_test=check_test\n');
		});

		it('renders header and body separated by a blank line', () => {
			expect(
				serializeConfigDocument({
					preservedLines: ['# header'],
					entries: [{key: 'check_test', command: 'check_test', params: {}}],
				}),
			).toBe('# header\n\ncheck_test=check_test\n');
		});

		it('round-trips an unchanged preset byte for byte', () => {
			const original = '# comment\n\ncheck_disk=check_disk warn=80 crit=90\n';
			expect(serializeConfigDocument(parseConfigDocument(original))).toBe(
				original,
			);
		});
	});

	describe('readConfigDocument', () => {
		it('returns exists:false when the file is missing', () => {
			mockedFs.existsSync.mockReturnValue(false);

			const result = readConfigDocument();

			expect(result.exists).toBe(false);
			expect(result.rawContent).toBe('');
			expect(result.doc).toEqual({preservedLines: [], entries: []});
			expect(mockedValidateConfigFilePath).toHaveBeenCalledWith(CONFIG_PATH);
		});

		it('reads and parses an existing file', () => {
			mockedFs.existsSync.mockReturnValue(true);
			mockedFs.readFileSync.mockReturnValue('check_test=check_test\n');

			const result = readConfigDocument();

			expect(result.exists).toBe(true);
			expect(result.rawContent).toBe('check_test=check_test\n');
			expect(result.doc.entries).toEqual([
				{key: 'check_test', command: 'check_test', params: {}},
			]);
		});
	});

	describe('writeConfigDocument', () => {
		it('writes a temp file, chmods and renames it', () => {
			writeConfigDocument('check_test=check_test\n');

			expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
				expect.stringContaining('.local-presets.conf.'),
				'check_test=check_test\n',
				{encoding: 'utf-8', mode: 0o640, flag: 'wx'},
			);
			expect(mockedFs.chmodSync).toHaveBeenCalledWith(
				expect.stringContaining('.local-presets.conf.'),
				0o640,
			);
			expect(mockedFs.renameSync).toHaveBeenCalledWith(
				expect.stringContaining('.local-presets.conf.'),
				CONFIG_PATH,
			);
		});

		it('cleans up the temp file and rethrows when the write fails', () => {
			const writeError = new Error('write failed');
			mockedFs.writeFileSync.mockImplementation(() => {
				throw writeError;
			});
			mockedFs.existsSync.mockReturnValue(true);

			expect(() => writeConfigDocument('x')).toThrow('write failed');
			expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
				expect.stringContaining('.local-presets.conf.'),
			);
			expect(mockedLoggerWarn).not.toHaveBeenCalled();
		});

		it('does not unlink when the temp file is absent after a failure', () => {
			const writeError = new Error('write failed');
			mockedFs.writeFileSync.mockImplementation(() => {
				throw writeError;
			});
			mockedFs.existsSync.mockReturnValue(false);

			expect(() => writeConfigDocument('x')).toThrow('write failed');
			expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
		});

		it('logs a warning when cleanup itself fails, then rethrows the original error', () => {
			const writeError = new Error('write failed');
			const cleanupError = new Error('cleanup failed');
			mockedFs.writeFileSync.mockImplementation(() => {
				throw writeError;
			});
			mockedFs.existsSync.mockReturnValue(true);
			mockedFs.unlinkSync.mockImplementation(() => {
				throw cleanupError;
			});

			expect(() => writeConfigDocument('x')).toThrow('write failed');
			expect(mockedLoggerWarn).toHaveBeenCalledWith(
				expect.stringContaining(`Could not remove temporary config file`),
			);
			expect(mockedLoggerWarn).toHaveBeenCalledWith(
				expect.stringContaining(getErrorMessage(cleanupError)),
			);
		});
	});

	describe('mergeMaskedParams', () => {
		const secrets = new Set(['password']);

		it('copies incoming params when there is no existing entry', () => {
			const merged = mergeMaskedParams(secrets, undefined, {a: '1'});
			expect(merged).toEqual({a: '1'});
		});

		it('keeps the stored secret when the incoming secret is blank', () => {
			const merged = mergeMaskedParams(
				secrets,
				{password: 'stored'},
				{
					password: '',
				},
			);
			expect(merged).toEqual({password: 'stored'});
		});

		it('overwrites a secret when a new value is provided', () => {
			const merged = mergeMaskedParams(
				secrets,
				{password: 'stored'},
				{
					password: 'new',
				},
			);
			expect(merged).toEqual({password: 'new'});
		});

		it('keeps a blank non-secret value as blank', () => {
			const merged = mergeMaskedParams(secrets, {warn: 'old'}, {warn: ''});
			expect(merged).toEqual({warn: ''});
		});

		it('does not resurrect a secret that was not stored', () => {
			const merged = mergeMaskedParams(
				secrets,
				{other: 'x'},
				{
					password: '',
				},
			);
			expect(merged).toEqual({password: ''});
		});
	});

	describe('isSecretParamName', () => {
		it('recognises common secret names', () => {
			for (const name of [
				'password',
				'passwd',
				'secret',
				'token',
				'apikey',
				'api_key',
				'credential',
			]) {
				expect(isSecretParamName(name)).toBe(true);
			}
		});

		it('is case insensitive', () => {
			expect(isSecretParamName('API_TOKEN')).toBe(true);
		});

		it('rejects non-secret names', () => {
			expect(isSecretParamName('warn')).toBe(false);
		});
	});

	describe('MAX_CONFIG_DOCUMENT_BYTES', () => {
		it('is 100 KiB', () => {
			expect(MAX_CONFIG_DOCUMENT_BYTES).toBe(100 * 1024);
		});
	});
});
