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
