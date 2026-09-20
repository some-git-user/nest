import {
	checkDockerUpdates,
	getStatusText,
	isUnsafeRef,
	meta,
	parseComposeImages,
	parseDockerfileImages,
} from './check_docker_updates';

type CommandResult = {ok: boolean; stdout: string; stderr: string};
type DockerRunner = (args: string[]) => Promise<CommandResult>;

type FsLike = {
	readFileSync: (path: string, encoding: 'utf-8') => string;
};

const ok = (stdout: string): CommandResult => ({ok: true, stdout, stderr: ''});
const fail = (stderr: string): CommandResult => ({
	ok: false,
	stdout: '',
	stderr,
});

const localDigest = (digest: string): CommandResult =>
	ok(`["repo@${digest}"]\n`);
const remoteDigest = (digest: string): CommandResult =>
	ok(`{"digest":"${digest}"}`);

/**
 * A runner that answers the three docker sub-commands the plugin issues,
 * driven by a per-reference table of local/remote digests.
 */
const makeRunner = (
	images: Record<
		string,
		{
			local?: string;
			remote?: string;
			localError?: boolean;
			remoteError?: boolean;
		}
	>,
	opts: {ps?: string[]; psError?: string} = {},
): DockerRunner => {
	return async (args: string[]) => {
		// The plugin passes the image reference after a `--` end-of-options
		// separator, so read it from there rather than a fixed index.
		const ref = args[args.indexOf('--') + 1];
		if (args[0] === 'ps') {
			if (opts.psError) {
				return fail(opts.psError);
			}
			return ok(`${(opts.ps ?? []).join('\n')}\n`);
		}
		if (args[0] === 'image' && args[1] === 'inspect') {
			const entry = images[ref];
			if (!entry || entry.localError) {
				return fail(`Error: No such image: ${ref}`);
			}
			if (entry.local === undefined) {
				return ok('[]\n');
			}
			return localDigest(entry.local);
		}
		if (args[0] === 'buildx') {
			const entry = images[ref];
			if (!entry || entry.remoteError || entry.remote === undefined) {
				return fail(
					`Error response from daemon: manifest for ${ref} not found`,
				);
			}
			return remoteDigest(entry.remote);
		}
		return fail(`unexpected args: ${args.join(' ')}`);
	};
};

const makeFs = (files: Record<string, string>): FsLike => ({
	readFileSync: (path: string) => {
		if (!(path in files)) {
			throw new Error(`ENOENT: ${path}`);
		}
		return files[path];
	},
});

const perf = (
	result: {performanceData?: {label: string; value: number | string}[]},
	label: string,
): number | string | undefined =>
	result.performanceData?.find((entry) => entry.label === label)?.value;

describe('check_docker_updates meta', () => {
	test('exposes usage and params', () => {
		expect(meta.usage.http).toContain('/plugins/check-docker-updates');
		expect(meta.usage.shell).toContain('./check_nest.sh check-docker-updates');
		expect(meta.usage.http).toContain('composeFile');
		const names = meta.params.map((param) => param.name);
		expect(names).toEqual(
			expect.arrayContaining([
				'checkRunning',
				'composeFile',
				'dockerfile',
				'severity',
				'ignore',
			]),
		);
	});
});

describe('getStatusText', () => {
	test('maps every code', () => {
		expect(getStatusText(0)).toBe('OK');
		expect(getStatusText(1)).toBe('WARNING');
		expect(getStatusText(2)).toBe('CRITICAL');
		expect(getStatusText(3)).toBe('UNKNOWN');
		expect(getStatusText(999)).toBe('UNKNOWN');
	});
});

describe('parseComposeImages', () => {
	test('extracts image lines and skips variables and comments', () => {
		const compose = [
			'services:',
			'  a:',
			'    image: nginx:1.25',
			'  b:',
			'    image: "redis:7"',
			'  c:',
			"    image: 'postgres:16'",
			'  d:',
			'    image: ${BASE_IMAGE}',
			'  e:',
			'    # image: commented:out',
			'  f:',
			'    build: .',
		].join('\n');
		expect(parseComposeImages(compose)).toEqual([
			'nginx:1.25',
			'redis:7',
			'postgres:16',
		]);
	});
});

describe('parseDockerfileImages', () => {
	test('extracts FROM images, skipping scratch, vars and prior stages', () => {
		const dockerfile = [
			'FROM node:20 AS builder',
			'RUN echo hi',
			'FROM builder AS mid',
			'FROM --platform=linux/amd64 alpine:3.19',
			'FROM scratch',
			'FROM $BASE',
			'# FROM commented:1',
			'from golang:1.22 as final',
		].join('\n');
		expect(parseDockerfileImages(dockerfile)).toEqual([
			'node:20',
			'alpine:3.19',
			'golang:1.22',
		]);
	});
});

