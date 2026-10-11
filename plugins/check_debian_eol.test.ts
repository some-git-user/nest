import fs from 'fs';
import {checkDebianEol, meta} from './check_debian_eol';

type Release = {
	name: string;
	eolFrom: string;
	isEol: boolean;
};

const mockReadFile = (content: string) => {
	jest.spyOn(fs.promises, 'readFile').mockResolvedValue(content);
};

const mockFetchResponse = (ok: boolean, jsonValue: unknown) => {
	const json = jest.fn().mockResolvedValue(jsonValue);
	const fetchMock = jest.fn().mockResolvedValue({
		ok,
		status: ok ? 200 : 500,
		statusText: ok ? 'OK' : 'Internal Server Error',
		json,
	});
	global.fetch = fetchMock as unknown as typeof fetch;
};

const buildApiResponse = (release: Release) => ({
	result: {
		label: 'Debian',
		name: 'debian',
		releases: [
			{
				codename: 'bookworm',
				eoesFrom: '2099-01-01',
				eolFrom: release.eolFrom,
				isEoes: false,
				isEol: release.isEol,
				isLts: false,
				isMaintained: true,
				label: 'Debian',
				latest: {
					date: '2026-01-01',
					name: 'bookworm',
				},
				ltsFrom: '2099-01-01',
				name: release.name,
				releaseDate: '2024-01-01',
			},
		],
	},
});

