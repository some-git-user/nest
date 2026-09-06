import fs from 'fs';
import type {
	NagiosPerformanceData,
	NagiosReturnCode,
} from '../src/types/nagios';
import {NagiosReturnCodes} from '../src/types/nagios';
import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../src/types/plugin';

/**
 * mdadm Linux software RAID status checker.
 *
 * Reads the kernel's own view of the md arrays rather than shelling out to
 * `mdadm`: `/proc/mdstat` lists every array with its level, member devices and
 * sync progress, and `/sys/block/<md>/md/*` exposes the authoritative
 * `array_state`, `sync_action`, `degraded` count and `mismatch_count`. This
 * needs no external binary and no root, and it never builds a shell command, so
 * there is no injection surface - the same pure-filesystem shape as
 * `check-reboot-required`.
 *
 * It complements `check-smart-status`: SMART answers "is this physical disk
 * healthy?", this answers "is the array still redundant?". A degraded RAID1/5/6
 * is exactly the failure SMART will not flag (the surviving members are fine)
 * that turns the next disk failure into data loss.
 */
export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-mdadm-raid?array=<mddevice>&warnOnRebuild=<true|false>&warnOnSync=<true|false>&requireArray=<true|false>',
		shell:
			'./check_nest.sh check-mdadm-raid [array=/dev/md0] [warnOnRebuild=true] [warnOnSync=false] [requireArray=false]',
	},
	help: `<h1>check-mdadm-raid</h1>
<p>Monitors Linux software RAID (mdadm) arrays by reading <code>/proc/mdstat</code>
and <code>/sys/block/&lt;md&gt;/md/*</code>. No external binary and no root
privileges are required, and no shell command is built.</p>

<h2>What it checks</h2>
<ul>
<li><strong>Array state</strong> - an array whose <code>array_state</code> is <code>broken</code> is critical.</li>
<li><strong>Degradation</strong> - any missing member (a <code>_</code> slot in mdstat, a device flagged <code>(F)</code>, or a non-zero <code>degraded</code> counter) means the array has lost redundancy and is critical.</li>
<li><strong>Rebuild / reshape</strong> - a <code>recovery</code> or <code>reshape</code> in progress warns (the array is rebuilding and is currently exposed).</li>
<li><strong>Scrub</strong> - a periodic <code>check</code>, <code>resync</code> or <code>repair</code> is informational and OK by default.</li>
<li><strong>Consistency</strong> - a non-zero <code>mismatch_count</code> means a scrub found data that could not be reconciled and is critical.</li>
</ul>

<h2>Parameters</h2>
<table>
<tr><th>Parameter</th><th>Type</th><th>Default</th><th>Description</th></tr>
<tr><td><code>array</code></td><td>string</td><td>all</td><td>Restrict the check to one array (e.g. <code>/dev/md0</code> or <code>md0</code>). When omitted every array in mdstat is checked.</td></tr>
<tr><td><code>warnOnRebuild</code></td><td>boolean</td><td><code>true</code></td><td>Return WARNING while a rebuild/reshape is in progress. Set false to treat rebuilding as OK.</td></tr>
<tr><td><code>warnOnSync</code></td><td>boolean</td><td><code>false</code></td><td>Return WARNING during a periodic check/resync/repair scrub.</td></tr>
<tr><td><code>requireArray</code></td><td>boolean</td><td><code>false</code></td><td>When true, a host with no md arrays is CRITICAL (a machine that should have RAID lost it). When false it is UNKNOWN.</td></tr>
</table>

<h2>Return codes</h2>
<ul>
<li><strong>OK</strong> - every array is active, fully redundant and idle (or scrubbing, when warnOnSync is false).</li>
<li><strong>WARNING</strong> - a rebuild/reshape is running (warnOnRebuild) or a scrub is running (warnOnSync).</li>
<li><strong>CRITICAL</strong> - an array is degraded or broken, a scrub found mismatches, or requireArray is set and no array exists.</li>
<li><strong>UNKNOWN</strong> - mdstat cannot be read, an invalid array name was given, or no array exists and requireArray is false.</li>
</ul>

<h2>Examples</h2>
<pre>./check_nest.sh check-mdadm-raid</pre>
<pre>./check_nest.sh check-mdadm-raid array=/dev/md0</pre>
<pre>./check_nest.sh check-mdadm-raid warnOnSync=true requireArray=true</pre>

<h2>References</h2>
<ul>
<li><a href="https://man7.org/linux/man-pages/man5/mdstat.5.html" target="_blank" rel="noopener">mdstat(5)</a></li>
<li><a href="https://man7.org/linux/man-pages/man8/mdadm.8.html" target="_blank" rel="noopener">mdadm(8)</a></li>
</ul>` as HtmlTemplateString,
	examples: [
		{
			label: 'Check all md arrays',
			method: 'GET',
			path: '/plugins/check-mdadm-raid',
			fields: [],
		},
		{
			label: 'Check a single array',
			method: 'GET',
			path: '/plugins/check-mdadm-raid?array=/dev/md0',
			fields: [
				{
					name: 'array',
					label: 'Array device',
					required: false,
					defaultValue: '/dev/md0',
				},
			],
		},
	],
};

