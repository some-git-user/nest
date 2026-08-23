/**
 * Tests for SSH2 Preload Module
 */

// Mock fs
jest.mock('fs', () => ({
	writeFileSync: jest.fn(),
	statSync: jest.fn().mockReturnValue({size: 1000}),
	rmSync: jest.fn(),
	xexistsSync: jest.fn().mockReturnValue(true),
}));

// Mock os
jest.mock('os', () => ({
	tmpdir: jest.fn().mockReturnValue('/tmp'),
}));

// Mock path
jest.mock('path', () => ({
	join: jest.fn().mockReturnValue('/tmp/test.node'),
	resolve: jest.fn().mockReturnValue('/tmp/test.node'),
}));

describe('ssh2-preload', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Reset global stubs
		globalThis.__SSH2_CRYPTO_STUB__ = {};
		globalThis.__CPU_FEATURES_STUB__ = {};
		// Mock sea module to not exist by default
		jest.doMock('node:sea', () => ({}));
	});

	describe('setupSsh2Interception', () => {
		test('logs setup call', () => {
			const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

			// Mock sea module to not exist
			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const {setupSsh2Interception: setup} = require('./ssh2-preload');
				setup();
			});

			expect(consoleSpy).toHaveBeenCalledWith(
				'[SSH2 Preload] setupSsh2Interception() called',
			);
			consoleSpy.mockRestore();
		});

		test('handles invalid seaModule object', () => {
			const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

			// Mock sea module as invalid
			jest.doMock('node:sea', () => ({}));

			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const {setupSsh2Interception: setup} = require('./ssh2-preload');
				setup();
			});

			expect(consoleSpy).toHaveBeenCalledWith(
				'[SSH2 Preload] Invalid seaModule object',
			);
			consoleSpy.mockRestore();
		});

		test('handles non-SEA mode', () => {
			const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

			// Mock sea module with isSea returning false
			jest.doMock('node:sea', () => ({
				isSea: jest.fn().mockReturnValue(false),
			}));

			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const {setupSsh2Interception: setup} = require('./ssh2-preload');
				setup();
			});

			expect(consoleSpy).toHaveBeenCalledWith(
				'[SSH2 Preload] Not running in SEA mode, ssh2 will load normally',
			);
			consoleSpy.mockRestore();
		});

		test('handles already set up interception', () => {
			const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

			// Mock sea module as invalid (to return early)
			jest.doMock('node:sea', () => ({}));

			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const {setupSsh2Interception: setup} = require('./ssh2-preload');
				// Call twice to trigger the "Already set up" guard
				setup();
				setup();
			});

			expect(consoleSpy).toHaveBeenCalledWith(
				'[SSH2 Preload] Already set up, returning',
			);
			consoleSpy.mockRestore();
		});

		test('handles SEA mode with successful native addon loading', () => {
			const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

			// Mock sea module with isSea returning true
			const mockGetRawAsset = jest.fn().mockReturnValue(Buffer.from('test'));
			jest.doMock('node:sea', () => ({
				isSea: jest.fn().mockReturnValue(true),
				getRawAsset: mockGetRawAsset,
			}));

			// Mock process.dlopen
			const mockDlopen = jest.fn();
			jest.doMock('module', () => {
				const actualModule = jest.requireActual('module');
				return {
					...actualModule,
					prototype: {
						...actualModule.prototype,
						require: jest.fn((id: string) => {
							if (id === 'ssh2') {
								return {Client: jest.fn()};
							}
							return {};
						}),
					},
				};
			});

			jest.doMock('vm', () => ({
				createContext: jest.fn(),
				runInContext: jest.fn(),
			}));

			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const {setupSsh2Interception: setup} = require('./ssh2-preload');
				setup();
			});

			expect(consoleSpy).toHaveBeenCalledWith(
				'[SSH2 Preload] Running in SEA mode, setting up ssh2 native addon interception',
			);
			expect(mockGetRawAsset).toHaveBeenCalledWith('sshcrypto.node');
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		});

		test('handles getRawAsset failure', () => {
			const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

			// Mock sea module where getRawAsset throws
			const mockGetRawAsset = jest.fn().mockImplementation(() => {
				throw new Error('Asset not found');
			});
			jest.doMock('node:sea', () => ({
				isSea: jest.fn().mockReturnValue(true),
				getRawAsset: mockGetRawAsset,
			}));

			// Mock ssh2 to avoid actual module loading
			jest.doMock('ssh2', () => ({
				Client: jest.fn(),
			}));

			jest.isolateModules(() => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const {setupSsh2Interception: setup} = require('./ssh2-preload');
				setup();
			});

			// Verify graceful handling - should log about JS fallback
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('ssh2 will use JavaScript crypto fallback'),
			);
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		});

		test('initializes global stubs', () => {
			expect(globalThis.__SSH2_CRYPTO_STUB__).toEqual({});
			expect(globalThis.__CPU_FEATURES_STUB__).toEqual({});
		});
	});

	describe('getErrorMessage', () => {
		const {getErrorMessage} = require('./ssh2-preload');

		test('handles Error object', () => {
			const error = new Error('test error');
			expect(getErrorMessage(error)).toBe('test error');
		});

		test('handles string error', () => {
			const error = 'test error';
			expect(getErrorMessage(error)).toBe('test error');
		});

		test('handles number', () => {
			const error = 123;
			expect(getErrorMessage(error)).toBe('123');
		});

		test('handles object', () => {
			const error = {msg: 'error'};
			expect(getErrorMessage(error)).toBe('[object Object]');
		});

		test('handles null', () => {
			expect(getErrorMessage(null)).toBe('null');
		});

		test('handles undefined', () => {
			expect(getErrorMessage(undefined)).toBe('undefined');
		});
	});

	describe('setupRequireInterception', () => {
		test('intercepts ssh2 native addon require', () => {
			const {setupRequireInterception} = require('./ssh2-preload');
			const actualModule = jest.requireActual('module');
			const mockNativeExports = {decrypt: jest.fn()};

			// Save original require
			const originalRequire = actualModule.prototype.require;

			setupRequireInterception(actualModule, mockNativeExports, null);

			const intercepted = (actualModule.prototype.require as any)(
				'./crypto/build/Release/sshcrypto.node',
			);

			expect(intercepted).toBe(mockNativeExports);

			// Restore
			actualModule.prototype.require = originalRequire;
		});

		test('intercepts ssh2 package require with preloaded module', () => {
			const {setupRequireInterception} = require('./ssh2-preload');
			const actualModule = jest.requireActual('module');
			const mockPreloaded = {Client: jest.fn()};

			// Save original require
			const originalRequire = actualModule.prototype.require;
			actualModule.prototype.require = jest.fn();

			setupRequireInterception(actualModule, null, mockPreloaded);

			const intercepted = (actualModule.prototype.require as any)('ssh2');

			expect(intercepted).toBe(mockPreloaded);

			// Restore
			actualModule.prototype.require = originalRequire;
		});

		test('calls original require for ssh2 when no preloaded module', () => {
			const {setupRequireInterception} = require('./ssh2-preload');
			const actualModule = jest.requireActual('module');
			const mockSsh2 = {Client: jest.fn()};

			// Save original require and mock it to return ssh2
			const originalRequire = actualModule.prototype.require;
			let callCount = 0;
			actualModule.prototype.require = jest.fn((id: string) => {
				callCount++;
				if (id === 'ssh2') {
					return mockSsh2;
				}
				return {};
			});

			setupRequireInterception(actualModule, null, null);

			const intercepted = (actualModule.prototype.require as any)('ssh2');

			// Should have called original require
			expect(callCount).toBeGreaterThan(0);
			expect(intercepted).toBe(mockSsh2);

			// Restore
			actualModule.prototype.require = originalRequire;
		});

		test('calls original require for non-ssh2 modules', () => {
			const {setupRequireInterception} = require('./ssh2-preload');
			const actualModule = jest.requireActual('module');
			const mockModule = {foo: 'bar'};

			// Save original require and mock it
			const originalRequire = actualModule.prototype.require;
			actualModule.prototype.require = jest.fn((id: string) => {
				if (id === 'fs') {
					return mockModule;
				}
				return {};
			});

			setupRequireInterception(actualModule, null, null);

			const intercepted = (actualModule.prototype.require as any)('fs');

			expect(intercepted).toBe(mockModule);

			// Restore
			actualModule.prototype.require = originalRequire;
		});
	});
});
