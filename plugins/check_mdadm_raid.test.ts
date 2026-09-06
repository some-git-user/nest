import {
	checkMdadmRaid,
	normalizeArrayName,
	parseMdstat,
} from './check_mdadm_raid';

type PerfData = {
	label: string;
	value: number | string;
	uom: string;
};
type Result = {
	message: string;
	code: number;
	performanceData: PerfData[];
};
type CheckFn = (params: {
	array?: string;
	warnOnRebuild?: boolean | string;
	warnOnSync?: boolean | string;
	requireArray?: boolean | string;
	fs?: {
		existsSync: (path: string) => boolean;
		readFileSync: (path: string, encoding: 'utf-8') => string;
	};
}) => Result;

// A healthy mdstat sample plus a matching in-memory sysfs, so a test can pick
// exactly which sysfs files exist and what they contain.
const HEALTHY_MDSTAT = `Personalities : [raid1] [raid6] [raid5]
md0 : active raid1 sda1[0] sdb1[1]
      1952896000 blocks super 1.2 [2/2] [UU]
      bitmap: 0/15 pages [0KB], 65536KB chunk

unused devices: <none>
`;

/**
 * Build a fake fs exposing /proc/mdstat plus a map of sysfs file contents.
 * Any sysfs path not present in `sysfs` reports as non-existent.
 */
const makeFs = (
	mdstat: string,
	sysfs: Record<string, string> = {},
): {
	existsSync: (path: string) => boolean;
	readFileSync: (path: string, encoding: 'utf-8') => string;
} => {
	const files = new Map<string, string>([['/proc/mdstat', mdstat]]);
	for (const [name, value] of Object.entries(sysfs)) {
		files.set(`/sys/block/md0/md/${name}`, value);
	}
	return {
		existsSync: (path: string) => files.has(path),
		readFileSync: (path: string) => {
			const value = files.get(path);
			if (value === undefined) {
				throw new Error(`ENOENT: ${path}`);
			}
			return value;
		},
	};
};

const loadCheck = (): CheckFn =>
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	require('./check_mdadm_raid').checkMdadmRaid as CheckFn;