/** The filesystem seam, so tests can supply an in-memory md sysfs. */
type FsLike = {
	existsSync: (path: string) => boolean;
	readFileSync: (path: string, encoding: 'utf-8') => string;
};

type ParsedDevice = {
	name: string;
	slot: number;
	faulty: boolean;
	spare: boolean;
};

type ParsedArray = {
	name: string;
	state: string;
	level: string;
	devices: ParsedDevice[];
	disksActive: number;
	disksTotal: number;
	statusFlags: string;
	syncAction?: string;
	syncPercent?: number;
};

const MDSTAT_PATH = '/proc/mdstat';
const SYSFS_MD_ROOT = '/sys/block';

/** A device token looks like `sda1[0]`, `sda1[0](F)` or `sdb1[1](W)`. */
const DEVICE_TOKEN = /^(.+?)\[(\d+)\](?:\((\w+)\))?$/;
/** The `[2/1] [U_]` disk summary on a continuation line. */
const DISK_SUMMARY = /\[(\d+)\/(\d+)\]\s+\[([A-Za-z0-9_.]+)\]/;
/** `[>....] recovery = 12.3% (...)` on a continuation line. */
const SYNC_PROGRESS =
	/\b(recovery|resync|check|repair|reshape)\s*=\s*([\d.]+)%/;
/** A recognised md level token on the header line. */
const LEVEL_TOKEN = /^(raid[0-9]|linear|multipath|faulty)$/;

/**
 * Parse `/proc/mdstat` into one record per md array.
 *
 * The header line (`md0 : active raid1 sda1[0] sdb1[1]`) carries the state,
 * level and members; the indented continuation lines carry the `[a/b] [UU]`
 * disk summary and any sync progress. The `Personalities` and `unused devices`
 * bookkeeping lines are ignored.
 */
export const parseMdstat = (content: string): ParsedArray[] => {
	const arrays: ParsedArray[] = [];
	let current: ParsedArray | undefined;

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.replace(/\s+$/u, '');
		if (line.length === 0) {
			current = undefined;
			continue;
		}

		const header = line.match(/^(\S+)\s*:\s+(.*)$/);
		if (header && header[1].startsWith('md')) {
			const tokens = header[2].trim().split(/\s+/);
			const devices: ParsedDevice[] = [];
			for (const token of tokens) {
				const match = token.match(DEVICE_TOKEN);
				if (match) {
					devices.push({
						name: match[1],
						slot: Number(match[2]),
						faulty: match[3] === 'F',
						spare: match[3] === 'S',
					});
				}
			}
			current = {
				name: header[1],
				state: tokens[0],
				level: tokens.find((token) => LEVEL_TOKEN.test(token)) ?? '',
				devices,
				disksActive: 0,
				disksTotal: 0,
				statusFlags: '',
			};
			arrays.push(current);
			continue;
		}

		if (!current) {
			continue;
		}

		const disks = line.match(DISK_SUMMARY);
		if (disks) {
			current.disksTotal = Number(disks[1]);
			current.disksActive = Number(disks[2]);
			current.statusFlags = disks[3];
		}

		const sync = line.match(SYNC_PROGRESS);
		if (sync) {
			current.syncAction = sync[1];
			current.syncPercent = Number(sync[2]);
		}
	}

	return arrays;
};

/**
 * Normalise a user-supplied array name to a bare md block-device name.
 *
 * Accepts `/dev/md0`, `md0` or `/dev/md/data` style paths and reduces them to
 * the last path segment. Only `md`-prefixed names are allowed, which keeps the
 * value safe to interpolate into a sysfs path (no traversal, no separators).
 */
export const normalizeArrayName = (
	input: string,
): {name?: string; error?: string} => {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return {error: 'Array name must not be empty'};
	}
	const segments = trimmed.split('/').filter((segment) => segment.length > 0);
	const base = segments[segments.length - 1] ?? '';
	if (!/^md[\w-]*$/u.test(base)) {
		return {
			error: `Invalid array name "${input}". Expected an md device such as /dev/md0.`,
		};
	}
	return {name: base};
};

