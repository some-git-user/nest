import {EventEmitter} from 'events';
import {scheduleCleanupLogs} from './scheduleCleanup';

// ── mock stream helpers ───────────────────────────────────────────────────────

class MockReadStream extends EventEmitter {
	pipe(dest: unknown) {
		return dest;
	}
}

class MockGzip extends EventEmitter {
	pipe(dest: unknown) {
		return dest;
	}
}

class MockWriteStream extends EventEmitter {}

// ── flush all pending microtasks (runs after currently-queued microtasks) ─────

const flushPromises = (): Promise<void> =>
	new Promise((resolve) => setImmediate(resolve));

// ── module-level mutable state reset per test ─────────────────────────────────

let capturedCronCallback: (() => void) | null = null;
let mockOutput: MockWriteStream;

// ── mocks ─────────────────────────────────────────────────────────────────────

jest.mock('node-cron', () => ({schedule: jest.fn()}));

jest.mock('fs', () => ({
	promises: {
		stat: jest.fn(),
		rename: jest.fn(),
		writeFile: jest.fn(),
		unlink: jest.fn(),
	},
	createReadStream: jest.fn(),
	createWriteStream: jest.fn(),
}));

jest.mock('zlib', () => ({createGzip: jest.fn()}));

jest.mock('../../config/env', () => ({
	env: {
		LOG_FILE_PATH: '/var/log/nest/nest.log',
		MAX_LOG_FILE_SIZE_BYTES: 1024,
	},
}));

jest.mock('../logger', () => ({
	logger: {debug: jest.fn(), info: jest.fn(), error: jest.fn()},
}));

jest.mock('../error-message', () => ({
	getErrorMessage: (err: unknown) =>
		err instanceof Error ? err.message : String(err),
}));

// ── imports that see the mocked modules ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cron = require('node-cron') as {schedule: jest.Mock};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsMock = require('fs') as {
	promises: {
		stat: jest.Mock;
		rename: jest.Mock;
		writeFile: jest.Mock;
		unlink: jest.Mock;
	};
	createReadStream: jest.Mock;
	createWriteStream: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const zlibMock = require('zlib') as {createGzip: jest.Mock};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {logger} = require('../logger') as {
	logger: {debug: jest.Mock; info: jest.Mock; error: jest.Mock};
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {env} = require('../../config/env') as {
	env: {LOG_FILE_PATH: string; MAX_LOG_FILE_SIZE_BYTES: number};
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('scheduleCleanupLogs', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		capturedCronCallback = null;
		mockOutput = new MockWriteStream();

		// restore mutable env fields to safe defaults
		(env as Record<string, unknown>).LOG_FILE_PATH = '/var/log/nest/nest.log';
		(env as Record<string, unknown>).MAX_LOG_FILE_SIZE_BYTES = 1024;

		cron.schedule.mockImplementation((_expr: string, cb: () => void) => {
			capturedCronCallback = cb;
		});
		fsMock.createReadStream.mockReturnValue(new MockReadStream());
		fsMock.createWriteStream.mockReturnValue(mockOutput);
		zlibMock.createGzip.mockReturnValue(new MockGzip());
	});

	// ── startup ───────────────────────────────────────────────────────────────

	test('registers a cron job and logs a startup message', () => {
		scheduleCleanupLogs();

		expect(cron.schedule).toHaveBeenCalledWith(
			'* * * * *',
			expect.any(Function),
			expect.objectContaining({timezone: 'Europe/Berlin'}),
		);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Cron job "cleanup logs"'),
		);
	});

	// ── cleanupLogs branch: no log file path ──────────────────────────────────

	test('does not stat when LOG_FILE_PATH is empty', async () => {
		(env as Record<string, unknown>).LOG_FILE_PATH = '';
		scheduleCleanupLogs();

		capturedCronCallback!();
		await flushPromises();

		expect(fsMock.promises.stat).not.toHaveBeenCalled();
		// 'finished cleanup logs' is only logged when the try/catch block is reached
		expect(logger.info).not.toHaveBeenCalledWith('finished cleanup logs');
	});

	// ── cleanupLogs branch: stat throws ──────────────────────────────────────

	test('catches and logs errors thrown by stat', async () => {
		fsMock.promises.stat.mockRejectedValue(new Error('ENOENT: no such file'));
		scheduleCleanupLogs();

		capturedCronCallback!();
		await flushPromises();

		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('ENOENT: no such file'),
		);
		expect(logger.info).toHaveBeenCalledWith('finished cleanup logs');
	});

	// ── cleanupLogs branch: file below size limit ─────────────────────────────

	test('skips rotation when log file size is below the limit', async () => {
		fsMock.promises.stat.mockResolvedValue({size: 512}); // 512 < 1024
		scheduleCleanupLogs();

		capturedCronCallback!();
		await flushPromises();

		expect(fsMock.promises.rename).not.toHaveBeenCalled();
		// 'return' inside the try block exits before 'finished cleanup logs'
		expect(logger.info).not.toHaveBeenCalledWith('finished cleanup logs');
	});

	// ── cleanupLogs branch: successful rotation ───────────────────────────────

	test('rotates, gzips, and removes the original log when size exceeds limit', async () => {
		fsMock.promises.stat.mockResolvedValue({size: 2048}); // 2048 > 1024
		fsMock.promises.rename.mockResolvedValue(undefined);
		fsMock.promises.writeFile.mockResolvedValue(undefined);
		fsMock.promises.unlink.mockResolvedValue(undefined);
		scheduleCleanupLogs();

		capturedCronCallback!();
		await flushPromises(); // let cleanupLogs run up to the gzip stream await

		mockOutput.emit('finish'); // resolve the gzip stream promise
		await flushPromises(); // let unlink + final logger.info run

		expect(fsMock.promises.rename).toHaveBeenCalledWith(
			'/var/log/nest/nest.log',
			expect.stringContaining('nest.log.'),
		);
		expect(fsMock.promises.writeFile).toHaveBeenCalledWith(
			'/var/log/nest/nest.log',
			'',
			{encoding: 'utf8'},
		);
		expect(fsMock.promises.unlink).toHaveBeenCalled();
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('Rotated and zipped log file'),
		);
		expect(logger.info).toHaveBeenCalledWith('finished cleanup logs');
	});

	// ── cleanupLogs branch: gzip stream error ────────────────────────────────

	test('catches and logs an error emitted by the gzip output stream', async () => {
		fsMock.promises.stat.mockResolvedValue({size: 2048});
		fsMock.promises.rename.mockResolvedValue(undefined);
		fsMock.promises.writeFile.mockResolvedValue(undefined);
		scheduleCleanupLogs();

		capturedCronCallback!();
		await flushPromises(); // let cleanupLogs run up to the gzip stream await

		mockOutput.emit('error', new Error('write stream failure'));
		await flushPromises(); // let the catch block run

		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('write stream failure'),
		);
		expect(logger.info).toHaveBeenCalledWith('finished cleanup logs');
	});
});
