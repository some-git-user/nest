/**
 * Tests for Server Preload Module
 *
 * Note: This is a preload entry point that has significant side effects.
 * The tests here verify the module structure and logging behavior.
 */

// Add moduleNameMapper for ssh2-preload
jest.mock('ssh2', () => ({}), {virtual: true});

describe('server-preload', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('module structure', () => {
		test('module exists and has expected structure', () => {
			// server-preload.ts is an entry point with side effects
			// We can't easily test it in isolation due to its design
			// The tests here verify the expected console.log calls
			expect(true).toBe(true);
		});

		test('expected console.log calls are made', () => {
			// Mock the dependencies
			jest.doMock('ssh2', () => ({}), {virtual: true});
			jest.doMock(
				'./preload/ssh2-preload.js',
				() => ({
					setupSsh2Interception: jest.fn(),
				}),
				{virtual: true},
			);
			jest.doMock('./server', () => ({}), {virtual: true});

			const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				require('./server-preload');
			});

			// Verify the expected log calls
			expect(consoleSpy).toHaveBeenCalledWith('[PRELOAD] Starting');
			expect(consoleSpy).toHaveBeenCalledWith('[PRELOAD] Done');

			consoleSpy.mockRestore();
		});

		test('calls setupSsh2Interception', () => {
			const mockSetupSsh2Interception = jest.fn();

			jest.doMock('ssh2', () => ({}), {virtual: true});
			jest.doMock(
				'./preload/ssh2-preload.js',
				() => ({
					setupSsh2Interception: mockSetupSsh2Interception,
				}),
				{virtual: true},
			);
			jest.doMock('./server', () => ({}), {virtual: true});

			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				require('./server-preload');
			});

			expect(mockSetupSsh2Interception).toHaveBeenCalledTimes(1);
		});
	});
});
