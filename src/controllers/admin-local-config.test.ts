import {Request, Response} from 'express';
import {env} from '../config/env';
import {
	adminPasswordMatches,
	buildAdminSessionClearCookie,
	buildAdminSessionCookie,
	createAdminSessionCookieValue,
	hasValidAdminPassword,
	hasValidAdminSession,
} from '../lib/admin-auth';
import {
	renderAdminConfigPage,
	renderAdminLoginPage,
	renderAdminNotConfiguredPage,
} from '../lib/admin-page';
import {HttpStatusCodes} from '../lib/http-status-codes';
import {makeInternalRequest} from '../lib/internal-http-client';
import {
	getApprovedConfigContent,
	getConfigDrift,
	hasRuntimeValidationFailed,
} from '../lib/local-config';
import {
	type PresetEntry,
	type ReadConfigDocumentResult,
	hashConfigContent,
	isSecretParamName,
	mergeMaskedParams,
	readConfigDocument,
	serializeConfigDocument,
	validatePresetEntry,
	writeConfigDocument,
} from '../lib/local-config-store';
import {logger} from '../lib/logger';
import {commandToRoutePath} from '../lib/plugin-utils';
import {
	registeredPluginRouteExamples,
	registeredPluginRoutes,
} from '../routes/dynamic-routes';
import {
	getAdminCommands,
	getAdminConfigPage,
	getAdminEntries,
	postAdminLogin,
	postAdminLogout,
	postAdminRevert,
	postAdminSave,
	postAdminTest,
	postAdminValidate,
} from './admin-local-config';

jest.mock('../config/env');
jest.mock('../lib/admin-auth');
jest.mock('../lib/admin-page');
jest.mock('../lib/internal-http-client');
jest.mock('../lib/local-config');
jest.mock('../lib/local-config-store');
jest.mock('../lib/logger');
jest.mock('../lib/plugin-utils');
jest.mock('../routes/dynamic-routes', () => ({
	registeredPluginRoutes: [] as string[],
	registeredPluginRouteExamples: {} as Record<string, unknown>,
}));

const mockedEnv = jest.mocked(env);
const mockedAdminPasswordMatches = jest.mocked(adminPasswordMatches);
const mockedHasValidAdminSession = jest.mocked(hasValidAdminSession);
const mockedHasValidAdminPassword = jest.mocked(hasValidAdminPassword);
const mockedBuildAdminSessionCookie = jest.mocked(buildAdminSessionCookie);
const mockedBuildAdminSessionClearCookie = jest.mocked(
	buildAdminSessionClearCookie,
);
const mockedCreateAdminSessionCookieValue = jest.mocked(
	createAdminSessionCookieValue,
);
const mockedRenderAdminLoginPage = jest.mocked(renderAdminLoginPage);
const mockedRenderAdminNotConfiguredPage = jest.mocked(
	renderAdminNotConfiguredPage,
);
const mockedRenderAdminConfigPage = jest.mocked(renderAdminConfigPage);
const mockedMakeInternalRequest = jest.mocked(makeInternalRequest);
const mockedGetConfigDrift = jest.mocked(getConfigDrift);
const mockedHasRuntimeValidationFailed = jest.mocked(
	hasRuntimeValidationFailed,
);
const mockedGetApprovedConfigContent = jest.mocked(getApprovedConfigContent);
const mockedReadConfigDocument = jest.mocked(readConfigDocument);
const mockedWriteConfigDocument = jest.mocked(writeConfigDocument);
const mockedSerializeConfigDocument = jest.mocked(serializeConfigDocument);
const mockedValidatePresetEntry = jest.mocked(validatePresetEntry);
const mockedHashConfigContent = jest.mocked(hashConfigContent);
const mockedMergeMaskedParams = jest.mocked(mergeMaskedParams);
const mockedIsSecretParamName = jest.mocked(isSecretParamName);
const mockedCommandToRoutePath = jest.mocked(commandToRoutePath);
const mockedLoggerWarn = jest.mocked(logger.warn);
const mockedLoggerError = jest.mocked(logger.error);

type MockResponse = {
	status: jest.Mock;
	json: jest.Mock;
	send: jest.Mock;
	redirect: jest.Mock;
	setHeader: jest.Mock;
};

