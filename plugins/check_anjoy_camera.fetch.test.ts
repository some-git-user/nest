import {EventEmitter} from 'events';
import https from 'https';
import {cameraFetch, checkAnjoyCamera} from './check_anjoy_camera';

// The default fetch dials the network through Node's core `https` module.
// Mocking `https` lets the whole request/response lifecycle — success, non-2xx,
// timeout, and stream errors — be exercised without a live camera, and lets the
// plugin's own default-parameter branches run through the real fetcher.
jest.mock('https');

const mockedRequest = jest.mocked(https.request);

type FakeRequest = EventEmitter & {
	destroy: jest.Mock;
	end: jest.Mock;
};

const makeRequest = (): FakeRequest => {
	const request = new EventEmitter() as FakeRequest;
	// A real ClientRequest emits 'error' when destroyed with an error, which is
	// how the timeout path surfaces its rejection. Mirror that here.
	request.destroy = jest.fn((error?: Error) => {
		if (error) {
			request.emit('error', error);
		}
	});
	request.end = jest.fn();
	return request;
};

type FakeResponse = EventEmitter & {
	statusCode?: number;
	statusMessage?: string;
};

const wireRequest = (request: FakeRequest, response?: FakeResponse): void => {
	mockedRequest.mockImplementation((_options: unknown, cb?: unknown) => {
		if (response && typeof cb === 'function') {
			// Defer so the caller has attached its handlers first.
			setImmediate(() => cb(response));
		}
		return request as unknown as ReturnType<typeof https.request>;
	});
};

const makeResponse = (
	statusCode: number,
	statusMessage?: string,
): FakeResponse => {
	const response = new EventEmitter() as FakeResponse;
	response.statusCode = statusCode;
	if (statusMessage !== undefined) {
		response.statusMessage = statusMessage;
	}
	return response;
};

describe('cameraFetch', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('resolves the body on a 200 response', async () => {
		const request = makeRequest();
		const response = makeResponse(200, 'OK');
		wireRequest(request, response);

		const promise = cameraFetch('https://cam/nagios.txt', 5000);

		setImmediate(() => {
			response.emit('data', Buffer.from('{"heart'));
			response.emit('data', Buffer.from('beat":1}'));
			response.emit('end');
		});

		await expect(promise).resolves.toBe('{"heartbeat":1}');
		expect(mockedRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				protocol: 'https:',
				hostname: 'cam',
				path: '/nagios.txt',
				method: 'GET',
				rejectUnauthorized: false,
				timeout: 5000,
			}),
			expect.any(Function),
		);
	});

	test('preserves the query string in the request path', async () => {
		const request = makeRequest();
		const response = makeResponse(200);
		wireRequest(request, response);

		const promise = cameraFetch(
			'https://cam/cgi-bin/nagios?nagios_user=u&nagios_pass=p',
			5000,
		);

		setImmediate(() => {
			response.emit('data', Buffer.from('{}'));
			response.emit('end');
		});

		await expect(promise).resolves.toBe('{}');
		expect(mockedRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/cgi-bin/nagios?nagios_user=u&nagios_pass=p',
			}),
			expect.any(Function),
		);
	});

	test('rejects with the status line on a non-2xx response', async () => {
		const request = makeRequest();
		const response = makeResponse(403, 'Forbidden');
		wireRequest(request, response);

		const promise = cameraFetch('https://cam/cgi-bin/nagios', 5000);

		setImmediate(() => {
			response.emit('data', Buffer.from('denied'));
			response.emit('end');
		});

		await expect(promise).rejects.toThrow('HTTP 403 Forbidden');
	});

	test('rejects on a 500 with no status message', async () => {
		const request = makeRequest();
		const response = makeResponse(500);
		wireRequest(request, response);

		const promise = cameraFetch('https://cam/nagios.txt', 5000);

		setImmediate(() => {
			response.emit('end');
		});

		await expect(promise).rejects.toThrow('HTTP 500');
	});

	test('rejects when the response stream errors', async () => {
		const request = makeRequest();
		const response = makeResponse(200);
		wireRequest(request, response);

		const promise = cameraFetch('https://cam/nagios.txt', 5000);

		setImmediate(() => {
			response.emit('error', new Error('ECONNRESET'));
		});

		await expect(promise).rejects.toThrow('ECONNRESET');
	});

	test('rejects on timeout with the configured duration', async () => {
		const request = makeRequest();
		// No response callback: the socket never answers.
		wireRequest(request);

		const promise = cameraFetch('https://cam/nagios.txt', 1234);

		setImmediate(() => {
			request.emit('timeout');
		});

		await expect(promise).rejects.toThrow('timed out after 1234ms');
	});

	test('rejects on a request-level error', async () => {
		const request = makeRequest();
		wireRequest(request);

		const promise = cameraFetch('https://cam/nagios.txt', 5000);

		setImmediate(() => {
			request.emit('error', new Error('ECONNREFUSED'));
		});

		await expect(promise).rejects.toThrow('ECONNREFUSED');
	});
});

describe('checkAnjoyCamera default collaborators', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('uses the real fetcher and the wall clock when not injected', async () => {
		// Exercises the default `fetchFeed = cameraFetch` and
		// `nowMs = Date.now()` parameter branches. The fresh feed is stamped
		// with the real current time so the staleness check passes against the
		// injected-by-default clock.
		const request = makeRequest();
		const response = makeResponse(200);
		wireRequest(request, response);

		const feed = {
			generated_epoch: Math.floor(Date.now() / 1000),
			rec_storage_present: 1,
			rec_storage_slot: 'mmc0',
			rec_storage_total_kb: 32_000_000,
			rec_storage_avail_kb: 30_000_000,
			rec_storage_used_pct: 3,
			temperature_c: 50,
			cpu_used_pct: 10,
			mem_used_pct: 40,
			nand_used_pct: 20,
			web_server_running: 1,
			watchdog_running: 1,
		};

		const promise = checkAnjoyCamera({host: 'cam'});
		setImmediate(() => {
			response.emit('data', Buffer.from(JSON.stringify(feed)));
			response.emit('end');
		});

		const result = await promise;
		expect(result.code).toBe(0);
		expect(mockedRequest).toHaveBeenCalledWith(
			expect.objectContaining({hostname: 'cam', path: '/nagios.txt'}),
			expect.any(Function),
		);
	});
});

test('treats a missing status code as 0 and rejects', async () => {
	const request = makeRequest();
	// A response with no statusCode at all — the ?? 0 fallback.
	const response = new EventEmitter() as FakeResponse;
	wireRequest(request, response);

	const promise = cameraFetch('https://cam/nagios.txt', 5000);

	setImmediate(() => {
		response.emit('end');
	});

	await expect(promise).rejects.toThrow('HTTP 0');
});
