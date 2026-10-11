import {readConfigDocument} from './local-config-store';
import {logger} from './logger';
import {bootstrapSecretKey} from './secret-bootstrap';
import {createSecretKey, secretKeyFileExists} from './secret-crypto';

jest.mock('./secret-crypto', () => ({
	__esModule: true,
	createSecretKey: jest.fn(),
	secretKeyFileExists: jest.fn(),
	getSecretKeyPath: jest.fn(() => '/etc/nest/nest.key'),
	isEncryptedValue: (value: string) => value.startsWith('enc:v1:'),
}));
jest.mock('./local-config-store');
jest.mock('./logger');

const mockedKeyFileExists = jest.mocked(secretKeyFileExists);
const mockedCreateKey = jest.mocked(createSecretKey);
const mockedReadDoc = jest.mocked(readConfigDocument);
const mockedLoggerWarn = jest.mocked(logger.warn);
const mockedLoggerError = jest.mocked(logger.error);

const docWith = (params: Record<string, string>) => ({
	doc: {
		preservedLines: [],
		entries: [{key: 'vigor', command: 'check-vigor165-vdsl', params}],
	},
	rawContent: '',
	exists: true,
});

describe('bootstrapSecretKey', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('does nothing when the key already exists', () => {
		mockedKeyFileExists.mockReturnValue(true);

		const result = bootstrapSecretKey();

		expect(result).toEqual({status: 'present'});
		expect(mockedCreateKey).not.toHaveBeenCalled();
		expect(mockedReadDoc).not.toHaveBeenCalled();
	});

	it('reports an error when the key path is invalid', () => {
		// A misconfigured SECRET_KEY_PATH makes the path validation throw; the
		// bootstrap must convert that into an error result, not propagate it.
		mockedKeyFileExists.mockImplementation(() => {
			throw new Error('Secret key path not in allowed directory: /tmp/x');
		});

		const result = bootstrapSecretKey();

		expect(result.status).toBe('error');
		if (result.status === 'error') {
			expect(result.message).toContain('Invalid secret key path');
		}
		expect(mockedCreateKey).not.toHaveBeenCalled();
		expect(mockedReadDoc).not.toHaveBeenCalled();
		expect(mockedLoggerError).toHaveBeenCalled();
	});

	it('creates a key when none exists and no secrets are present', () => {
		mockedKeyFileExists.mockReturnValue(false);
		mockedReadDoc.mockReturnValue(docWith({host: '1.2.3.4'}));

		const result = bootstrapSecretKey();

		expect(result.status).toBe('created');
		expect(mockedCreateKey).toHaveBeenCalledTimes(1);
		expect(mockedLoggerWarn).toHaveBeenCalled();
	});

	it('creates a key when the presets file is empty', () => {
		mockedKeyFileExists.mockReturnValue(false);
		mockedReadDoc.mockReturnValue({
			doc: {preservedLines: [], entries: []},
			rawContent: '',
			exists: false,
		});

		const result = bootstrapSecretKey();

		expect(result.status).toBe('created');
		expect(mockedCreateKey).toHaveBeenCalledTimes(1);
	});

	it('refuses to create a key when encrypted secrets already exist', () => {
		mockedKeyFileExists.mockReturnValue(false);
		mockedReadDoc.mockReturnValue(docWith({password: 'enc:v1:SOMEBLOB'}));

		const result = bootstrapSecretKey();

		expect(result.status).toBe('missing-with-secrets');
		expect(mockedCreateKey).not.toHaveBeenCalled();
		expect(mockedLoggerError).toHaveBeenCalled();
		if (result.status === 'missing-with-secrets') {
			expect(result.message).toContain('cannot decrypt existing secrets');
		}
	});

	it('reports an error when the presets file cannot be inspected', () => {
		mockedKeyFileExists.mockReturnValue(false);
		mockedReadDoc.mockImplementation(() => {
			throw new Error('disk on fire');
		});

		const result = bootstrapSecretKey();

		expect(result.status).toBe('error');
		expect(mockedCreateKey).not.toHaveBeenCalled();
		expect(mockedLoggerError).toHaveBeenCalled();
	});

	it('reports an error when key creation fails', () => {
		mockedKeyFileExists.mockReturnValue(false);
		mockedReadDoc.mockReturnValue(docWith({host: '1.2.3.4'}));
		mockedCreateKey.mockImplementation(() => {
			throw new Error('read-only fs');
		});

		const result = bootstrapSecretKey();

		expect(result.status).toBe('error');
		expect(mockedLoggerError).toHaveBeenCalled();
	});
});
