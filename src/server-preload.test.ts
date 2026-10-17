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
			jest.doMock(
				'./cli/dispatch.js',
				() => ({
					runCli: jest.fn(() => false),
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

		test('exits without starting the server when runCli handles a command', () => {
			const mockSetupSsh2Interception = jest.fn();
			const serverRequireMarker = jest.fn();
			process.exitCode = undefined;
			// process.exit never returns in production; throwing here models that so
			// the require('./server') line below it is never reached.
			const exitError = new Error('process.exit');
			const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
				throw exitError;
			}) as never);

			jest.doMock('ssh2', () => ({}), {virtual: true});
			jest.doMock(
				'./preload/ssh2-preload.js',
				() => ({
					setupSsh2Interception: mockSetupSsh2Interception,
				}),
				{virtual: true},
			);
			jest.doMock(
				'./cli/dispatch.js',
				() => ({
					runCli: jest.fn(() => true),
				}),
				{virtual: true},
			);
			jest.doMock('./server', () => {
				serverRequireMarker();
				return {};
			});

			expect(() => {
				jest.isolateModules(() => {
					// eslint-disable-next-line @typescript-eslint/no-require-imports
					require('./server-preload');
				});
			}).toThrow(exitError);

			expect(mockExit).toHaveBeenCalledWith(0);
			expect(serverRequireMarker).not.toHaveBeenCalled();
			mockExit.mockRestore();
		});
	});
});
