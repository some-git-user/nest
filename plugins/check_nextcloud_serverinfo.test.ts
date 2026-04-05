import {
	buildHeaders,
	checkNextcloudServerinfo,
	getStatusText,
	meta,
} from './check_nextcloud_serverinfo';

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
					theme: string;
					enable_avatars: string;
					enable_previews: string;
					memcache_local: string;
					memcache_distributed: string;
					filelocking_enabled: string;
					memcache_locking: string;
					debug: string;
					freespace: number;
					cpuload: number[];
					cpunum: number;
					mem_total: number;
					mem_free: number;
					swap_total: number;
					swap_free: number;
					apps: {
						num_installed: number;
						num_updates_available: number;
						app_updates: unknown[];
					};
					update: {
						available: unknown;
						available_version?: string;
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
		.fn()
		.mockResolvedValue(
			mockedResponse as unknown as Response,
		) as jest.MockedFunction<typeof fetch>;
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
					theme: 'default',
					enable_avatars: 'yes',
					enable_previews: 'yes',
					memcache_local: 'Redis',
					memcache_distributed: 'Redis',
					filelocking_enabled: 'yes',
					memcache_locking: 'Redis',
					debug: 'no',
					freespace: 50 * 1024 * 1024 * 1024,
					cpuload: [0.85, 1.04, 1.17],
					cpunum: 4,
					mem_total: 8 * 1024 * 1024 * 1024,
					mem_free: 3 * 1024 * 1024 * 1024,
					swap_total: 2 * 1024 * 1024 * 1024,
					swap_free: 1 * 1024 * 1024 * 1024,
					apps: {
						num_installed: 45,
						num_updates_available: 0,
						app_updates: [],
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

describe('getStatusText utility', () => {
	test('returns OK for status code 0 (STATUS_OK)', () => {
		expect(getStatusText(0)).toBe('OK');
	});

	test('returns WARNING for status code 1 (STATUS_WARNING)', () => {
		expect(getStatusText(1)).toBe('WARNING');
	});

	test('returns CRITICAL for status code 2 (STATUS_CRITICAL)', () => {
		expect(getStatusText(2)).toBe('CRITICAL');
	});

	test('returns UNKNOWN for unexpected status code 3', () => {
		expect(getStatusText(3)).toBe('UNKNOWN');
	});

	test('returns UNKNOWN for unexpected status code 999', () => {
		expect(getStatusText(999)).toBe('UNKNOWN');
	});

	test('returns UNKNOWN for negative status code', () => {
		expect(getStatusText(-1)).toBe('UNKNOWN');
	});
});

describe('buildHeaders utility', () => {
	test('returns base headers when username is present without password', () => {
		const headers = buildHeaders({
			baseUrl: 'https://cloud.example.com',
			username: 'admin',
		});

		expect(headers).toEqual({
			Accept: 'application/json',
			'OCS-APIRequest': 'true',
		});
	});
});

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

	test('normalizes a trailing slash baseUrl without duplicating slashes', async () => {
		mockFetch(buildHealthyResponse());

		await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com/',
			token: 'monitoring-token',
		});
		const fetchCall = getFetchUrlAndHeaders();

		expect(fetchCall.url).toBe(
			'https://cloud.example.com/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=true&skipUpdate=true',
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
		response.ocs.data.nextcloud.system.update.available_version = '31.0.0';
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
		expect(result.code).toBe(2);
		expect(result.message).toContain('CRITICAL');
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

	test('returns UNKNOWN when free space threshold ordering is invalid', async () => {
		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			criticalFreeSpaceGiB: '50',
			warningFreeSpaceGiB: '20',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'criticalFreeSpaceGiB must be less than or equal to warningFreeSpaceGiB',
		);
	});

	test('returns UNKNOWN when baseUrl has invalid format', async () => {
		const result = await checkNextcloudServerinfo({
			baseUrl: 'not-a-url',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'baseUrl must start with http:// or https://',
		);
	});

	test('returns WARNING when free space is at warning threshold', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.freespace = 20 * 1024 * 1024 * 1024;
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			warningFreeSpaceGiB: '20',
		});

		expect(result.code).toBe(1);
		expect(result.message).toContain('WARNING');
		expect(result.message).toContain(
			'free space 20.0 GiB is at or below warning threshold 20 GiB',
		);
	});

	test('returns WARNING when CPU load is at warning threshold', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.cpuload = [4, 3, 2];
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			warningCpuLoad1m: '4',
		});

		expect(result.code).toBe(1);
		expect(result.message).toContain('WARNING');
		expect(result.message).toContain(
			'cpu load 1m 4.00 is at or above warning threshold 4',
		);
	});

	test('returns CRITICAL when CPU load exceeds critical threshold', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.cpuload = [8.5, 7, 6];
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			criticalCpuLoad1m: '8',
		});

		expect(result.code).toBe(2);
		expect(result.message).toContain('CRITICAL');
		expect(result.message).toContain(
			'cpu load 1m 8.50 is at or above critical threshold 8',
		);
	});

	test('includes debug flag in summary when enabled', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.debug = 'yes';
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('debug on');
	});

	test('handles response with minimal data fields', async () => {
		mockFetch({
			ocs: {
				meta: {
					status: 'ok',
					statuscode: 200,
					message: 'OK',
				},
				data: {
					nextcloud: {
						system: {
							version: '29.0.0',
						},
					},
					activeUsers: {
						last5minutes: 1,
						last1hour: 3,
						last24hours: 10,
					},
				},
			},
		});

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('Nextcloud 29.0.0 OK');
		expect(result.message).toContain('active24h 10');
	});

	test('handles response with missing activeUsers', async () => {
		mockFetch({
			ocs: {
				meta: {
					status: 'ok',
					statuscode: 200,
					message: 'OK',
				},
				data: {
					nextcloud: {
						system: {
							version: '30.0.0',
							freespace: 100 * 1024 * 1024 * 1024,
							cpuload: [0.5, 0.6, 0.7],
						},
					},
				},
			},
		});

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('OK');
		expect(result.performanceData).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'active_users_5m'}),
			]),
		);
	});

	test('returns UNKNOWN when response has invalid meta status', async () => {
		mockFetch(
			{
				ocs: {
					meta: {
						status: 'fail',
						statuscode: 500,
						message: 'Internal server error',
					},
					data: {},
				},
			},
			{ok: true, status: 200, statusText: 'OK'},
		);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('fail');
		expect(result.message).toContain('500');
		expect(result.message).toContain('Internal server error');
	});

	test('returns UNKNOWN with unknown placeholders when meta fields are blank', async () => {
		mockFetch(
			{
				ocs: {
					meta: {
						status: ' ',
						statuscode: 'not-a-number',
						message: '   ',
					},
					data: {},
				},
			},
			{ok: true, status: 200, statusText: 'OK'},
		);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('unknown (unknown): no message');
	});

	test('returns UNKNOWN when response is not valid JSON', async () => {
		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
		} as unknown as Response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('request error');
		expect(result.message).toContain('Invalid JSON');
	});

	test('returns UNKNOWN when fetch itself fails', async () => {
		global.fetch = jest.fn().mockRejectedValue(new Error('Network timeout'));

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('request error');
		expect(result.message).toContain('Network timeout');
	});

	test('returns UNKNOWN when fetch throws a non-Error value', async () => {
		global.fetch = jest.fn().mockRejectedValue('socket closed');

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('request error');
		expect(result.message).toContain('socket closed');
	});

	test('returns UNKNOWN when response shape is invalid', async () => {
		mockFetch(
			{invalid: 'structure'},
			{ok: true, status: 200, statusText: 'OK'},
		);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('unexpected payload shape');
	});

	test('parses parseBoolean with false values', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		mockFetch(response);

		await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			skipApps: '0',
			skipUpdate: 'false',
		});
		const fetchCall = getFetchUrlAndHeaders();

		expect(fetchCall.url).toContain('skipApps=false&skipUpdate=false');
	});

	test('parses parseBoolean with edge case values', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		mockFetch(response);

		await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			skipApps: 'invalid',
			skipUpdate: 'maybe',
		});
		const fetchCall = getFetchUrlAndHeaders();

		// Invalid values default to true
		expect(fetchCall.url).toContain('skipApps=true&skipUpdate=true');
	});

	test('parses parseNumber with string values', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			warningCpuLoad1m: '3.5',
			criticalCpuLoad1m: '7.2',
		});
		const fetchCall = getFetchUrlAndHeaders();

		expect(fetchCall.url).toContain('skipApps=true');
		expect(result.code).toBe(0);
	});

	test('uses default threshold when parseNumber receives non-finite numeric string', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.cpuload = [4.2, 1.5, 1];
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			warningCpuLoad1m: 'Infinity',
			criticalCpuLoad1m: '8',
		});

		expect(result.code).toBe(1);
		expect(result.message).toContain(
			'cpu load 1m 4.20 is at or above warning threshold 4',
		);
	});

	test('returns OK with custom threshold values', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.cpuload = [2, 1.5, 1];
		response.ocs.data.nextcloud.system.freespace = 100 * 1024 * 1024 * 1024;
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			warningCpuLoad1m: '5',
			criticalCpuLoad1m: '10',
			warningFreeSpaceGiB: '10',
			criticalFreeSpaceGiB: '5',
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('OK');
	});

	test('does not include performance data when skipApps and skipUpdate are true', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			skipApps: 'true',
			skipUpdate: 'true',
		});

		expect(result.performanceData).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'app_updates'}),
				expect.objectContaining({label: 'core_update_available'}),
			]),
		);
	});

	test('includes all active user metrics in performance data', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.performanceData).toEqual(
			expect.arrayContaining([
				expect.objectContaining({label: 'active_users_5m', value: '2'}),
				expect.objectContaining({label: 'active_users_1h', value: '4'}),
				expect.objectContaining({label: 'active_users_24h', value: '5'}),
			]),
		);
	});

	test('returns UNKNOWN for mixed username and password parameters', async () => {
		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			username: 'admin',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('Usage:');
	});

	test('returns UNKNOWN for mixed token and username without password', async () => {
		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'token123',
			username: 'admin',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('Usage:');
	});

	test('handles HTTP response status errors gracefully', async () => {
		mockFetch(
			{Some: 'response'},
			{ok: false, status: 503, statusText: 'Service Unavailable'},
		);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('503');
		expect(result.message).toContain('Service Unavailable');
	});

	test('handles readNumber with invalid string values', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.freespace =
			'invalid' as unknown as number;
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(0);
		// When freespace is invalid, it's treated as undefined and free space is not evaluated
		expect(result.message).not.toContain('free');
	});

	test('handles hasUpdateValue with empty object', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.update.available = {};
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			skipUpdate: 'false',
		});

		expect(result.code).toBe(0);
		expect(result.message).not.toContain('core update available');
	});

	test('handles hasUpdateValue with truthy primitive', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.update.available = 1;
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			skipUpdate: 'false',
		});

		expect(result.code).toBe(2);
		expect(result.message).toContain('core update available');
	});

	test('handles hasUpdateValue with empty string', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.update.available = '';
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			skipUpdate: 'false',
		});

		expect(result.code).toBe(0);
		expect(result.message).not.toContain('core update available');
	});

	test('handles hasUpdateValue with non-empty array', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.update.available = ['update'];
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			skipUpdate: 'false',
		});

		expect(result.code).toBe(2);
		expect(result.message).toContain('core update available');
	});

	test('handles parseBoolean with various truthy values', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		mockFetch(response);

		await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			skipApps: 'yes',
			skipUpdate: 'on',
		});
		const fetchCall = getFetchUrlAndHeaders();

		expect(fetchCall.url).toContain('skipApps=true&skipUpdate=true');
	});

	test('handles edge case with all metrics missing', async () => {
		mockFetch({
			ocs: {
				meta: {
					status: 'ok',
					statuscode: 200,
					message: 'OK',
				},
				data: {
					nextcloud: {
						system: {
							version: '30.0.0',
						},
					},
				},
			},
		});

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('Nextcloud 30.0.0 OK');
		expect(result.message).toContain('serverinfo endpoint reachable');
	});

	test('responds with unknown status code conversion', async () => {
		mockFetch(
			{
				ocs: {
					meta: {
						status: 'ok',
						statuscode: 999,
						message: 'Unexpected',
					},
					data: {},
				},
			},
			{ok: true, status: 200, statusText: 'OK'},
		);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('999');
	});

	test('handles undefined meta message gracefully', async () => {
		mockFetch(
			{
				ocs: {
					meta: {
						status: 'ok',
						statuscode: 200,
					},
					data: {},
				},
			},
			{ok: true, status: 200, statusText: 'OK'},
		);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('OK');
	});

	test('handles response with string freespace value', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.freespace =
			'107374182400' as unknown as number;
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('free 100.0 GiB');
	});

	test('handles response with number string cpuload values', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.cpuload = [
			'0.85',
			'1.04',
			'1.17',
		] as unknown as number[];
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('cpu1 0.85');
	});

	test('formats summary correctly for healthy system', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
		});

		expect(result.code).toBe(0);
		expect(result.message).toMatch(/Nextcloud .* OK - .*/);
		expect(result.message).toContain('free 50.0 GiB');
		expect(result.message).toContain('cpu1');
		expect(result.message).toContain('active24h');
	});

	test('returns correct status for multiple warning conditions', async () => {
		const response: HealthyResponse = buildHealthyResponse();
		response.ocs.data.nextcloud.system.cpuload = [4.2, 3, 2];
		response.ocs.data.nextcloud.system.freespace = 19 * 1024 * 1024 * 1024;
		mockFetch(response);

		const result = await checkNextcloudServerinfo({
			baseUrl: 'https://cloud.example.com',
			token: 'monitoring-token',
			warningCpuLoad1m: '4',
			warningFreeSpaceGiB: '20',
		});

		expect(result.code).toBe(1);
		expect(result.message).toContain('WARNING');
		expect(result.message).toContain('free space');
		expect(result.message).toContain('cpu load');
	});
});
