import {runCli} from './dispatch';

jest.mock('../config/env', () => ({
	env: {PLUGINS_DIR: 'plugins'},
	CONFIG_FILE_PATH: '/etc/nest/nest.conf',
}));

jest.mock('./plugins-hash', () => ({
	runPluginsHash: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {runPluginsHash} = require('./plugins-hash') as {
	runPluginsHash: jest.Mock;
};

describe('cli runCli', () => {
	let lines: string[];
	let log: (line: string) => void;

	beforeEach(() => {
		lines = [];
		log = (line) => lines.push(line);
		process.exitCode = 0;
		runPluginsHash.mockReset();
	});

	test('returns false for a bare server start (dev argv)', () => {
		expect(runCli(['/usr/bin/node', 'dist/server-preload.js'], log)).toBe(
			false,
		);
		expect(lines).toEqual([]);
	});

	test('returns false for a bare server start run via tsx (.ts script path)', () => {
		// `npm run dev` launches `tsx src/server-preload.ts --inspect`, so argv[1]
		// is a .ts path. It must be stripped, not treated as an unknown command.
		expect(
			runCli(
				[
					'/usr/bin/node',
					'/home/user/development/nest/src/server-preload.ts',
					'--inspect',
				],
				log,
			),
		).toBe(false);
		expect(lines).toEqual([]);
	});

	test('returns false for a bare server start (SEA argv)', () => {
		expect(runCli(['/usr/bin/nest'], log)).toBe(false);
	});

	test('returns false when only server flags are present', () => {
		expect(
			runCli(['/usr/bin/nest', '--configPath', '/etc/nest/nest.conf'], log),
		).toBe(false);
	});

	test('runs plugins hash and reports updates', () => {
		runPluginsHash.mockReturnValue({
			manifests: [
				{name: 'acme', status: 'updated', hash: 'h'},
				{name: 'manual', status: 'unhashed', hash: 'h'},
				{name: 'ok', status: 'unchanged', hash: 'h'},
			],
			configHash: {content: '', status: 'updated', hash: 'h'},
			warnings: ['some warning'],
			changes: 3,
		});

		const handled = runCli(['/usr/bin/nest', 'plugins', 'hash'], log);

		expect(handled).toBe(true);
		expect(runPluginsHash).toHaveBeenCalledWith(
			expect.stringContaining('plugins'),
			'/etc/nest/nest.conf',
		);
		expect(lines.join('\n')).toContain('! some warning');
		expect(lines.join('\n')).toContain('acme (manifest updated)');
		expect(lines.join('\n')).toContain('manual (no hash declared');
		expect(lines.join('\n')).toContain('LOCAL_CONFIG_HASH (config updated)');
		expect(lines.join('\n')).toContain('3 plugin(s) updated');
	});

	test('reports config hash added', () => {
		runPluginsHash.mockReturnValue({
			manifests: [],
			configHash: {content: '', status: 'added', hash: 'h'},
			warnings: [],
			changes: 1,
		});

		runCli(['/usr/bin/nest', 'plugins', 'hash'], log);

		expect(lines.join('\n')).toContain('LOCAL_CONFIG_HASH (config added)');
	});

	test('does not report a config change when the hash is unchanged', () => {
		runPluginsHash.mockReturnValue({
			manifests: [],
			configHash: {content: '', status: 'unchanged', hash: 'h'},
			warnings: [],
			changes: 0,
		});

		runCli(['/usr/bin/nest', 'plugins', 'hash'], log);

		const out = lines.join('\n');
		expect(out).not.toContain('LOCAL_CONFIG_HASH');
		expect(out).toContain('All hashes already up to date.');
	});

	test('reports all up to date when nothing changed', () => {
		runPluginsHash.mockReturnValue({
			manifests: [],
			warnings: [],
			changes: 0,
		});

		runCli(['/usr/bin/nest', 'plugins', 'hash'], log);

		expect(lines.join('\n')).toContain('All hashes already up to date.');
	});

	test('reports failure and sets exit code', () => {
		runPluginsHash.mockImplementation(() => {
			throw new Error('EACCES');
		});

		runCli(['/usr/bin/nest', 'plugins', 'hash'], log);

		expect(lines.join('\n')).toContain('Failed to update plugin hashes');
		expect(process.exitCode).toBe(1);
	});

	test('unknown plugins subcommand prints usage', () => {
		runCli(['/usr/bin/nest', 'plugins', 'bogus'], log);

		expect(lines.join('\n')).toContain('Unknown "nest plugins" subcommand');
		expect(process.exitCode).toBe(1);
	});

	test('plugins with no subcommand prints usage', () => {
		runCli(['/usr/bin/nest', 'plugins'], log);

		expect(lines.join('\n')).toContain('Unknown "nest plugins" subcommand');
	});

	test('help prints usage and is handled', () => {
		expect(runCli(['/usr/bin/nest', 'help'], log)).toBe(true);
		expect(lines.join('\n')).toContain('Usage:');
	});

	test('unknown command prints usage and sets exit code', () => {
		expect(runCli(['/usr/bin/nest', 'frobnicate'], log)).toBe(true);
		expect(lines.join('\n')).toContain('Unknown command: frobnicate');
		expect(process.exitCode).toBe(1);
	});

	test('uses console.log when no log function is provided', () => {
		const consoleSpy = jest
			.spyOn(console, 'log')
			.mockImplementation(() => undefined);

		expect(runCli(['/usr/bin/nest', 'help'])).toBe(true);

		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});