describe('checkDockerUpdates config validation', () => {
	test('rejects invalid severity', async () => {
		const result = await checkDockerUpdates({severity: 'nope'}, makeRunner({}));
		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'severity must be 1 (warning) or 2 (critical)',
		);
	});

	test('rejects an out-of-range severity', async () => {
		const result = await checkDockerUpdates({severity: '4'}, makeRunner({}));
		expect(result.code).toBe(3);
		expect(result.message).toContain(
			'severity must be 1 (warning) or 2 (critical)',
		);
	});

	test('rejects invalid checkRunning', async () => {
		const result = await checkDockerUpdates(
			{checkRunning: 'maybe'},
			makeRunner({}),
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('checkRunning must be true or false');
	});

	test('treats blank checkRunning as default (true)', async () => {
		const runner = makeRunner(
			{'nginx:1.25': {local: 'sha256:aaa', remote: 'sha256:aaa'}},
			{ps: ['nginx:1.25']},
		);
		const result = await checkDockerUpdates({checkRunning: '  '}, runner);
		expect(result.code).toBe(0);
	});

	test('honours explicit checkRunning=true', async () => {
		const runner = makeRunner(
			{'nginx:1.25': {local: 'sha256:aaa', remote: 'sha256:aaa'}},
			{ps: ['nginx:1.25']},
		);
		const result = await checkDockerUpdates({checkRunning: 'true'}, runner);
		expect(result.code).toBe(0);
	});
});