describe('checkDebianEol plugin', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	test('exports startup metadata usage for http and shell clients', () => {
		expect(meta.usage.http).toContain('/plugins/check-debian-eol');
		expect(meta.usage.shell).toContain('./check_nest.sh check-debian-eol');
	});

	test('returns error when endoflife api response is not ok', async () => {
		mockReadFile('VERSION_ID="12"\n');
		mockFetchResponse(false, {});

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('Error: 500 Internal Server Error');
	});

	test('returns error when endoflife api payload shape is invalid', async () => {
		mockReadFile('VERSION_ID="12"\n');
		mockFetchResponse(true, {bad: true});

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('invalid response format');
	});

	test('returns error when endoflife api payload is null', async () => {
		mockReadFile('VERSION_ID="12"\n');
		mockFetchResponse(true, null);

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('invalid response format');
	});

	test('returns error when releases value is not an array', async () => {
		mockReadFile('VERSION_ID="12"\n');
		mockFetchResponse(true, {
			result: {
				releases: 'invalid',
			},
		});

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('invalid response format');
	});

	test('returns UNKNOWN placeholder when releases array is empty', async () => {
		mockReadFile('VERSION_ID="12"\n');
		mockFetchResponse(true, {
			result: {
				label: 'Debian',
				name: 'debian',
				releases: [],
			},
		});

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('No releases found');
	});

	test('uses default warning and critical thresholds when parameters are omitted', async () => {
		mockReadFile('VERSION_ID="12"\n');
		const warningFuture = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000)
			.toISOString()
			.slice(0, 10);
		mockFetchResponse(
			true,
			buildApiResponse({name: '12', eolFrom: warningFuture, isEol: false}),
		);

		const result = await checkDebianEol(
			{} as unknown as {
				warningEolRemainingDays: number;
				criticalEolRemainingDays: number;
			},
		);

		expect(result.code).toBe(1);
		expect(result.message).toContain('is EOL in');
	});

	test('returns UNKNOWN placeholder when eol date is invalid', async () => {
		mockReadFile('VERSION_ID="12"\n');
		mockFetchResponse(
			true,
			buildApiResponse({
				name: '12',
				eolFrom: 'not-a-date',
				isEol: false,
			}),
		);

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('unparseable EOL date');
	});

	test('returns not-found message when Debian version is not in releases', async () => {
		mockReadFile('VERSION_ID="12"\n');
		mockFetchResponse(
			true,
			buildApiResponse({name: '11', eolFrom: '2099-01-01', isEol: false}),
		);

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('does not match any releases');
	});

	test('returns critical when release is already marked EOL', async () => {
		mockReadFile('VERSION_ID="12"\n');
		mockFetchResponse(
			true,
			buildApiResponse({name: '12', eolFrom: '2020-01-01', isEol: true}),
		);

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(2);
		expect(result.message).toContain('is EOL since');
	});

	test('returns critical when days remaining are below critical threshold', async () => {
		mockReadFile('VERSION_ID="12"\n');
		const nearFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
			.toISOString()
			.slice(0, 10);
		mockFetchResponse(
			true,
			buildApiResponse({name: '12', eolFrom: nearFuture, isEol: false}),
		);

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(2);
		expect(result.message).toContain('is EOL in');
	});

	test('returns warning when days remaining are below warning threshold', async () => {
		mockReadFile('VERSION_ID="12"\n');
		const warningFuture = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000)
			.toISOString()
			.slice(0, 10);
		mockFetchResponse(
			true,
			buildApiResponse({name: '12', eolFrom: warningFuture, isEol: false}),
		);

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(1);
		expect(result.message).toContain('is EOL in');
	});

	test('returns ok when days remaining exceed warning threshold', async () => {
		mockReadFile('VERSION_ID="12"\n');
		mockFetchResponse(
			true,
			buildApiResponse({name: '12', eolFrom: '2099-01-01', isEol: false}),
		);

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('is not EOL. Remaining days');
	});

	test('reports the read failure when VERSION_ID is missing in os-release', async () => {
		mockReadFile('ID=debian\n');
		const consoleErrorSpy = jest
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		mockFetchResponse(
			true,
			buildApiResponse({name: '12', eolFrom: '2099-01-01', isEol: false}),
		);

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(consoleErrorSpy).toHaveBeenCalled();
		expect(result.code).toBe(3);
		expect(result.message).toContain('could not determine the Debian version');
	});

	test('reads an unquoted VERSION_ID from os-release', async () => {
		// The os-release key=value format allows a bare value; the regex must
		// not require a closing quote (VERSION_ID=12, not VERSION_ID="12").
		mockReadFile('VERSION_ID=12\n');
		mockFetchResponse(
			true,
			buildApiResponse({name: '12', eolFrom: '2099-01-01', isEol: false}),
		);

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(0);
		expect(result.message).toContain('is not EOL. Remaining days');
	});

	test('reports UNKNOWN when the endoflife request rejects', async () => {
		mockReadFile('VERSION_ID="12"\n');
		global.fetch = jest
			.fn()
			.mockRejectedValue(
				new Error('socket hang up'),
			) as unknown as typeof fetch;

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('could not reach');
		expect(result.message).toContain('socket hang up');
	});

	test('reports UNKNOWN when the endoflife request rejects with a non-Error', async () => {
		// fetch seams (or a polyfill) can reject with anything; the message
		// must still degrade to String(error) rather than crash.
		mockReadFile('VERSION_ID="12"\n');
		global.fetch = jest
			.fn()
			.mockRejectedValue('plain string failure') as unknown as typeof fetch;

		const result = await checkDebianEol({
			warningEolRemainingDays: 60,
			criticalEolRemainingDays: 30,
		});

		expect(result.code).toBe(3);
		expect(result.message).toContain('could not reach');
		expect(result.message).toContain('plain string failure');
	});

	test('rejects a non-numeric threshold instead of reporting OK', async () => {
		// A non-numeric threshold makes every `daysRemaining <= threshold`
		// comparison false, so without validation the check reports OK for any
		// input. It must be rejected as UNKNOWN.
		mockReadFile('VERSION_ID="12"\n');
		const result = await checkDebianEol({
			warningEolRemainingDays: 'soon' as unknown as number,
			criticalEolRemainingDays: 30,
		});
		expect(result.code).toBe(3);
		expect(result.message).toContain('must be numbers');
	});

	test('rejects criticalEolRemainingDays above warningEolRemainingDays', async () => {
		// The critical branch is evaluated first, so a critical threshold above
		// the warning one would skip WARNING entirely. Reject the misordering.
		mockReadFile('VERSION_ID="12"\n');
		const result = await checkDebianEol({
			warningEolRemainingDays: 30,
			criticalEolRemainingDays: 60,
		});
		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'criticalEolRemainingDays must be less than or equal to warningEolRemainingDays',
		);
	});
});
