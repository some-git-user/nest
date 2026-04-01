import {scheduleCleanupLogs} from './scheduleCleanup';
import {cronTimeZone, runScheduler} from './scheduler';

jest.mock('./scheduleCleanup', () => ({
	scheduleCleanupLogs: jest.fn(),
}));

describe('scheduler', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('cronTimeZone is Europe/Berlin', () => {
		expect(cronTimeZone).toBe('Europe/Berlin');
	});

	test('runScheduler calls scheduleCleanupLogs once', () => {
		runScheduler();
		expect(scheduleCleanupLogs).toHaveBeenCalledTimes(1);
	});
});