const readSysfs = (
	fsImpl: FsLike,
	name: string,
	file: string,
): string | undefined => {
	const filePath = `${SYSFS_MD_ROOT}/${name}/md/${file}`;
	try {
		if (!fsImpl.existsSync(filePath)) {
			return undefined;
		}
		return fsImpl.readFileSync(filePath, 'utf-8').trim();
	} catch {
		return undefined;
	}
};

const toNumber = (value: string | undefined): number | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

/** Sanitize an array name into a valid Nagios perfdata label. */
const labelFor = (name: string, suffix: string): string =>
	`${name.replace(/[^a-zA-Z0-9_]/gu, '_')}_${suffix}`;

type ArrayEvaluation = {
	code: NagiosReturnCode;
	summary: string;
	perfdata: NagiosPerformanceData[];
};

const REBUILD_ACTIONS = new Set(['recovery', 'reshape']);
const SCRUB_ACTIONS = new Set(['check', 'resync', 'repair']);

/**
 * Evaluate a single array into a Nagios status plus its performance data.
 *
 * The worst condition wins: broken > degraded > mismatch > rebuild > scrub > OK.
 */
const evaluateArray = (
	array: ParsedArray,
	fsImpl: FsLike,
	warnOnRebuild: boolean,
	warnOnSync: boolean,
): ArrayEvaluation => {
	const arrayState = readSysfs(fsImpl, array.name, 'array_state');
	const syncAction =
		readSysfs(fsImpl, array.name, 'sync_action') ?? array.syncAction;
	const sysfsDegraded = toNumber(readSysfs(fsImpl, array.name, 'degraded'));
	const mismatchCount = toNumber(
		readSysfs(fsImpl, array.name, 'mismatch_count'),
	);

	// Degradation can be reported three ways; take the strongest signal. The
	// mdstat `[a/b] [UU]` flags are the primary source, a `(F)` faulty marker
	// and the sysfs `degraded` counter are backups.
	let degraded = 0;
	if (array.statusFlags.length > 0) {
		degraded = (array.statusFlags.match(/_/gu) ?? []).length;
	}
	const faultyDevices = array.devices.filter((device) => device.faulty).length;
	degraded = Math.max(degraded, faultyDevices, sysfsDegraded ?? 0);

	const perfdata: NagiosPerformanceData[] = [
		{label: labelFor(array.name, 'degraded'), value: degraded, uom: ''},
		{
			label: labelFor(array.name, 'disks_active'),
			value: array.disksActive,
			uom: '',
		},
		{
			label: labelFor(array.name, 'disks_total'),
			value: array.disksTotal,
			uom: '',
		},
	];
	if (array.syncPercent !== undefined) {
		perfdata.push({
			label: labelFor(array.name, 'sync_percent'),
			value: array.syncPercent,
			uom: '%',
		});
	}

	const stateLabel = arrayState ?? array.state;
	const levelLabel = array.level.length > 0 ? array.level : 'md';

	if (arrayState === 'broken') {
		return {
			code: NagiosReturnCodes.CRITICAL,
			summary: `${array.name} (${levelLabel}) is broken`,
			perfdata,
		};
	}

	if (degraded > 0) {
		return {
			code: NagiosReturnCodes.CRITICAL,
			summary: `${array.name} (${levelLabel}) is degraded: ${degraded} missing device(s), state ${stateLabel}`,
			perfdata,
		};
	}

	if (mismatchCount !== undefined && mismatchCount > 0) {
		return {
			code: NagiosReturnCodes.CRITICAL,
			summary: `${array.name} (${levelLabel}) has ${mismatchCount} consistency mismatch(es)`,
			perfdata,
		};
	}

	if (syncAction !== undefined && REBUILD_ACTIONS.has(syncAction)) {
		const percent =
			array.syncPercent !== undefined ? ` ${array.syncPercent}%` : '';
		return {
			code: warnOnRebuild ? NagiosReturnCodes.WARNING : NagiosReturnCodes.OK,
			summary: `${array.name} (${levelLabel}) is rebuilding${percent}`,
			perfdata,
		};
	}

	if (syncAction !== undefined && SCRUB_ACTIONS.has(syncAction)) {
		const percent =
			array.syncPercent !== undefined ? ` ${array.syncPercent}%` : '';
		return {
			code: warnOnSync ? NagiosReturnCodes.WARNING : NagiosReturnCodes.OK,
			summary: `${array.name} (${levelLabel}) is running a ${syncAction}${percent}`,
			perfdata,
		};
	}

	return {
		code: NagiosReturnCodes.OK,
		summary: `${array.name} (${levelLabel}) is ${stateLabel}, ${array.disksActive}/${array.disksTotal} devices`,
		perfdata,
	};
};

