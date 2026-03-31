import {checkNextcloudServerinfo, meta} from './check_nextcloud_serverinfo';

type HealthyResponse = {
	ocs: {
		meta: {
			status: string;
			statuscode: number;
			message: string;
		};
		data: {
			nextcloud: {
				system: {
					version: string;
					debug: string;
					freespace: number;
					cpuload: number[];
					apps: {
						num_updates_available: number;
					};
					update: {
						available: unknown[] | Record<string, unknown>;
					};
				};
			};
			activeUsers: {
				last5minutes: number;
				last1hour: number;
				last24hours: number;
			};
		};
	};
};

const mockFetch = (
	jsonValue: unknown,
	init?: {ok?: boolean; status?: number; statusText?: string},
): jest.MockedFunction<typeof fetch> => {
	const mockedResponse = {
		ok: init?.ok ?? true,
		status: init?.status ?? 200,
		statusText: init?.statusText ?? 'OK',
		json: jest.fn().mockResolvedValue(jsonValue),
	} satisfies Pick<Response, 'ok' | 'status' | 'statusText' | 'json'>;
	const fetchMock = jest
		.fn<typeof fetch>()
		.mockResolvedValue(mockedResponse as Response);
	global.fetch = fetchMock;
	return fetchMock;
};

const buildHealthyResponse = (): HealthyResponse => ({
	ocs: {
		meta: {
			status: 'ok',
			statuscode: 200,
			message: 'OK',
		},
		data: {
			nextcloud: {
				system: {
					version: '30.0.0.1',
					debug: 'no',
					freespace: 50 * 1024 * 1024 * 1024,
					cpuload: [0.85, 1.04, 1.17],
					apps: {
						num_updates_available: 0,
					},
					update: {
						available: [],
					},
				},
			},
			activeUsers: {
				last5minutes: 2,
				last1hour: 4,
				last24hours: 5,
			},
		},
	},
});

const getFetchUrlAndHeaders = (): {
	url: string;
	headers: Record<string, string>;
} => {
	const firstCall = jest.mocked(global.fetch).mock.calls[0];
	if (!firstCall) {
		throw new Error('Expected fetch to be called at least once.');
	}

	const [input, init] = firstCall;
	let url = '';
	if (typeof input === 'string') {
		url = input;
	} else if (input instanceof URL) {
		url = input.toString();
	} else if (input instanceof Request) {
		url = input.url;
	} else {
		throw new Error('Expected fetch input to be a string, URL, or Request.');
	}
	if (!init || !init.headers) {
		throw new Error('Expected fetch options with headers.');
	}

	if (Array.isArray(init.headers) || init.headers instanceof Headers) {
		throw new Error('Expected headers to be a plain object record.');
	}

	return {
		url,
		headers: init.headers,
	};
};

describe('checkNextcloudServerinfo plugin', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	test('exports usage metadata and embedded setup guide', () => {
		expect(meta.usage.http).toContain('/plugins/check-nextcloud-serverinfo');
		expect(meta.usage.shell).toContain(
			'./check_nest.sh check-nextcloud-serverinfo',
		);
		expect(meta.help).toContain('Step-by-Step Setup');
		expect(meta.help).toContain('occ config:app:set serverinfo token');
		expect(meta.help).toContain('plugin-whitelist.txt');
	});

	test('returns UNKNOWN usage when baseUrl is missing', async () => {
		const result = await checkNextcloudServerinfo({
			token: 'secret',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('Usage:');
	});

	test('returns UNKNOWN usage when authentication is missing', async () => {
		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'Provide baseUrl plus either token or username/password',
		);
	});

	test('queries the official endpoint with NC-Token auth and returns OK with performance data', async () => {
		mockFetch(buildHealthyResponse());

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});
		const fetchCall = getFetchUrlAndHeaders();

		expect(fetchCall.url).toBe(
			'https://cloud.example.com/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=true&skipUpdate=true',
		);
		expect(fetchCall.headers).toEqual(
			expect.objectContaining({
				Accept: 'application/json',
				'OCS-APIRequest': 'true',
				'NC-Token': 'monitoring-token',
			}),
		);
		expect(result.code).toBe(0);
		expect(result.message).toContain('Nextcloud 30.0.0.1 OK');
		expect(result.message).toContain('free 50.0 GiB');
		expect(result.performanceData).toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'free_space_gib'}),
				expect.objectContaining({label: 'cpu_load_1m', warn: '4', crit: '8'}),
				expect.objectContaining({label: 'active_users_24h', value: '5'}),
			]),
		);
	});

	test('supports HTTP Basic auth and returns CRITICAL when free space is too low', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.freespace = 8 * 1024 * 1024 * 1024;
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com/nextcloud',
			username: 'admin',
			password: 'app-password',
		});
		const fetchCall = getFetchUrlAndHeaders();

		expect(fetchCall.url).toBe(
			'https://cloud.example.com/nextcloud/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=true&skipUpdate=true',
		);
		expect(fetchCall.headers).toEqual(
			expect.objectContaining({
				Authorization: `Basic ${Buffer.from('admin:app-password', 'utf8').toString('base64')}`,
			}),
		);
		expect(result.code).toBe(2);
		expect(result.message).toContain('CRITICAL');
		expect(result.message).toContain(
			'free space 8.0 GiB is at or below critical threshold 10 GiB',
		);
	});

	test('returns WARNING for CPU load and optional update checks when skip flags are disabled', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.cpuload = [4.5, 3.8, 2.1];
		response.ocs.data.nextcloud.system.apps.num_updates_available = 2;
		response.ocs.data.nextcloud.system.update.available = {version: '31.0.0'};
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			skipApps: 'false',
			skipUpdate: 'false',
		});
		const fetchCall = getFetchUrlAndHeaders();

		expect(fetchCall.url).toBe(
			'https://cloud.example.com/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=false&skipUpdate=false',
		);
		expect(result.code).toBe(1);
		expect(result.message).toContain('WARNING');
		expect(result.message).toContain(
			'cpu load 1m 4.50 is at or above warning threshold 4',
		);
		expect(result.message).toContain('app updates available: 2');
		expect(result.message).toContain('core update available');
		expect(result.performanceData).toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'app_updates', value: '2'}),
				expect.objectContaining({label: 'core_update_available', value: '1'}),
			]),
		);
	});

	test('returns UNKNOWN when the endpoint rejects the request', async () => {
		mockFetch(
			{
				ocs: {
					meta: {
						status: 'failure',
						statuscode: 401,
						message: 'Unauthorized',
					},
					data: {},
				},
			},
			{ok: false, status: 401, statusText: 'Unauthorized'},
		);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'wrong-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('401 Unauthorized');
	});

	test('returns UNKNOWN when threshold ordering is invalid', async () => {
		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			warningCpuLoad1m: '8',
			criticalCpuLoad1m: '4',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'criticalCpuLoad1m must be greater than or equal to warningCpuLoad1m',
		);
	});
});