describe('checkDockerUpdates digest parsing edge cases', () => {
	const rawRunner = (
		local: CommandResult,
		remote: CommandResult,
	): DockerRunner => {
		return async (args: string[]) => {
			if (args[0] === 'ps') {
				return ok('weird:1\n');
			}
			if (args[0] === 'image') {
				return local;
			}
			return remote;
		};
	};

	test('local digest entry without @ uses whole entry', async () => {
		const result = await checkDockerUpdates(
			{},
			rawRunner(ok('["nginx"]\n'), remoteDigest('sha256:other')),
		);
		expect(result.code).toBe(1);
		expect(result.message).toContain('outdated');
	});

	test('malformed local inspect JSON is treated as local-build', async () => {
		const result = await checkDockerUpdates(
			{},
			rawRunner(ok('not json'), remoteDigest('sha256:aaa')),
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('local-build');
	});

	test('remote digest that is not a string yields unknown', async () => {
		const result = await checkDockerUpdates(
			{},
			rawRunner(localDigest('sha256:aaa'), ok('{"digest":123}')),
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('unknown');
	});

	test('malformed remote JSON yields unknown', async () => {
		const result = await checkDockerUpdates(
			{},
			rawRunner(localDigest('sha256:aaa'), ok('garbage')),
		);
		expect(result.code).toBe(3);
	});
});

describe('checkDockerUpdates sources', () => {
	test('UNKNOWN when no images found', async () => {
		const result = await checkDockerUpdates({}, makeRunner({}, {ps: []}));
		expect(result.code).toBe(3);
		expect(result.message).toContain('no container images found');
	});

	test('UNKNOWN when running-container discovery fails', async () => {
		const result = await checkDockerUpdates(
			{},
			makeRunner({}, {psError: 'cannot connect to daemon'}),
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('cannot connect to daemon');
	});

	test('UNKNOWN when a given compose file cannot be read', async () => {
		const result = await checkDockerUpdates(
			{composeFile: '/nope/docker-compose.yml', checkRunning: 'false'},
			makeRunner({}),
			makeFs({}),
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('compose file');
		expect(result.message).toContain('could not be read');
	});

	test('UNKNOWN when a given Dockerfile cannot be read', async () => {
		const result = await checkDockerUpdates(
			{dockerfile: '/nope/Dockerfile', checkRunning: 'false'},
			makeRunner({}),
			makeFs({}),
		);
		expect(result.code).toBe(3);
		expect(result.message).toContain('Dockerfile');
	});

	test('collects images from compose and dockerfile sources', async () => {
		const runner = makeRunner(
			{
				'nginx:1.25': {local: 'sha256:aaa', remote: 'sha256:bbb'},
				'alpine:3.19': {local: 'sha256:ccc', remote: 'sha256:ccc'},
			},
			{ps: []},
		);
		const fsImpl = makeFs({
			'/c/docker-compose.yml': 'services:\n  a:\n    image: nginx:1.25\n',
			'/c/Dockerfile': 'FROM alpine:3.19\n',
		});
		const result = await checkDockerUpdates(
			{
				checkRunning: 'false',
				composeFile: '/c/docker-compose.yml',
				dockerfile: '/c/Dockerfile',
			},
			runner,
			fsImpl,
		);
		expect(result.code).toBe(1);
		expect(result.message).toContain('nginx:1.25');
		expect(perf(result, 'images_total')).toBe(2);
		expect(perf(result, 'images_outdated')).toBe(1);
		expect(perf(result, 'images_up_to_date')).toBe(1);
	});
});

describe('checkDockerUpdates evaluation', () => {
	test('OK when all comparable images up to date', async () => {
		const runner = makeRunner(
			{
				'nginx:1.25': {local: 'sha256:aaa', remote: 'sha256:aaa'},
				'redis:7': {local: 'sha256:bbb', remote: 'sha256:bbb'},
			},
			{ps: ['nginx:1.25', 'redis:7']},
		);
		const result = await checkDockerUpdates({}, runner);
		expect(result.code).toBe(0);
		expect(result.message).toContain('all 2 image(s) up to date');
		expect(perf(result, 'images_up_to_date')).toBe(2);
	});

	test('WARNING when an image is outdated (default severity)', async () => {
		const runner = makeRunner(
			{'mongo:7.0': {local: 'sha256:old', remote: 'sha256:new'}},
			{ps: ['mongo:7.0']},
		);
		const result = await checkDockerUpdates({}, runner);
		expect(result.code).toBe(1);
		expect(result.message).toContain('1 of 1 image(s) outdated');
		expect(result.message).toContain('mongo:7.0');
	});

	test('WARNING when severity=1 and outdated', async () => {
		const runner = makeRunner(
			{'mongo:7.0': {local: 'sha256:old', remote: 'sha256:new'}},
			{ps: ['mongo:7.0']},
		);
		const result = await checkDockerUpdates({severity: '1'}, runner);
		expect(result.code).toBe(1);
	});

	test('CRITICAL when severity=2 and outdated', async () => {
		const runner = makeRunner(
			{'mongo:7.0': {local: 'sha256:old', remote: 'sha256:new'}},
			{ps: ['mongo:7.0']},
		);
		const result = await checkDockerUpdates({severity: '2'}, runner);
		expect(result.code).toBe(2);
	});

	// The HTTP route coerces numeric/boolean query params to real JS numbers and
	// booleans (see coerceParams), so the plugin must tolerate non-string values.
	test('severity passed as a number (route-coerced) is handled', async () => {
		const runner = makeRunner(
			{'mongo:7.0': {local: 'sha256:old', remote: 'sha256:new'}},
			{ps: ['mongo:7.0']},
		);
		const result = await checkDockerUpdates({severity: 2}, runner);
		expect(result.code).toBe(2);
	});

	test('checkRunning passed as a boolean (route-coerced) is handled', async () => {
		const runner = makeRunner(
			{'mongo:7.0': {local: 'sha256:old', remote: 'sha256:new'}},
			{ps: ['mongo:7.0']},
		);
		const result = await checkDockerUpdates(
			{checkRunning: true, severity: 1},
			runner,
		);
		expect(result.code).toBe(1);
	});

	test('local-build images are skipped and noted', async () => {
		const runner = makeRunner(
			{
				'myapp:latest': {},
				'nginx:1.25': {local: 'sha256:aaa', remote: 'sha256:aaa'},
			},
			{ps: ['myapp:latest', 'nginx:1.25']},
		);
		const result = await checkDockerUpdates({}, runner);
		expect(result.code).toBe(0);
		expect(result.message).toContain('1 local-build');
		expect(perf(result, 'images_local_build')).toBe(1);
	});

	test('UNKNOWN when nothing comparable (all local-build)', async () => {
		const runner = makeRunner({'myapp:latest': {}}, {ps: ['myapp:latest']});
		const result = await checkDockerUpdates({}, runner);
		expect(result.code).toBe(3);
		expect(result.message).toContain('no image digests could be compared');
		expect(result.message).toContain('1 local-build');
	});

	test('unknown when remote digest cannot be fetched', async () => {
		const runner = makeRunner(
			{'nginx:1.25': {local: 'sha256:aaa', remoteError: true}},
			{ps: ['nginx:1.25']},
		);
		const result = await checkDockerUpdates({}, runner);
		expect(result.code).toBe(3);
		expect(perf(result, 'images_unknown')).toBe(1);
		expect(result.message).toContain('1 unknown');
	});

	test('unknown when local inspect errors', async () => {
		const runner = makeRunner(
			{'ghost:1': {localError: true}},
			{ps: ['ghost:1']},
		);
		const result = await checkDockerUpdates({}, runner);
		expect(result.code).toBe(3);
		expect(perf(result, 'images_unknown')).toBe(1);
	});

	test('deduplicates references across sources', async () => {
		const runner = makeRunner(
			{'nginx:1.25': {local: 'sha256:aaa', remote: 'sha256:aaa'}},
			{ps: ['nginx:1.25', 'nginx:1.25']},
		);
		const result = await checkDockerUpdates({}, runner);
		expect(perf(result, 'images_total')).toBe(1);
	});

	test('ignore filter skips matching references', async () => {
		const runner = makeRunner(
			{
				'mongo:7.0': {local: 'sha256:old', remote: 'sha256:new'},
				'nginx:1.25': {local: 'sha256:aaa', remote: 'sha256:aaa'},
			},
			{ps: ['mongo:7.0', 'nginx:1.25']},
		);
		const result = await checkDockerUpdates({ignore: 'mongo'}, runner);
		expect(result.code).toBe(0);
		expect(perf(result, 'images_total')).toBe(1);
	});
});

describe('checkDockerUpdates message formatting', () => {
	test('truncates long outdated lists', async () => {
		const images: Record<string, {local: string; remote: string}> = {};
		const ps: string[] = [];
		for (let i = 0; i < 12; i += 1) {
			const ref = `img${i}:latest`;
			images[ref] = {local: 'sha256:old', remote: 'sha256:new'};
			ps.push(ref);
		}
		const result = await checkDockerUpdates({}, makeRunner(images, {ps}));
		expect(result.code).toBe(1);
		expect(result.message).toContain('+2 more');
	});

	test('appends source errors even when images are outdated', async () => {
		const runner = makeRunner(
			{'mongo:7.0': {local: 'sha256:old', remote: 'sha256:new'}},
			{ps: ['mongo:7.0']},
		);
		const result = await checkDockerUpdates(
			{composeFile: '/missing.yml'},
			runner,
			makeFs({}),
		);
		expect(result.code).toBe(1);
		expect(result.message).toContain(
			'compose file /missing.yml could not be read',
		);
	});
});

describe('checkDockerUpdates default runner', () => {
	test('uses default docker runner when none provided', async () => {
		jest.resetModules();
		const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
		const execFileMock = jest.fn(
			(
				_file: string,
				args: string[],
				callback: (error: Error | null, stdout: string, stderr: string) => void,
			) => {
				if (args[0] === 'ps') {
					callback(null, 'nginx:1.25\n', '');
				} else if (args[0] === 'image') {
					callback(null, '["nginx@sha256:aaa"]\n', '');
				} else {
					callback(null, '{"digest":"sha256:aaa"}', '');
				}
			},
		);
		(execFileMock as unknown as Record<symbol, unknown>)[promisifyCustom] = (
			_file: string,
			args: string[],
		) => {
			if (args[0] === 'ps') {
				return Promise.resolve({stdout: 'nginx:1.25\n', stderr: ''});
			}
			if (args[0] === 'image') {
				return Promise.resolve({stdout: '["nginx@sha256:aaa"]\n', stderr: ''});
			}
			return Promise.resolve({stdout: '{"digest":"sha256:aaa"}', stderr: ''});
		};

		let isolated:
			| {
					checkDockerUpdates: (
						params?: Record<string, string>,
					) => Promise<{code: number; message: string}>;
			  }
			| undefined;
		jest.isolateModules(() => {
			jest.doMock('child_process', () => ({execFile: execFileMock}));
			isolated = jest.requireActual<typeof import('./check_docker_updates')>(
				'./check_docker_updates',
			);
		});
		if (!isolated) {
			throw new Error('Failed to load isolated module');
		}
		const result = await isolated.checkDockerUpdates();
		expect(result.code).toBe(0);
		expect(result.message).toContain('up to date');

		jest.dontMock('child_process');
		jest.resetModules();
	});

	test('default runner reports failure as unknown', async () => {
		jest.resetModules();
		const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
		const execFileMock = jest.fn();
		(execFileMock as unknown as Record<symbol, unknown>)[promisifyCustom] =
			() => Promise.reject(new Error('docker: command not found'));

		let isolated:
			| {
					checkDockerUpdates: (
						params?: Record<string, string>,
					) => Promise<{code: number; message: string}>;
			  }
			| undefined;
		jest.isolateModules(() => {
			jest.doMock('child_process', () => ({execFile: execFileMock}));
			isolated = jest.requireActual<typeof import('./check_docker_updates')>(
				'./check_docker_updates',
			);
		});
		if (!isolated) {
			throw new Error('Failed to load isolated module');
		}
		const result = await isolated.checkDockerUpdates();
		expect(result.code).toBe(3);
		expect(result.message).toContain('docker: command not found');

		jest.dontMock('child_process');
		jest.resetModules();
	});

	test('default runner falls back to generic message when error has none', async () => {
		jest.resetModules();
		const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
		const execFileMock = jest.fn();
		(execFileMock as unknown as Record<symbol, unknown>)[promisifyCustom] =
			() => Promise.reject({});

		let isolated:
			| {
					checkDockerUpdates: (
						params?: Record<string, string>,
					) => Promise<{code: number; message: string}>;
			  }
			| undefined;
		jest.isolateModules(() => {
			jest.doMock('child_process', () => ({execFile: execFileMock}));
			isolated = jest.requireActual<typeof import('./check_docker_updates')>(
				'./check_docker_updates',
			);
		});
		if (!isolated) {
			throw new Error('Failed to load isolated module');
		}
		const result = await isolated.checkDockerUpdates();
		expect(result.code).toBe(3);
		expect(result.message).toContain('docker command failed');

		jest.dontMock('child_process');
		jest.resetModules();
	});
});

describe('checkDockerUpdates argument-injection guard', () => {
	test('isUnsafeRef flags a leading dash', () => {
		expect(isUnsafeRef('--privileged')).toBe(true);
		expect(isUnsafeRef('-H')).toBe(true);
		expect(isUnsafeRef('-')).toBe(true);
		expect(isUnsafeRef('nginx:1.25')).toBe(false);
		expect(isUnsafeRef('alpine')).toBe(false);
	});

	test('drops a dash-prefixed reference from a compose file and reports it', async () => {
		const runner = makeRunner(
			{'nginx:1.25': {local: 'sha256:aaa', remote: 'sha256:bbb'}},
			{ps: []},
		);
		const fsImpl = makeFs({
			'/c/docker-compose.yml':
				'services:\n  a:\n    image: --privileged\n  b:\n    image: nginx:1.25\n',
		});

		const result = await checkDockerUpdates(
			{checkRunning: 'false', composeFile: '/c/docker-compose.yml'},
			runner,
			fsImpl,
		);

		// The unsafe ref never reaches the CLI; only the safe one is counted.
		expect(result.message).toContain('skipped unsafe image reference');
		expect(result.message).toContain('--privileged');
		expect(perf(result, 'images_total')).toBe(1);
		expect(perf(result, 'images_outdated')).toBe(1);
	});

	test('a file of only unsafe references reports nothing to check', async () => {
		const runner = makeRunner({}, {ps: []});
		const fsImpl = makeFs({
			'/c/docker-compose.yml': 'services:\n  a:\n    image: -Htcp://evil\n',
		});

		const result = await checkDockerUpdates(
			{checkRunning: 'false', composeFile: '/c/docker-compose.yml'},
			runner,
			fsImpl,
		);

		expect(result.code).toBe(3);
		expect(result.message).toContain('no container images found');
		expect(result.message).toContain('skipped unsafe image reference');
	});

	test('passes the reference after a -- end-of-options separator', async () => {
		const seenArgs: string[][] = [];
		const recordingRunner: DockerRunner = async (args) => {
			seenArgs.push(args);
			return fail('no such image');
		};

		await checkDockerUpdates(
			{checkRunning: 'false', composeFile: '/c/x.yml'},
			recordingRunner,
			makeFs({'/c/x.yml': 'services:\n  a:\n    image: nginx:1.25\n'}),
		);

		// Every inspect call must place `--` immediately before the reference,
		// so the CLI treats it as a positional argument, never an option.
		expect(seenArgs.length).toBeGreaterThan(0);
		for (const args of seenArgs) {
			const dashIndex = args.indexOf('--');
			expect(dashIndex).toBeGreaterThan(-1);
			expect(args[dashIndex + 1]).toBe('nginx:1.25');
		}
	});

	test('an unsafe reference that is also ignored is not double-reported', async () => {
		const runner = makeRunner({}, {ps: []});
		const fsImpl = makeFs({
			'/c/docker-compose.yml': 'services:\n  a:\n    image: --privileged\n',
		});

		const result = await checkDockerUpdates(
			{
				checkRunning: 'false',
				composeFile: '/c/docker-compose.yml',
				ignore: 'privileged',
			},
			runner,
			fsImpl,
		);

		// ignoreMatch wins, so it is filtered before the unsafe check and never
		// appears in the skipped-unsafe list.
		expect(result.message).not.toContain('skipped unsafe image reference');
	});
});
