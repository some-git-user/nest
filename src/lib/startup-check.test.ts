import fs from 'fs';
import {checkWritableDirectories, formatStartupErrors} from './startup-check';

describe('startup-check', () => {
	const testBaseDir = '/tmp/nest-test';

	beforeEach(() => {
		// Ensure test directory exists
		fs.mkdirSync(testBaseDir, {recursive: true});
	});

	afterEach(() => {
		// Cleanup test directory
		try {
			fs.rmSync(testBaseDir, {recursive: true, force: true});
		} catch {
			// Ignore cleanup errors
		}
	});

	describe('checkWritableDirectories', () => {
		it('returns directories with correct status', () => {
			const checks = checkWritableDirectories();

			expect(checks).toHaveLength(4);
			expect(checks.map((c) => c.description)).toEqual([
				'Log directory',
				'Plugin cache directory',
				'Coverage directory',
				'Build output directory',
			]);
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
				{
					path: '/tmp/test/plugins/plugin-cache',
					description: 'Plugin cache directory',
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
				{
					path: '/tmp/test/plugins/plugin-cache',
					description: 'Plugin cache directory',
					isWritable: false,
				},
			];

			const result = formatStartupErrors(mockChecks);

			expect(result).toContain('STARTUP ERROR: Insufficient file permissions');
			expect(result).toContain('Log directory');
			expect(result).toContain('/tmp/test/logs');
			expect(result).toContain('Plugin cache directory');
			expect(result).toContain('/tmp/test/plugins/plugin-cache');
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
	});
});