const CODE_NAMES: Record<number, string> = {
	[NagiosReturnCodes.OK]: 'OK',
	[NagiosReturnCodes.WARNING]: 'WARNING',
	[NagiosReturnCodes.CRITICAL]: 'CRITICAL',
	[NagiosReturnCodes.UNKNOWN]: 'UNKNOWN',
};

export const checkMdadmRaid = (params: {
	array?: string;
	warnOnRebuild?: boolean | string;
	warnOnSync?: boolean | string;
	requireArray?: boolean | string;
	fs?: FsLike;
}): PluginReturn => {
	const fsImpl: FsLike = params.fs ?? fs;
	const truthy = (value: boolean | string | undefined, fallback: boolean) => {
		if (value === undefined) {
			return fallback;
		}
		if (typeof value === 'boolean') {
			return value;
		}
		return value === 'true';
	};
	const warnOnRebuild = truthy(params.warnOnRebuild, true);
	const warnOnSync = truthy(params.warnOnSync, false);
	const requireArray = truthy(params.requireArray, false);

	// Validate an explicit array filter before touching the filesystem, so a
	// bad name never reaches a sysfs path.
	let wanted: string | undefined;
	if (params.array !== undefined && params.array.trim().length > 0) {
		const normalized = normalizeArrayName(params.array);
		if (normalized.error !== undefined) {
			return {
				message: `UNKNOWN: ${normalized.error}`,
				code: NagiosReturnCodes.UNKNOWN,
				performanceData: [],
			};
		}
		wanted = normalized.name;
	}

	let mdstatContent: string;
	try {
		mdstatContent = fsImpl.readFileSync(MDSTAT_PATH, 'utf-8');
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			message: `UNKNOWN: could not read ${MDSTAT_PATH} - ${reason}`,
			code: NagiosReturnCodes.UNKNOWN,
			performanceData: [],
		};
	}

	let arrays = parseMdstat(mdstatContent);
	if (wanted !== undefined) {
		arrays = arrays.filter((array) => array.name === wanted);
		if (arrays.length === 0) {
			return {
				message: `UNKNOWN: array ${wanted} not present in ${MDSTAT_PATH}`,
				code: NagiosReturnCodes.UNKNOWN,
				performanceData: [],
			};
		}
	}

	if (arrays.length === 0) {
		if (requireArray) {
			return {
				message:
					'CRITICAL: no md arrays found but requireArray is set - expected RAID is missing',
				code: NagiosReturnCodes.CRITICAL,
				performanceData: [
					{label: 'arrays_total', value: 0, uom: ''},
					{label: 'arrays_degraded', value: 0, uom: ''},
				],
			};
		}
		return {
			message: 'UNKNOWN: no md arrays found in /proc/mdstat',
			code: NagiosReturnCodes.UNKNOWN,
			performanceData: [
				{label: 'arrays_total', value: 0, uom: ''},
				{label: 'arrays_degraded', value: 0, uom: ''},
			],
		};
	}

	const evaluations = arrays.map((array) =>
		evaluateArray(array, fsImpl, warnOnRebuild, warnOnSync),
	);

	// Worst status wins. A per-array evaluation only ever yields OK, WARNING or
	// CRITICAL (UNKNOWN is reserved for the whole-check errors above), so this
	// ranks those three.
	const severity = (code: number): number => {
		if (code === NagiosReturnCodes.CRITICAL) {
			return 2;
		}
		if (code === NagiosReturnCodes.WARNING) {
			return 1;
		}
		return 0;
	};
	let worst = evaluations[0];
	for (const evaluation of evaluations) {
		if (severity(evaluation.code) > severity(worst.code)) {
			worst = evaluation;
		}
	}

	const degradedArrays = evaluations.filter(
		(evaluation) =>
			evaluation.code === NagiosReturnCodes.CRITICAL &&
			evaluation.summary.includes('degraded'),
	).length;

	const details = evaluations.map((evaluation) => evaluation.summary);
	const message = `${CODE_NAMES[worst.code]}: ${details.join('; ')}`;

	return {
		message,
		code: worst.code,
		performanceData: [
			{label: 'arrays_total', value: arrays.length, uom: ''},
			{label: 'arrays_degraded', value: degradedArrays, uom: ''},
			...evaluations.flatMap((evaluation) => evaluation.perfdata),
		],
	};
};
