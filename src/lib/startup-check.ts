import fs from 'fs';
import path from 'path';
import {env} from '../config/env';

interface DirectoryCheck {
	path: string;
	description: string;
	isWritable: boolean;
	error?: string;
}

/**
 * Test-only hook to override checkWritableDirectories implementation.
 *
 * This function allows tests to provide a custom implementation of checkWritableDirectories
 * without fighting Jest's module mocking system. It implements a dependency injection
 * pattern for testability while keeping the production code clean.
 *
 * IMPORTANT: This is for testing purposes only. Do not use in production code.
 * Always call _clearCheckWritableDirectoriesOverride() in afterEach to prevent
 * test pollution.
 *
 * @param fn - Custom implementation to use instead of the real checkWritableDirectories
 * @example
 * ```typescript
 * beforeEach(() => {
 *   _setCheckWritableDirectoriesForTesting(() => [
 *     { path: '/tmp/logs', description: 'Log directory', isWritable: false }
 *   ]);
 * });
 *
 * afterEach(() => {
 *   _clearCheckWritableDirectoriesOverride();
 * });
 * ```
 */
export function _setCheckWritableDirectoriesForTesting(
	fn: () => Array<{path: string; description: string; isWritable: boolean}>,
): void {
	_checkWritableDirectoriesOverride = fn;
}

/**
 * Clears the test override for checkWritableDirectories.
 *
 * This should be called in afterEach hooks to prevent test pollution and ensure
 * subsequent tests use the real implementation.
 *
 * IMPORTANT: This is for testing purposes only. Do not use in production code.
 *
 * @example
 * ```typescript
 * afterEach(() => {
 *   _clearCheckWritableDirectoriesOverride();
 * });
 * ```
 */
export function _clearCheckWritableDirectoriesOverride(): void {
	_checkWritableDirectoriesOverride = undefined;
}

/**
 * Internal override function for checkWritableDirectories (test-only).
 *
 * When set, this function will be called instead of the real implementation.
 * Undefined in production.
 */
let _checkWritableDirectoriesOverride:
	| (() => Array<{path: string; description: string; isWritable: boolean}>)
	| undefined;

export function checkWritableDirectories(): Array<{
	path: string;
	description: string;
	isWritable: boolean;
}> {
	// Use override if set (for testing)
	if (_checkWritableDirectoriesOverride) {
		return _checkWritableDirectoriesOverride();
	}

	const checks: DirectoryCheck[] = [];

	// Check log directory
	const logFilePath = env.LOG_FILE_PATH;
	const logDir = path.dirname(logFilePath);
	checks.push({
		path: logDir,
		description: 'Log directory',
		isWritable: canWriteToDirectory(logDir),
	});

	// Check coverage directory (development only - for test coverage reports)
	if (process.env.NODE_ENV !== 'production') {
		const coverageDir = path.join(process.cwd(), 'coverage');
		checks.push({
			path: coverageDir,
			description: 'Coverage directory',
			isWritable: canWriteToDirectory(coverageDir),
		});
	}

	// Check dist directory (development only - for build output)
	if (process.env.NODE_ENV !== 'production') {
		const distDir = path.join(process.cwd(), 'dist');
		checks.push({
			path: distDir,
			description: 'Build output directory',
			isWritable: canWriteToDirectory(distDir),
		});
	}

	return checks;
}

function canWriteToDirectory(dirPath: string): boolean {
	try {
		// Try to create a temporary file
		const testFile = path.join(dirPath, '.write-test-' + Date.now());
		fs.mkdirSync(dirPath, {recursive: true});
		fs.writeFileSync(testFile, '');
		fs.unlinkSync(testFile);
		return true;
	} catch (err) {
		return false;
	}
}

export function formatStartupErrors(checks: DirectoryCheck[]): string {
	const failedChecks = checks.filter((check) => !check.isWritable);

	if (failedChecks.length === 0) {
		return '';
	}

	const lines: string[] = [];
	lines.push('');
	lines.push('='.repeat(80));
	lines.push('STARTUP ERROR: Insufficient file permissions');
	lines.push('='.repeat(80));
	lines.push('');
	lines.push(
		'The application cannot start because it cannot write to the following directories:',
	);
	lines.push('');

	for (const check of failedChecks) {
		lines.push(`  - ${check.description}`);
		lines.push(`    Path: ${check.path}`);
		lines.push('');
	}

	lines.push('This typically occurs when:');
	lines.push(
		'  - The application was previously run as root (e.g., using npm run dev:root)',
	);
	lines.push('  - Directories or files were created with root ownership');
	lines.push('');
	lines.push('To fix this issue, run one of the following commands:');
	lines.push('');
	lines.push('Option 1 - Fix ownership (recommended):');

	for (const check of failedChecks) {
		lines.push(`  sudo chown -R $(whoami) ${check.path}`);
	}

	lines.push(
		'  This changes the owner of all directories to your current user.',
	);
	lines.push(
		'  Use this when you want YOUR user to own all application files.',
	);
	lines.push('');
	lines.push('Option 2 - Fix permissions only:');

	for (const check of failedChecks) {
		lines.push(`  sudo chmod -R u+rwx ${check.path}`);
	}

	lines.push(
		'  This gives your user read/write/execute permissions on existing files.',
	);
	lines.push('  Use this when root should keep ownership but you need access.');
	lines.push('');
	lines.push('After fixing, restart the application as your normal user.');
	lines.push('');
	lines.push('='.repeat(80));
	lines.push('');

	return lines.join('\n');
}

export function validateStartup(): void {
	const checks = checkWritableDirectories();
	const failedChecks = checks.filter((check) => !check.isWritable);

	// In production, only critical directories (log, plugins) should cause startup failure
	// Development-only directories (coverage, dist) are filtered out
	if (process.env.NODE_ENV === 'production') {
		const criticalChecks = checks.filter(
			(check) =>
				check.description.includes('Log') ||
				check.description.includes('Plugin'),
		);
		const criticalFailed = criticalChecks.filter((check) => !check.isWritable);
		if (criticalFailed.length > 0) {
			const errorMessage = formatStartupErrors(criticalFailed);
			console.error(errorMessage);
			throw new Error(
				`Startup failed: ${criticalFailed.length} critical directory/directories are not writable. ` +
					`Please fix the permissions before running the application.`,
			);
		}
		return;
	}

	if (failedChecks.length > 0) {
		const errorMessage = formatStartupErrors(checks);
		console.error(errorMessage);
		throw new Error(
			`Startup failed: ${failedChecks.length} directory/directories are not writable. ` +
				`Please fix the permissions before running the application.`,
		);
	}
}