const makeResponse = (): MockResponse => {
	const res: MockResponse = {
		status: jest.fn(),
		json: jest.fn(),
		send: jest.fn(),
		redirect: jest.fn(),
		setHeader: jest.fn(),
	};
	res.status.mockReturnValue(res);
	res.json.mockReturnValue(res);
	res.send.mockReturnValue(res);
	res.redirect.mockReturnValue(res);
	res.setHeader.mockReturnValue(res);
	return res;
};

const docResult = (
	entries: PresetEntry[],
	rawContent = 'raw',
): ReadConfigDocumentResult => ({
	doc: {preservedLines: ['# header'], entries},
	rawContent,
	exists: true,
});

describe('admin-local-config controller', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedEnv.ADMIN_UI_PASSWORD = 'admin-key';
		mockedEnv.API_KEY = '';
		mockedEnv.API_KEY_HEADER = 'x-api-key';
		mockedEnv.ADMIN_SESSION_TTL_SECONDS = 900;

		// Default: identity-ish behaviour for the store helpers so tests that do
		// not care about them still work.
		mockedMergeMaskedParams.mockImplementation(
			(_secrets, _existing, incoming) => ({...incoming}),
		);
		mockedIsSecretParamName.mockReturnValue(false);
		mockedHashConfigContent.mockImplementation((c) => `hash(${c})`);
		mockedSerializeConfigDocument.mockReturnValue('serialized');
		mockedValidatePresetEntry.mockReturnValue([]);
		mockedCommandToRoutePath.mockImplementation((cmd) => `/plugins/${cmd}`);
		mockedGetConfigDrift.mockReturnValue({
			approvedHash: 'approved',
			currentHash: 'approved',
			drifted: false,
		});
		mockedHasRuntimeValidationFailed.mockReturnValue(false);
		mockedReadConfigDocument.mockReturnValue(docResult([]));
		mockedWriteConfigDocument.mockImplementation(() => undefined);
	});

	describe('listAdminCommands / secretParamNamesForCommand', () => {
		// dynamic-routes is mocked with plain mutable containers (see top of file).
		const routes = registeredPluginRoutes as string[];
		const examples = registeredPluginRouteExamples as Record<string, unknown[]>;

		beforeEach(() => {
			routes.length = 0;
			for (const key of Object.keys(examples)) {
				delete examples[key];
			}
		});

		it('derives commands from registered routes and merges interactive fields', () => {
			routes.push('/plugins/check-disk');
			examples['/plugins/check-disk'] = [
				{
					kind: 'static',
					title: 'Static',
					requestLine: 'GET /plugins/check-disk',
					responseBody: 'OK',
				},
				{
					kind: 'interactive',
					title: 'Form',
					method: 'GET',
					path: '/plugins/check-disk',
					fields: [
						{name: 'warn', label: 'Warn', type: 'text'},
						{name: 'warn', label: 'Warn dup', type: 'text'},
						{name: 'password', label: 'PW', type: 'password'},
					],
				},
			];

			const {listAdminCommands} = require('./admin-local-config');
			const commands = listAdminCommands();

			expect(commands).toEqual([
				{
					command: 'check-disk',
					routePath: '/plugins/check-disk',
					fields: [
						{name: 'warn', label: 'Warn', type: 'text'},
						{name: 'password', label: 'PW', type: 'password'},
					],
				},
			]);
		});

		it('returns password field names for a known command', () => {
			routes.push('/plugins/check-net');
			examples['/plugins/check-net'] = [
				{
					kind: 'interactive',
					title: 'Form',
					method: 'GET',
					path: '/plugins/check-net',
					fields: [
						{name: 'user', label: 'User', type: 'text'},
						{name: 'password', label: 'PW', type: 'password'},
					],
				},
			];
			// A second, unrelated command exercises the skip branch.
			routes.push('/plugins/check-other');
			examples['/plugins/check-other'] = [
				{
					kind: 'interactive',
					title: 'Form',
					method: 'GET',
					path: '/plugins/check-other',
					fields: [{name: 'secret', label: 'S', type: 'password'}],
				},
			];
			mockedCommandToRoutePath.mockReturnValue('/plugins/check-net');

			const {secretParamNamesForCommand} = require('./admin-local-config');
			const names: Set<string> = secretParamNamesForCommand('check-net');
			expect(names.has('password')).toBe(true);
			expect(names.has('user')).toBe(false);
			expect(names.has('secret')).toBe(false);
		});

		it('returns an empty set for an unknown command', () => {
			mockedCommandToRoutePath.mockReturnValue('/plugins/unknown');
			const {secretParamNamesForCommand} = require('./admin-local-config');
			expect(secretParamNamesForCommand('unknown').size).toBe(0);
		});

		it('handles a registered route with no recorded examples', () => {
			routes.push('/plugins/bare');
			// No examples entry for /plugins/bare → exercises the `?? []` fallback.
			const {listAdminCommands} = require('./admin-local-config');
			const commands = listAdminCommands();
			const bare = commands.find(
				(c: {routePath: string}) => c.routePath === '/plugins/bare',
			);
			expect(bare).toEqual({
				command: 'bare',
				routePath: '/plugins/bare',
				fields: [],
			});
		});
	});

	describe('postAdminLogin', () => {
		it('renders the not-configured page when no admin password is set', () => {
			mockedEnv.ADMIN_UI_PASSWORD = '';
			mockedRenderAdminNotConfiguredPage.mockReturnValue('not-configured');
			const res = makeResponse();

			postAdminLogin(
				{body: {}, headers: {}} as Request,
				res as unknown as Response,
			);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
			expect(res.send).toHaveBeenCalledWith('not-configured');
		});

		it('renders the login page with an error when the password is wrong', () => {
			mockedAdminPasswordMatches.mockReturnValue(false);
			mockedRenderAdminLoginPage.mockReturnValue('login-error');
			const res = makeResponse();

			postAdminLogin(
				{body: {adminPassword: 'wrong'}, headers: {}} as Request,
				res as unknown as Response,
			);

			expect(mockedAdminPasswordMatches).toHaveBeenCalledWith('wrong');
			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.UNAUTHORIZED);
			expect(res.send).toHaveBeenCalledWith('login-error');
			expect(mockedLoggerWarn).toHaveBeenCalled();
		});

		it('falls back to the admin password header when the body has no password', () => {
			mockedAdminPasswordMatches.mockReturnValue(true);
			mockedCreateAdminSessionCookieValue.mockReturnValue('cookie-value');
			mockedBuildAdminSessionCookie.mockReturnValue('set-cookie-value');
			const res = makeResponse();

			postAdminLogin(
				{
					body: {},
					headers: {'x-nest-admin-password': 'header-key'},
				} as unknown as Request,
				res as unknown as Response,
			);

			expect(mockedAdminPasswordMatches).toHaveBeenCalledWith('header-key');
			expect(res.setHeader).toHaveBeenCalledWith(
				'Set-Cookie',
				'set-cookie-value',
			);
			expect(res.redirect).toHaveBeenCalledWith('/admin/local-config');
		});

		it('uses the first header value when the admin password header is an array', () => {
			mockedAdminPasswordMatches.mockReturnValue(true);
			mockedCreateAdminSessionCookieValue.mockReturnValue('cookie-value');
			mockedBuildAdminSessionCookie.mockReturnValue('set-cookie-value');
			const res = makeResponse();

			postAdminLogin(
				{
					body: {},
					headers: {'x-nest-admin-password': ['arr-key', 'other']},
				} as unknown as Request,
				res as unknown as Response,
			);

			expect(mockedAdminPasswordMatches).toHaveBeenCalledWith('arr-key');
		});

		it('treats an empty admin password header array as an empty password', () => {
			mockedAdminPasswordMatches.mockReturnValue(false);
			mockedRenderAdminLoginPage.mockReturnValue('login-error');
			const res = makeResponse();

			postAdminLogin(
				{
					body: {},
					headers: {'x-nest-admin-password': []},
				} as unknown as Request,
				res as unknown as Response,
			);

			expect(mockedAdminPasswordMatches).toHaveBeenCalledWith('');
		});
	});

	describe('postAdminLogout', () => {
		it('clears the cookie and returns ok', () => {
			mockedBuildAdminSessionClearCookie.mockReturnValue('cleared');
			const res = makeResponse();

			postAdminLogout({} as Request, res as unknown as Response);

			expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', 'cleared');
			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({ok: true});
		});
	});

	describe('getAdminConfigPage', () => {
		it('renders the not-configured page when no admin password is set', () => {
			mockedEnv.ADMIN_UI_PASSWORD = '';
			mockedRenderAdminNotConfiguredPage.mockReturnValue('not-configured');
			const res = makeResponse();

			getAdminConfigPage({headers: {}} as Request, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.FORBIDDEN);
			expect(res.send).toHaveBeenCalledWith('not-configured');
		});

		it('renders the login page when unauthenticated', () => {
			mockedHasValidAdminSession.mockReturnValue(false);
			mockedHasValidAdminPassword.mockReturnValue(false);
			mockedRenderAdminLoginPage.mockReturnValue('login');
			const res = makeResponse();

			getAdminConfigPage({headers: {}} as Request, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.UNAUTHORIZED);
			expect(res.send).toHaveBeenCalledWith('login');
		});

		it('renders the editor page with masked state when authenticated', () => {
			mockedHasValidAdminSession.mockReturnValue(true);
			mockedReadConfigDocument.mockReturnValue(
				docResult([
					{
						key: 'check_pw',
						command: 'check_pw',
						params: {password: 'secret', warn: '80'},
					},
				]),
			);
			mockedIsSecretParamName.mockImplementation((n) => n === 'password');
			mockedRenderAdminConfigPage.mockReturnValue('page');
			const res = makeResponse();

			getAdminConfigPage({headers: {}} as Request, res as unknown as Response);

			expect(res.send).toHaveBeenCalledWith('page');
			const state = mockedRenderAdminConfigPage.mock.calls[0][0] as {
				entries: {params: Record<string, string>; secretParams: string[]}[];
				contentHash: string;
				startupValidationFailed: boolean;
			};
			expect(state.entries[0].params.password).toBe('');
			expect(state.entries[0].secretParams).toEqual(['password']);
			expect(state.contentHash).toBe('hash(raw)');
			expect(state.startupValidationFailed).toBe(false);
		});
	});

	describe('getAdminCommands', () => {
		it('returns the command list', () => {
			const res = makeResponse();

			getAdminCommands({} as Request, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({commands: expect.any(Array)}),
			);
		});
	});

	describe('getAdminEntries', () => {
		it('returns masked entries and drift on success', () => {
			mockedReadConfigDocument.mockReturnValue(
				docResult([{key: 'a', command: 'a', params: {token: 'x', warn: '1'}}]),
			);
			mockedIsSecretParamName.mockImplementation((n) => n === 'token');
			const res = makeResponse();

			getAdminEntries({} as Request, res as unknown as Response);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					contentHash: 'hash(raw)',
					drift: {
						approvedHash: 'approved',
						currentHash: 'approved',
						drifted: false,
					},
				}),
			);
			const body = res.json.mock.calls[0][0] as {
				entries: {secretParams: string[]}[];
			};
			expect(body.entries[0].secretParams).toEqual(['token']);
		});

		it('reports an error when reading fails', () => {
			mockedReadConfigDocument.mockImplementation(() => {
				throw new Error('read boom');
			});
			const res = makeResponse();

			getAdminEntries({} as Request, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(
				HttpStatusCodes.INTERNAL_SERVER_ERROR,
			);
			expect(res.json).toHaveBeenCalledWith({
				message: 'Could not read the config file',
			});
			expect(mockedLoggerError).toHaveBeenCalled();
		});

		it('maps an undefined drift hash to null in the payload', () => {
			mockedGetConfigDrift.mockReturnValue({
				approvedHash: undefined,
				currentHash: undefined,
				drifted: true,
			});
			const res = makeResponse();

			getAdminEntries({} as Request, res as unknown as Response);

			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					drift: {approvedHash: null, currentHash: null, drifted: true},
				}),
			);
		});
	});

	describe('postAdminValidate', () => {
		it('rejects a body without an entries array', () => {
			const res = makeResponse();

			postAdminValidate({body: {}} as Request, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
			expect(res.json).toHaveBeenCalledWith({
				ok: false,
				problems: ['Request body must contain an "entries" array.'],
			});
		});

		it('rejects too many entries', () => {
			const entries = Array.from({length: 501}, () => ({
				key: 'k',
				command: 'c',
			}));
			const res = makeResponse();

			postAdminValidate(
				{body: {entries}} as Request,
				res as unknown as Response,
			);

			expect(res.json).toHaveBeenCalledWith({
				ok: false,
				problems: ['Too many presets: at most 500 are accepted.'],
			});
		});

		it('rejects a non-object entry', () => {
			const res = makeResponse();

			postAdminValidate(
				{body: {entries: ['nope']}} as Request,
				res as unknown as Response,
			);

			expect(res.json).toHaveBeenCalledWith({
				ok: false,
				problems: ['Preset 1: must be an object.'],
			});
		});

		it('rejects an entry whose key/command are not strings', () => {
			const res = makeResponse();

			postAdminValidate(
				{body: {entries: [{key: 1, command: 'c'}]}} as Request,
				res as unknown as Response,
			);

			expect(res.json).toHaveBeenCalledWith({
				ok: false,
				problems: ['Preset 1: key and command must be strings.'],
			});
		});

		it('rejects an entry whose params are not all strings', () => {
			const res = makeResponse();

			postAdminValidate(
				{
					body: {entries: [{key: 'k', command: 'c', params: {a: 1}}]},
				} as Request,
				res as unknown as Response,
			);

			expect(res.json).toHaveBeenCalledWith({
				ok: false,
				problems: ['Preset 1: params must be string values.'],
			});
		});

		it('rejects an entry with too many params', () => {
			const params: Record<string, string> = {};
			for (let i = 0; i < 101; i++) {
				params[`p${i}`] = 'v';
			}
			const res = makeResponse();

			postAdminValidate(
				{body: {entries: [{key: 'k', command: 'c', params}]}} as Request,
				res as unknown as Response,
			);

			expect(res.json).toHaveBeenCalledWith({
				ok: false,
				problems: ['Preset 1: at most 100 parameters are accepted.'],
			});
		});

		it('returns ok when there are no problems', () => {
			mockedValidatePresetEntry.mockReturnValue([]);
			const res = makeResponse();

			postAdminValidate(
				{body: {entries: [{key: 'k', command: 'c'}]}} as Request,
				res as unknown as Response,
			);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({ok: true, problems: []});
		});

		it('merges stored params for a key that already exists on disk', () => {
			mockedReadConfigDocument.mockReturnValue(
				docResult([{key: 'k', command: 'c', params: {password: 'stored'}}]),
			);
			mockedValidatePresetEntry.mockReturnValue([]);
			const res = makeResponse();

			postAdminValidate(
				{
					body: {entries: [{key: 'k', command: 'c', params: {warn: '80'}}]},
				} as unknown as Request,
				res as unknown as Response,
			);

			expect(res.json).toHaveBeenCalledWith({ok: true, problems: []});
			expect(mockedMergeMaskedParams).toHaveBeenCalledWith(
				expect.any(Set),
				{password: 'stored'},
				{warn: '80'},
			);
		});

		it('returns problems and flags a duplicate key', () => {
			mockedValidatePresetEntry.mockReturnValue(['bad thing']);
			const res = makeResponse();

			postAdminValidate(
				{
					body: {
						entries: [
							{key: 'dup', command: 'c'},
							{key: 'dup', command: 'c'},
						],
					},
				} as Request,
				res as unknown as Response,
			);

			expect(res.json).toHaveBeenCalledWith({
				ok: false,
				problems: [
					'Preset "dup": bad thing',
					'Preset "dup": bad thing',
					'Preset "dup": duplicate key.',
				],
			});
		});

		it('labels an entry with an empty key by its index', () => {
			mockedValidatePresetEntry.mockReturnValue(['bad thing']);
			const res = makeResponse();

			postAdminValidate(
				{body: {entries: [{key: '', command: 'c'}]}} as Request,
				res as unknown as Response,
			);

			expect(res.json).toHaveBeenCalledWith({
				ok: false,
				problems: ['Preset #1: bad thing'],
			});
		});
	});

	describe('postAdminTest', () => {
		it('rejects an invalid single entry', () => {
			const res = makeResponse();

			return postAdminTest(
				{body: {entry: {key: 'k', command: 'c', params: {a: 1}}}} as Request,
				res as unknown as Response,
			).then(() => {
				expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
			});
		});

		it('rejects an entry that fails preset validation', async () => {
			mockedValidatePresetEntry.mockReturnValue(['bad']);
			const res = makeResponse();

			await postAdminTest(
				{body: {entry: {key: 'k', command: 'c', params: {}}}} as Request,
				res as unknown as Response,
			);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
			expect(res.json).toHaveBeenCalledWith({ok: false, problems: ['bad']});
		});

		it('runs a GET test through the internal client', async () => {
			mockedValidatePresetEntry.mockReturnValue([]);
			mockedMakeInternalRequest.mockResolvedValue({
				statusCode: 200,
				headers: {},
				body: 'OK',
			});
			const res = makeResponse();

			await postAdminTest(
				{
					body: {
						entry: {key: 'k', command: 'check_disk', params: {warn: '80'}},
					},
				} as Request,
				res as unknown as Response,
			);

			expect(mockedMakeInternalRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'GET',
					path: '/plugins/check_disk',
					params: {warn: '80'},
					body: undefined,
					apiKey: undefined,
					requireApiKey: false,
				}),
			);
			expect(res.json).toHaveBeenCalledWith({
				ok: true,
				statusCode: 200,
				body: 'OK',
			});
		});

		it('runs a POST test and forwards the API key when configured', async () => {
			mockedEnv.API_KEY = 'secret-api-key';
			mockedValidatePresetEntry.mockReturnValue([]);
			mockedMakeInternalRequest.mockResolvedValue({
				statusCode: 0,
				headers: {},
				body: '',
			});
			const res = makeResponse();

			await postAdminTest(
				{
					body: {
						method: 'POST',
						entry: {key: 'k', command: 'check_disk', params: {warn: '80'}},
					},
				} as Request,
				res as unknown as Response,
			);

			expect(mockedMakeInternalRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'POST',
					body: {warn: '80'},
					params: undefined,
					apiKey: 'secret-api-key',
					requireApiKey: true,
				}),
			);
			expect(res.json).toHaveBeenCalledWith({
				ok: true,
				statusCode: 0,
				body: '',
			});
		});

		it('reports a bad gateway when the internal request throws', async () => {
			mockedValidatePresetEntry.mockReturnValue([]);
			mockedMakeInternalRequest.mockRejectedValue(new Error('connect fail'));
			const res = makeResponse();

			await postAdminTest(
				{body: {entry: {key: 'k', command: 'c', params: {}}}} as Request,
				res as unknown as Response,
			);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.BAD_GATEWAY);
			expect(res.json).toHaveBeenCalledWith({
				message: 'Could not execute the plugin',
			});
		});

		it('treats a body without an entry object as an empty entry', async () => {
			mockedValidatePresetEntry.mockReturnValue(['bad']);
			const res = makeResponse();

			await postAdminTest({body: {}} as Request, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		});
	});

	describe('postAdminSave', () => {
		it('rejects a malformed body', () => {
			const res = makeResponse();

			postAdminSave({body: {}} as Request, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
		});

		it('rejects when baseHash is missing', () => {
			mockedReadConfigDocument.mockReturnValue(docResult([], 'on-disk'));
			const res = makeResponse();

			postAdminSave(
				{body: {entries: [{key: 'k', command: 'c'}]}} as Request,
				res as unknown as Response,
			);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.CONFLICT);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ok: false}),
			);
		});

		it('rejects when baseHash does not match the file on disk', () => {
			mockedReadConfigDocument.mockReturnValue(docResult([], 'on-disk'));
			mockedHashConfigContent.mockReturnValue('actual-hash');
			const res = makeResponse();

			postAdminSave(
				{
					body: {
						entries: [{key: 'k', command: 'c'}],
						baseHash: 'stale-hash',
					},
				} as Request,
				res as unknown as Response,
			);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.CONFLICT);
		});

		it('rejects when validation finds problems', () => {
			mockedReadConfigDocument.mockReturnValue(docResult([], 'same'));
			mockedHashConfigContent.mockReturnValue('same-hash');
			mockedValidatePresetEntry.mockReturnValue(['bad']);
			const res = makeResponse();

			postAdminSave(
				{
					body: {
						entries: [{key: 'k', command: 'c'}],
						baseHash: 'same-hash',
					},
				} as Request,
				res as unknown as Response,
			);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
			expect(res.json).toHaveBeenCalledWith({
				ok: false,
				problems: ['Preset "k": bad'],
			});
		});

		it('rejects when the resulting document is too large', () => {
			mockedReadConfigDocument.mockReturnValue(docResult([], 'same'));
			mockedHashConfigContent.mockReturnValue('same-hash');
			mockedValidatePresetEntry.mockReturnValue([]);
			mockedSerializeConfigDocument.mockReturnValue('x'.repeat(101 * 1024));
			const res = makeResponse();

			postAdminSave(
				{
					body: {
						entries: [{key: 'k', command: 'c'}],
						baseHash: 'same-hash',
					},
				} as Request,
				res as unknown as Response,
			);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.BAD_REQUEST);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({
					ok: false,
					message: expect.stringContaining('exceed'),
				}),
			);
		});

		it('writes the document and returns the new hash and drift', () => {
			mockedReadConfigDocument
				.mockReturnValueOnce(docResult([], 'same'))
				.mockReturnValueOnce(docResult([], 'written'));
			mockedHashConfigContent.mockImplementation((c) =>
				c === 'same' ? 'same-hash' : 'new-hash',
			);
			mockedValidatePresetEntry.mockReturnValue([]);
			mockedSerializeConfigDocument.mockReturnValue('small content');
			const res = makeResponse();

			postAdminSave(
				{
					body: {
						entries: [{key: 'k', command: 'c', params: {warn: '1'}}],
						baseHash: 'same-hash',
					},
				} as Request,
				res as unknown as Response,
			);

			expect(mockedWriteConfigDocument).toHaveBeenCalledWith('small content');
			expect(mockedLoggerWarn).toHaveBeenCalled();
			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.OK);
			expect(res.json).toHaveBeenCalledWith({
				ok: true,
				contentHash: 'new-hash',
				drift: {
					approvedHash: 'approved',
					currentHash: 'approved',
					drifted: false,
				},
			});
		});

		it('reports an error when the write throws', () => {
			mockedReadConfigDocument.mockReturnValue(docResult([], 'same'));
			mockedHashConfigContent.mockReturnValue('same-hash');
			mockedValidatePresetEntry.mockReturnValue([]);
			mockedSerializeConfigDocument.mockReturnValue('small');
			mockedWriteConfigDocument.mockImplementation(() => {
				throw new Error('disk full');
			});
			const res = makeResponse();

			postAdminSave(
				{
					body: {
						entries: [{key: 'k', command: 'c'}],
						baseHash: 'same-hash',
					},
				} as Request,
				res as unknown as Response,
			);

			expect(res.status).toHaveBeenCalledWith(
				HttpStatusCodes.INTERNAL_SERVER_ERROR,
			);
			expect(res.json).toHaveBeenCalledWith({
				message: 'Could not write the config file',
			});
		});
	});

	describe('postAdminRevert', () => {
		it('rejects when there is no approved version', () => {
			mockedGetApprovedConfigContent.mockReturnValue(null);
			const res = makeResponse();

			postAdminRevert({} as Request, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.CONFLICT);
			expect(res.json).toHaveBeenCalledWith(
				expect.objectContaining({ok: false}),
			);
		});

		it('restores the approved content and returns masked entries', () => {
			mockedGetApprovedConfigContent.mockReturnValue('approved content');
			mockedReadConfigDocument.mockReturnValue(
				docResult(
					[{key: 'a', command: 'a', params: {password: 'p'}}],
					'reverted',
				),
			);
			mockedIsSecretParamName.mockImplementation((n) => n === 'password');
			mockedHashConfigContent.mockReturnValue('reverted-hash');
			const res = makeResponse();

			postAdminRevert({} as Request, res as unknown as Response);

			expect(mockedWriteConfigDocument).toHaveBeenCalledWith(
				'approved content',
			);
			expect(res.status).toHaveBeenCalledWith(HttpStatusCodes.OK);
			const body = res.json.mock.calls[0][0] as {
				entries: {secretParams: string[]}[];
				contentHash: string;
			};
			expect(body.contentHash).toBe('reverted-hash');
			expect(body.entries[0].secretParams).toEqual(['password']);
		});

		it('reports an error when the write throws', () => {
			mockedGetApprovedConfigContent.mockReturnValue('approved content');
			mockedWriteConfigDocument.mockImplementation(() => {
				throw new Error('disk full');
			});
			const res = makeResponse();

			postAdminRevert({} as Request, res as unknown as Response);

			expect(res.status).toHaveBeenCalledWith(
				HttpStatusCodes.INTERNAL_SERVER_ERROR,
			);
			expect(res.json).toHaveBeenCalledWith({
				message: 'Could not write the config file',
			});
		});
	});
});
