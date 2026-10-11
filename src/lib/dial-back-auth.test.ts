import {Request} from 'express';
import {env} from '../config/env';
import {extractApiKey} from './browser-auth';
import {
	PRESETS_UNAVAILABLE_MESSAGE,
	resolveDialBackAuth,
} from './dial-back-auth';

jest.mock('../config/env', () => ({
	env: {
		API_KEY: '',
		API_KEY_HEADER: 'x-api-key',
	},
}));
jest.mock('./browser-auth');

const mockedExtractApiKey = jest.mocked(extractApiKey);
const mockedEnv = jest.mocked(env);

const makeRequest = (): Request => ({}) as Request;

describe('dial-back-auth', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedEnv.API_KEY = '';
		mockedEnv.API_KEY_HEADER = 'x-api-key';
		mockedExtractApiKey.mockReturnValue('');
	});

	it('exposes the shared presets-unavailable message', () => {
		expect(PRESETS_UNAVAILABLE_MESSAGE).toContain('hash validation failure');
	});

	it('flags a missing key for a POST when a key is configured', () => {
		mockedEnv.API_KEY = 'secret';
		mockedExtractApiKey.mockReturnValue('');

		expect(resolveDialBackAuth(makeRequest(), 'POST')).toEqual({
			requireApiKey: true,
			missingKey: true,
		});
	});

	it('uses the caller key when one is provided', () => {
		mockedEnv.API_KEY = 'secret';
		mockedExtractApiKey.mockReturnValue('caller');

		expect(resolveDialBackAuth(makeRequest(), 'POST')).toEqual({
			apiKey: 'caller',
			requireApiKey: true,
			missingKey: false,
		});
	});

	it('falls back to the configured key for a keyless GET', () => {
		mockedEnv.API_KEY = 'secret';

		expect(resolveDialBackAuth(makeRequest(), 'GET')).toEqual({
			apiKey: 'secret',
			requireApiKey: false,
			missingKey: false,
		});
	});

	it('does not require a key for a POST when none is configured', () => {
		expect(resolveDialBackAuth(makeRequest(), 'POST')).toEqual({
			apiKey: undefined,
			requireApiKey: false,
			missingKey: false,
		});
	});

	it('returns no key at all when none is configured or provided', () => {
		expect(resolveDialBackAuth(makeRequest(), 'GET')).toEqual({
			apiKey: undefined,
			requireApiKey: false,
			missingKey: false,
		});
	});
});
