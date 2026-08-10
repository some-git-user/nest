import fs from 'fs';
import {
	_clearCheckWritableDirectoriesOverride,
	_setCheckWritableDirectoriesForTesting,
	checkWritableDirectories,
	formatStartupErrors,
	validateStartup,
} from './startup-check';

describe('startup-check', () => {
	const testBaseDir = '/tmp/nest-test';

	beforeEach(() => {
		// Ensure test directory exists
		fs.mkdirSync(testBaseDir, {recursive: true});
		// Reset NODE_ENV for each test
		delete process.env.NODE_ENV;
		// Clear any test overrides
		_clearCheckWritableDirectoriesOverride();
	});

	afterEach(() => {
		// Cleanup test directory
		try {
			fs.rmSync(testBaseDir, {recursive: true, force: true});
		} catch {
			// Ignore cleanup errors
		}
		// Clear any test overrides
		_clearCheckWritableDirectoriesOverride();
	});

	describe('checkWritableDirectories', () => {
		it('returns directories with correct status', () => {
			const checks = checkWritableDirectories();

			expect(checks).toHaveLength(3);
			expect(checks.map((c) => c.description)).toEqual([
				'Log directory',
				'Coverage directory',
				'Build output directory',
			]);
		});

		it('handles non-existent directories gracefully', () => {
			const checks = checkWritableDirectories();
			expect(checks).toBeInstanceOf(Array);
			checks.forEach((check) => {
				expect(check).toHaveProperty('path');
				expect(check).toHaveProperty('description');
				expect(check).toHaveProperty('isWritable');
			});
		});
	});

	describe('formatStartupErrors', () => {
		it('returns empty string when all directories are writable', () => {
			const mockChecks = [
				{
					path: '/tmp/test/logs',
					description: 'Log directory',
					isWritable: true,
				},
			];

			const result = formatStartupErrors(mockChecks);

			expect(result).toBe('');
		});

		it('formats error message for failed checks', () => {
			const mockChecks = [
				{
					path: '/tmp/test/logs',
					description: 'Log directory',
					isWritable: false,
				},
			];

			const result = formatStartupErrors(mockChecks);

			expect(result).toContain('STARTUP ERROR: Insufficient file permissions');
			expect(result).toContain('Log directory');
			expect(result).toContain('/tmp/test/logs');
			expect(result).toContain('Option 1 - Fix ownership (recommended)');
			expect(result).toContain('sudo chown -R $(whoami)');
			expect(result).toContain('Option 2 - Fix permissions only');
			expect(result).toContain('sudo chmod -R u+rwx');
		});

		it('includes all failed directories in fix commands', () => {
			const mockChecks = [
				{
					path: '/tmp/logs',
					description: 'Log directory',
					isWritable: false,
				},
				{
					path: '/tmp/cache',
					description: 'Plugin cache directory',
					isWritable: false,
				},
			];

			const result = formatStartupErrors(mockChecks);

			expect(result).toContain('sudo chown -R $(whoami) /tmp/logs');
			expect(result).toContain('sudo chown -R $(whoami) /tmp/cache');
			expect(result).toContain('sudo chmod -R u+rwx /tmp/logs');
			expect(result).toContain('sudo chmod -R u+rwx /tmp/cache');
		});

		it('includes error message about root ownership', () => {
			const mockChecks = [
				{
					path: '/tmp/logs',
					description: 'Log directory',
					isWritable: false,
				},
			];

			const result = formatStartupErrors(mockChecks);

			expect(result).toContain('previously run as root');
			expect(result).toContain('using npm run dev:root');
		});
	});

	describe('validateStartup', () => {
		it('does not throw when all directories are writable in development', () => {
			expect(() => validateStartup()).not.toThrow();
		});

		it('throws error when critical directories are not writable in production', () => {
			process.env.NODE_ENV = 'production';
			const mockConsoleError = jest
				.spyOn(console, 'error')
				.mockImplementation();

			// Mock fs.writeFileSync to fail for log directory
			const originalWriteFileSync = fs.writeFileSync;
			jest.spyOn(fs, 'writeFileSync').mockImplementation((pathLike) => {
				const pathStr = pathLike.toString();
				if (pathStr.includes('logs')) {
					throw new Error('EACCES: permission denied');
				}
				return originalWriteFileSync(pathLike, '');
			});

			expect(() => validateStartup()).toThrow('Startup failed');
			expect(mockConsoleError).toHaveBeenCalled();

			jest.restoreAllMocks();
		});

		it('throws error when non-critical directories fail in development', () => {
			const mockConsoleError = jest
				.spyOn(console, 'error')
				.mockImplementation();

			// Mock fs.writeFileSync to fail for coverage directory
			const originalWriteFileSync = fs.writeFileSync;
			jest.spyOn(fs, 'writeFileSync').mockImplementation((pathLike) => {
				const pathStr = pathLike.toString();
				if (pathStr.includes('coverage')) {
					throw new Error('EACCES: permission denied');
				}
				return originalWriteFileSync(pathLike, '');
			});

			expect(() => validateStartup()).toThrow('Startup failed');
			expect(mockConsoleError).toHaveBeenCalled();

			jest.restoreAllMocks();
		});

		it('only checks critical directories in production mode', () => {
			process.env.NODE_ENV = 'production';
			const mockConsoleError = jest
				.spyOn(console, 'error')
				.mockImplementation();

			// Mock fs.writeFileSync to fail only for coverage (non-critical)
			const originalWriteFileSync = fs.writeFileSync;
			jest.spyOn(fs, 'writeFileSync').mockImplementation((pathLike) => {
				const pathStr = pathLike.toString();
				if (pathStr.includes('coverage')) {
					throw new Error('EACCES: permission denied');
				}
				return originalWriteFileSync(pathLike, '');
			});

			// Should not throw because coverage is not critical in production
			expect(() => validateStartup()).not.toThrow();

			jest.restoreAllMocks();
		});

		it('throws error when Plugin directory is not writable in production', () => {
			process.env.NODE_ENV = 'production';
			const mockConsoleError = jest
				.spyOn(console, 'error')
				.mockImplementation();

			// Use the test override function to mock checkWritableDirectories
			_setCheckWritableDirectoriesForTesting(() => [
				{
					path: '/tmp/logs',
					description: 'Log directory',
					isWritable: false,
				},
			]);

			expect(() => validateStartup()).toThrow(
				'Startup failed: 1 critical directory/directories are not writable',
			);
			expect(mockConsoleError).toHaveBeenCalled();

			_clearCheckWritableDirectoriesOverride();
			jest.restoreAllMocks();
		});

		it('throws error when both Log and Plugin directories are not writable in production', () => {
			process.env.NODE_ENV = 'production';
			const mockConsoleError = jest
				.spyOn(console, 'error')
				.mockImplementation();

			_setCheckWritableDirectoriesForTesting(() => [
				{
					path: '/tmp/logs',
					description: 'Log directory',
					isWritable: false,
				},
				{
					path: '/tmp/plugins',
					description: 'Plugin directory',
					isWritable: false,
				},
			]);

			expect(() => validateStartup()).toThrow(
				'Startup failed: 2 critical directory/directories are not writable',
			);
			expect(mockConsoleError).toHaveBeenCalled();

			_clearCheckWritableDirectoriesOverride();
			jest.restoreAllMocks();
		});
	});
});