describe('check_mdadm_raid plugin', () => {
	afterEach(() => {
		jest.resetModules();
		jest.restoreAllMocks();
	});

	describe('parseMdstat', () => {
		test('parses a healthy raid1 array with disk summary', () => {
			const arrays = parseMdstat(HEALTHY_MDSTAT);
			expect(arrays).toHaveLength(1);
			expect(arrays[0].name).toBe('md0');
			expect(arrays[0].state).toBe('active');
			expect(arrays[0].level).toBe('raid1');
			expect(arrays[0].disksTotal).toBe(2);
			expect(arrays[0].disksActive).toBe(2);
			expect(arrays[0].statusFlags).toBe('UU');
			expect(arrays[0].devices).toEqual([
				{name: 'sda1', slot: 0, faulty: false, spare: false},
				{name: 'sdb1', slot: 1, faulty: false, spare: false},
			]);
		});

		test('marks faulty and spare device flags', () => {
			const mdstat = `md1 : active raid1 sda1[0](F) sdc1[2](S)
      100 blocks [2/1] [U_]
`;
			const arrays = parseMdstat(mdstat);
			expect(arrays[0].devices).toEqual([
				{name: 'sda1', slot: 0, faulty: true, spare: false},
				{name: 'sdc1', slot: 2, faulty: false, spare: true},
			]);
		});

		test('parses sync progress on a continuation line', () => {
			const mdstat = `md2 : active raid5 sda1[0] sdb1[1] sdc1[2]
      100 blocks super 1.2 [3/3] [UUU]
      [>....................]  recovery =  12.3% (1234/10000) finish=1.2min speed=100K/sec
`;
			const arrays = parseMdstat(mdstat);
			expect(arrays[0].syncAction).toBe('recovery');
			expect(arrays[0].syncPercent).toBe(12.3);
		});

		test('ignores non-md header lines and bookkeeping lines', () => {
			const mdstat = `Personalities : [raid1]
unused devices: <none>
md0 : active raid1 sda1[0]
      100 blocks [1/1] [U]
`;
			const arrays = parseMdstat(mdstat);
			expect(arrays).toHaveLength(1);
			expect(arrays[0].name).toBe('md0');
		});

		test('ignores continuation lines that appear before any array header', () => {
			const mdstat = `      100 blocks [2/1] [U_]
md0 : active raid1 sda1[0]
      100 blocks [1/1] [U]
`;
			const arrays = parseMdstat(mdstat);
			expect(arrays).toHaveLength(1);
			expect(arrays[0].disksTotal).toBe(1);
		});

		test('resets the current array on a blank line', () => {
			const mdstat = `md0 : active raid1 sda1[0]
      100 blocks [1/1] [U]

      [>....................]  recovery =  50.0% (1/2)
`;
			const arrays = parseMdstat(mdstat);
			expect(arrays[0].syncAction).toBeUndefined();
		});

		test('leaves level empty when no recognised level token is present', () => {
			const mdstat = `md0 : active sda1[0]
      100 blocks [1/1] [U]
`;
			const arrays = parseMdstat(mdstat);
			expect(arrays[0].level).toBe('');
		});
	});

	describe('normalizeArrayName', () => {
		test('accepts a bare md name', () => {
			expect(normalizeArrayName('md0')).toEqual({name: 'md0'});
		});

		test('reduces a /dev path to its last segment', () => {
			expect(normalizeArrayName('/dev/md0')).toEqual({name: 'md0'});
		});

		test('rejects a container path whose last segment is not an md name', () => {
			const result = normalizeArrayName('/dev/md/data');
			expect(result.error).toContain('Invalid array name');
		});

		test('rejects an empty name', () => {
			expect(normalizeArrayName('   ')).toEqual({
				error: 'Array name must not be empty',
			});
		});

		test('rejects a non-md name', () => {
			const result = normalizeArrayName('sda1');
			expect(result.error).toContain('Invalid array name');
		});

		test('rejects a name made only of separators', () => {
			const result = normalizeArrayName('///');
			expect(result.error).toContain('Invalid array name');
		});
	});

	describe('checkMdadmRaid', () => {
		test('returns OK for a healthy array', () => {
			const check = loadCheck();
			const result = check({
				fs: makeFs(HEALTHY_MDSTAT, {array_state: 'clean\n'}),
			});
			expect(result.code).toBe(0);
			expect(result.message).toContain('md0 (raid1) is clean, 2/2 devices');
			expect(result.performanceData[0]).toEqual({
				label: 'arrays_total',
				value: 1,
				uom: '',
			});
		});

		test('returns CRITICAL when an array is broken', () => {
			const check = loadCheck();
			const result = check({
				fs: makeFs(HEALTHY_MDSTAT, {array_state: 'broken\n'}),
			});
			expect(result.code).toBe(2);
			expect(result.message).toContain('md0 (raid1) is broken');
		});

		test('returns CRITICAL when degraded via status flags', () => {
			const check = loadCheck();
			const mdstat = `md0 : active raid1 sda1[0] sdb1[1]
      100 blocks [2/1] [U_]
`;
			const result = check({fs: makeFs(mdstat, {array_state: 'clean\n'})});
			expect(result.code).toBe(2);
			expect(result.message).toContain('is degraded: 1 missing device(s)');
		});

		test('returns CRITICAL when degraded via a faulty device flag', () => {
			const check = loadCheck();
			const mdstat = `md0 : active raid1 sda1[0](F) sdb1[1]
      100 blocks [2/2] [UU]
`;
			const result = check({fs: makeFs(mdstat, {array_state: 'clean\n'})});
			expect(result.code).toBe(2);
			expect(result.message).toContain('is degraded: 1 missing device(s)');
		});

		test('returns CRITICAL when sysfs degraded is non-zero', () => {
			const check = loadCheck();
			const result = check({
				fs: makeFs(HEALTHY_MDSTAT, {
					array_state: 'clean\n',
					degraded: '2\n',
				}),
			});
			expect(result.code).toBe(2);
			expect(result.message).toContain('is degraded: 2 missing device(s)');
		});

		test('counts degradation from a faulty device when no status flags are present', () => {
			const check = loadCheck();
			const mdstat = `md0 : active raid1 sda1[0](F)
      100 blocks super 1.2
`;
			const result = check({fs: makeFs(mdstat, {array_state: 'clean\n'})});
			expect(result.code).toBe(2);
			expect(result.message).toContain('is degraded: 1 missing device(s)');
		});

		test('returns CRITICAL when a scrub found mismatches', () => {
			const check = loadCheck();
			const result = check({
				fs: makeFs(HEALTHY_MDSTAT, {
					array_state: 'clean\n',
					mismatch_count: '3\n',
				}),
			});
			expect(result.code).toBe(2);
			expect(result.message).toContain('has 3 consistency mismatch(es)');
		});

		test('returns WARNING during a rebuild by default', () => {
			const check = loadCheck();
			const result = check({
				fs: makeFs(HEALTHY_MDSTAT, {
					array_state: 'active\n',
					sync_action: 'recovery\n',
				}),
			});
			expect(result.code).toBe(1);
			expect(result.message).toContain('md0 (raid1) is rebuilding');
		});

		test('returns OK during a rebuild when warnOnRebuild is false', () => {
			const check = loadCheck();
			const result = check({
				warnOnRebuild: 'false',
				fs: makeFs(HEALTHY_MDSTAT, {
					array_state: 'active\n',
					sync_action: 'reshape\n',
				}),
			});
			expect(result.code).toBe(0);
			expect(result.message).toContain('is rebuilding');
		});

		test('includes sync percent in rebuild message and perfdata', () => {
			const check = loadCheck();
			const mdstat = `md0 : active raid1 sda1[0] sdb1[1]
      100 blocks [2/2] [UU]
      [>....................]  recovery =  42.5% (1/2)
`;
			const result = check({
				fs: makeFs(mdstat, {array_state: 'active\n'}),
			});
			expect(result.code).toBe(1);
			expect(result.message).toContain('is rebuilding 42.5%');
			expect(result.performanceData).toContainEqual({
				label: 'md0_sync_percent',
				value: 42.5,
				uom: '%',
			});
		});

		test('returns OK during a scrub by default', () => {
			const check = loadCheck();
			const result = check({
				fs: makeFs(HEALTHY_MDSTAT, {
					array_state: 'active\n',
					sync_action: 'check\n',
				}),
			});
			expect(result.code).toBe(0);
			expect(result.message).toContain('is running a check');
		});

		test('returns WARNING during a scrub when warnOnSync is true', () => {
			const check = loadCheck();
			const result = check({
				warnOnSync: true,
				fs: makeFs(HEALTHY_MDSTAT, {
					array_state: 'active\n',
					sync_action: 'resync\n',
				}),
			});
			expect(result.code).toBe(1);
			expect(result.message).toContain('is running a resync');
		});

		test('includes sync percent in a scrub message', () => {
			const check = loadCheck();
			const mdstat = `md0 : active raid1 sda1[0] sdb1[1]
      100 blocks [2/2] [UU]
      [>....................]  check =  33.3% (1/2)
`;
			const result = check({
				warnOnSync: true,
				fs: makeFs(mdstat, {array_state: 'active\n'}),
			});
			expect(result.code).toBe(1);
			expect(result.message).toContain('is running a check 33.3%');
		});

		test('returns UNKNOWN when there are no arrays', () => {
			const check = loadCheck();
			const result = check({
				fs: makeFs('Personalities : \nunused devices: <none>\n'),
			});
			expect(result.code).toBe(3);
			expect(result.message).toContain('no md arrays found');
		});

		test('returns CRITICAL when there are no arrays and requireArray is set', () => {
			const check = loadCheck();
			const result = check({
				requireArray: 'true',
				fs: makeFs('Personalities : \nunused devices: <none>\n'),
			});
			expect(result.code).toBe(2);
			expect(result.message).toContain('requireArray is set');
		});

		test('returns UNKNOWN for an invalid array name', () => {
			const check = loadCheck();
			const result = check({array: 'sda1', fs: makeFs(HEALTHY_MDSTAT)});
			expect(result.code).toBe(3);
			expect(result.message).toContain('Invalid array name');
		});

		test('ignores an empty array filter', () => {
			const check = loadCheck();
			const result = check({
				array: '   ',
				fs: makeFs(HEALTHY_MDSTAT, {array_state: 'clean\n'}),
			});
			expect(result.code).toBe(0);
		});

		test('filters to a requested array', () => {
			const check = loadCheck();
			const result = check({
				array: '/dev/md0',
				fs: makeFs(HEALTHY_MDSTAT, {array_state: 'clean\n'}),
			});
			expect(result.code).toBe(0);
			expect(result.message).toContain('md0');
		});

		test('returns UNKNOWN when the requested array is absent', () => {
			const check = loadCheck();
			const result = check({
				array: 'md7',
				fs: makeFs(HEALTHY_MDSTAT, {array_state: 'clean\n'}),
			});
			expect(result.code).toBe(3);
			expect(result.message).toContain('array md7 not present');
		});

		test('returns UNKNOWN when mdstat cannot be read', () => {
			const check = loadCheck();
			const result = check({
				fs: {
					existsSync: () => false,
					readFileSync: () => {
						throw new Error('permission denied');
					},
				},
			});
			expect(result.code).toBe(3);
			expect(result.message).toContain('could not read /proc/mdstat');
			expect(result.message).toContain('permission denied');
		});

		test('stringifies a non-Error read failure', () => {
			const check = loadCheck();
			const result = check({
				fs: {
					existsSync: () => false,
					readFileSync: () => {
						throw 'boom';
					},
				},
			});
			expect(result.code).toBe(3);
			expect(result.message).toContain('boom');
		});

		test('falls back to the mdstat state when sysfs array_state is absent', () => {
			const check = loadCheck();
			const result = check({fs: makeFs(HEALTHY_MDSTAT)});
			expect(result.code).toBe(0);
			expect(result.message).toContain('md0 (raid1) is active, 2/2 devices');
		});

		test('uses a generic md label when no level is parsed', () => {
			const check = loadCheck();
			const mdstat = `md0 : active sda1[0]
      100 blocks [1/1] [U]
`;
			const result = check({fs: makeFs(mdstat, {array_state: 'clean\n'})});
			expect(result.message).toContain('md0 (md) is clean, 1/1 devices');
		});

		test('reports the worst status across multiple arrays', () => {
			const check = loadCheck();
			const mdstat = `md0 : active raid1 sda1[0] sdb1[1]
      100 blocks [2/2] [UU]
md1 : active raid1 sdc1[0] sdd1[1]
      100 blocks [2/1] [U_]
`;
			const files = new Map<string, string>([
				['/proc/mdstat', mdstat],
				['/sys/block/md0/md/array_state', 'clean\n'],
				['/sys/block/md1/md/array_state', 'clean\n'],
			]);
			const result = check({
				fs: {
					existsSync: (path: string) => files.has(path),
					readFileSync: (path: string) => {
						const value = files.get(path);
						if (value === undefined) {
							throw new Error(`ENOENT: ${path}`);
						}
						return value;
					},
				},
			});
			expect(result.code).toBe(2);
			expect(result.message).toContain('md1');
			expect(result.performanceData).toContainEqual({
				label: 'arrays_degraded',
				value: 1,
				uom: '',
			});
		});

		test('falls back to mdstat sync action when sysfs sync_action is absent', () => {
			const check = loadCheck();
			const mdstat = `md0 : active raid1 sda1[0] sdb1[1]
      100 blocks [2/2] [UU]
      [>....................]  recovery =  10.0% (1/2)
`;
			const result = check({fs: makeFs(mdstat, {array_state: 'active\n'})});
			expect(result.code).toBe(1);
			expect(result.message).toContain('is rebuilding 10%');
		});

		test('ignores a non-numeric sysfs degraded value', () => {
			const check = loadCheck();
			const result = check({
				fs: makeFs(HEALTHY_MDSTAT, {
					array_state: 'clean\n',
					degraded: 'not-a-number\n',
				}),
			});
			expect(result.code).toBe(0);
		});

		test('ignores a sysfs file that exists but cannot be read', () => {
			const check = loadCheck();
			const files = new Map<string, string>([
				['/proc/mdstat', HEALTHY_MDSTAT],
				['/sys/block/md0/md/array_state', 'clean\n'],
			]);
			const result = check({
				fs: {
					existsSync: (path: string) =>
						path === '/sys/block/md0/md/degraded' || files.has(path),
					readFileSync: (path: string) => {
						if (path === '/sys/block/md0/md/degraded') {
							throw new Error('EACCES');
						}
						const value = files.get(path);
						if (value === undefined) {
							throw new Error(`ENOENT: ${path}`);
						}
						return value;
					},
				},
			});
			expect(result.code).toBe(0);
		});

		test('uses the default fs when none is supplied', () => {
			jest.doMock('fs', () => {
				const actual = {
					existsSync: () => false,
					readFileSync: () => {
						throw new Error('no mdstat here');
					},
				};
				return {
					__esModule: true as const,
					default: actual,
					...actual,
				};
			});
			const check = loadCheck();
			const result = check({});
			expect(result.code).toBe(3);
			expect(result.message).toContain('could not read /proc/mdstat');
		});
	});
});
