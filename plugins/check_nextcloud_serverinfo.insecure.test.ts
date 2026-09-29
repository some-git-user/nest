import {EventEmitter} from 'events';
import https from 'https';
import {insecureHttpsFetch} from './check_nextcloud_serverinfo';

// The default insecure fetch dials the network through Node's `https` core
// module. Mocking `https` lets the full request/response lifecycle — success,
// non-2xx, malformed JSON, timeout, and stream errors — be exercised without a
// live TLS server.
jest.mock('https');

const mockedRequest = jest.mocked(https.request);

/**
 * A fake `ClientRequest`: an EventEmitter with `destroy`/`end` spies, matching
 * what `insecureHttpsFetch` relies on.
 */
const makeRequest = (): EventEmitter & {
	destroy: jest.Mock;
	end: jest.Mock;
} => {
	const request = new EventEmitter() as EventEmitter & {
		destroy: jest.Mock;
		end: jest.Mock;
	};
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

/**
 * Wire `https.request` to hand back a controllable request/response pair.
 *
 * The returned object lets a test emit response events or reject the promise
 * by triggering request-level errors after the call is in flight.
 */
const wireRequest = (
	request: EventEmitter & {destroy: jest.Mock; end: jest.Mock},
	response?: EventEmitter & {statusCode?: number; statusMessage?: string},
): void => {
	mockedRequest.mockImplementation((_options: unknown, cb?: unknown) => {
		// Only invoke the response callback when a response exists; the
		// timeout/error cases never produce one.
		if (response && typeof cb === 'function') {
			// Defer so the caller has attached its handlers first.
			setImmediate(() => cb(response));
		}
		return request as unknown as ReturnType<typeof https.request>;
	});
};

describe('insecureHttpsFetch', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('resolves parsed JSON on a 200 response', async () => {
		const request = makeRequest();
		const response = new EventEmitter() as EventEmitter & {
			statusCode?: number;
			statusMessage?: string;
		};
		response.statusCode = 200;
		response.statusMessage = 'OK';
		wireRequest(request, response);

		const promise = insecureHttpsFetch('https://cloud.example.com/info', {
			Accept: 'application/json',
		});

		setImmediate(() => {
			response.emit('data', Buffer.from('{"ok":'));
			response.emit('data', Buffer.from('true}'));
			response.emit('end');
		});

		await expect(promise).resolves.toEqual({ok: true});
		expect(mockedRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				protocol: 'https:',
				hostname: 'cloud.example.com',
				path: '/info',
				method: 'GET',
				rejectUnauthorized: false,
				headers: {Accept: 'application/json'},
			}),
			expect.any(Function),
		);
	});

	test('preserves the query string in the request path', async () => {
		const request = makeRequest();
		const response = new EventEmitter() as EventEmitter & {
			statusCode?: number;
			statusMessage?: string;
		};
		response.statusCode = 200;
		wireRequest(request, response);

		const promise = insecureHttpsFetch(
			'https://cloud.example.com/info?format=json&skipApps=true',
			{},
		);

		setImmediate(() => {
			response.emit('data', Buffer.from('{}'));
			response.emit('end');
		});

		await expect(promise).resolves.toEqual({});
		expect(mockedRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/info?format=json&skipApps=true',
			}),
			expect.any(Function),
		);
	});

	test('rejects with the status line on a non-2xx response', async () => {
		const request = makeRequest();
		const response = new EventEmitter() as EventEmitter & {
			statusCode?: number;
			statusMessage?: string;
		};
		response.statusCode = 503;
		response.statusMessage = 'Service Unavailable';
		wireRequest(request, response);

		const promise = insecureHttpsFetch('https://cloud.example.com/info', {});

		setImmediate(() => {
			response.emit('data', Buffer.from('nope'));
			response.emit('end');
		});

		await expect(promise).rejects.toThrow('HTTP 503 Service Unavailable');
	});

	test('rejects when the body is not valid JSON', async () => {
		const request = makeRequest();
		const response = new EventEmitter() as EventEmitter & {
			statusCode?: number;
			statusMessage?: string;
		};
		response.statusCode = 200;
		wireRequest(request, response);

		const promise = insecureHttpsFetch('https://cloud.example.com/info', {});

		setImmediate(() => {
			response.emit('data', Buffer.from('not json at all'));
			response.emit('end');
		});

		await expect(promise).rejects.toThrow(/Invalid JSON response/);
	});

	test('destroys the request with an error on timeout', async () => {
		const request = makeRequest();
		wireRequest(request, undefined);

		const promise = insecureHttpsFetch('https://cloud.example.com/info', {});

		setImmediate(() => {
			request.emit('timeout');
		});

		await expect(promise).rejects.toThrow(/timed out/);
		expect(request.destroy).toHaveBeenCalledWith(expect.any(Error));
	});

	test('rejects when the request emits an error', async () => {
		const request = makeRequest();
		wireRequest(request, undefined);

		const promise = insecureHttpsFetch('https://cloud.example.com/info', {});

		setImmediate(() => {
			request.emit('error', new Error('ECONNRESET'));
		});

		await expect(promise).rejects.toThrow('ECONNRESET');
	});

	test('rejects when the response stream emits an error', async () => {
		const request = makeRequest();
		const response = new EventEmitter() as EventEmitter & {
			statusCode?: number;
			statusMessage?: string;
		};
		response.statusCode = 200;
		wireRequest(request, response);

		const promise = insecureHttpsFetch('https://cloud.example.com/info', {});

		setImmediate(() => {
			response.emit('error', new Error('aborted'));
		});

		await expect(promise).rejects.toThrow('aborted');
	});

	test('treats a missing status code as 0 and rejects', async () => {
		const request = makeRequest();
		const response = new EventEmitter() as EventEmitter & {
			statusCode?: number;
			statusMessage?: string;
		};
		// statusCode left undefined exercises the `?? 0` fallback.
		response.statusMessage = undefined;
		wireRequest(request, response);

		const promise = insecureHttpsFetch('https://cloud.example.com/info', {});

		setImmediate(() => {
			response.emit('data', Buffer.from('{}'));
			response.emit('end');
		});

		await expect(promise).rejects.toThrow('HTTP 0');
	});

	test('rejects with a bare status when statusMessage is missing', async () => {
		const request = makeRequest();
		const response = new EventEmitter() as EventEmitter & {
			statusCode?: number;
			statusMessage?: string;
		};
		response.statusCode = 404;
		// statusMessage left undefined exercises the `?? ''` fallback.
		wireRequest(request, response);

		const promise = insecureHttpsFetch('https://cloud.example.com/info', {});

		setImmediate(() => {
			response.emit('data', Buffer.from('{}'));
			response.emit('end');
		});

		await expect(promise).rejects.toThrow('HTTP 404');
	});

	test('wraps a non-Error thrown while parsing the body', async () => {
		const request = makeRequest();
		const response = new EventEmitter() as EventEmitter & {
			statusCode?: number;
			statusMessage?: string;
		};
		response.statusCode = 200;
		wireRequest(request, response);

		// Make JSON.parse throw a non-Error value to exercise the String() branch.
		const originalParse = JSON.parse;
		const parseSpy = jest
			.spyOn(JSON, 'parse')
			.mockImplementationOnce((): unknown => {
				throw 'not-an-error';
			});

		const promise = insecureHttpsFetch('https://cloud.example.com/info', {});

		setImmediate(() => {
			response.emit('data', Buffer.from('whatever'));
			response.emit('end');
		});

		await expect(promise).rejects.toThrow(
			/Invalid JSON response: not-an-error/,
		);
		parseSpy.mockRestore();
		JSON.parse = originalParse;
	});
});
