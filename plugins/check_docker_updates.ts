import {execFile} from 'child_process';
import fs from 'fs';
import {promisify} from 'util';
import type {NagiosReturnCode} from '../src/types/nagios';
import {NagiosReturnCodes} from '../src/types/nagios';
import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../src/types/plugin';

type CommandResult = {
	ok: boolean;
	stdout: string;
	stderr: string;
};

type DockerRunner = (args: string[]) => Promise<CommandResult>;

type FsLike = {
	readFileSync: (path: string, encoding: 'utf-8') => string;
};

type Severity = 'warning' | 'critical';

type Config = {
	checkRunning: boolean;
	severity: Severity;
	ignore: string[];
	composeFile: string;
	dockerfile: string;
	errors: string[];
};

type RefStatus = 'up-to-date' | 'outdated' | 'local-build' | 'unknown';

type Counts = {
	total: number;
	outdated: number;
	upToDate: number;
	localBuild: number;
	unknown: number;
};

const execFileAsync = promisify(execFile);

const EXEC_TIMEOUT_MS = 20_000;
const EXEC_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

const MAX_LISTED_REFS = 10;

export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-docker-updates[?checkRunning=<true|false>&composeFile=<path>&dockerfile=<path>&severity=<warning|critical>&ignore=<csv>]&maxBuffer=<bytes>',
		shell:
			'./check_nest.sh check-docker-updates [checkRunning=<true|false>] [composeFile=<path>] [dockerfile=<path>] [severity=<warning|critical>] [ignore=<csv>]',
	},
	help: `<h1>check-docker-updates</h1>
<p>Detects container images whose tag has moved upstream (an update or security
patch has been published) by comparing the <strong>local image digest</strong>
against the <strong>current registry digest</strong>. This is an
"update-available" check, not a CVE scan.</p>

<h2>What This Plugin Checks</h2>
<ul>
  <li>Images used by <strong>running containers</strong> (enabled by default)</li>
  <li>Images referenced by a <strong>docker-compose.yml</strong> file (when a path is given)</li>
  <li>Base images referenced by <strong>FROM</strong> lines in a <strong>Dockerfile</strong> (when a path is given)</li>
</ul>

<h2>How It Works</h2>
<ul>
  <li>Local digest: <code>docker image inspect &lt;ref&gt; --format '{{json .RepoDigests}}'</code></li>
  <li>Registry digest: <code>docker buildx imagetools inspect &lt;ref&gt; --format '{{json .Manifest}}'</code> (no pull)</li>
  <li>If the digests differ, the tag has been republished upstream and an update is available.</li>
  <li>Images built locally (no registry digest) are skipped as <code>local-build</code>.</li>
  <li>Images that cannot be resolved locally or remotely are reported as <code>unknown</code>.</li>
</ul>

<h2>Status Logic</h2>
<ul>
  <li><strong>${NagiosReturnCodes.WARNING} WARNING</strong> (or CRITICAL with <code>severity=critical</code>): at least one image is outdated.</li>
  <li><strong>${NagiosReturnCodes.UNKNOWN} UNKNOWN</strong>: Docker is unavailable, no images were found, or no digest could be compared.</li>
  <li><strong>${NagiosReturnCodes.OK} OK</strong>: every comparable image is up to date.</li>
</ul>

<h2>Parameters</h2>
<ul>
  <li><code>checkRunning</code>: include running containers (default: true).</li>
  <li><code>composeFile</code>: path to a compose file to scan for <code>image:</code> entries.</li>
  <li><code>dockerfile</code>: path to a Dockerfile to scan for <code>FROM</code> images.</li>
  <li><code>severity</code>: <code>warning</code> (default) or <code>critical</code> when outdated images are found.</li>
  <li><code>ignore</code>: comma-separated substrings; matching image references are skipped.</li>
</ul>

<h2>Performance Data</h2>
<ul>
  <li><code>images_total</code>: number of image references evaluated.</li>
  <li><code>images_outdated</code>: references with a newer upstream digest.</li>
  <li><code>images_up_to_date</code>: references confirmed current.</li>
  <li><code>images_local_build</code>: references with no upstream digest (skipped).</li>
  <li><code>images_unknown</code>: references that could not be determined.</li>
</ul>

<h2>Notes</h2>
<ul>
  <li>Requires the Docker CLI and the buildx plugin; queries the registry over the network.</li>
  <li>Compose <code>build:</code>-only services and multi-stage <code>FROM &lt;stage&gt;</code> references are skipped automatically.</li>
</ul>` as HtmlTemplateString,
	examples: [
		{
			label: 'Check running containers only',
			method: 'GET',
			path: '/plugins/check-docker-updates',
			fields: [],
		},
		{
			label: 'Also scan a compose file and fail critical on outdated images',
			method: 'GET',
			path: '/plugins/check-docker-updates',
			fields: [
				{
					name: 'composeFile',
					label: 'Compose file path',
					required: false,
					defaultValue: 'docker-compose.yml',
				},
				{
					name: 'severity',
					label: 'Severity for outdated images',
					required: false,
					defaultValue: 'critical',
				},
			],
		},
	],
};

const runDocker: DockerRunner = async (args) => {
	try {
		const result = await execFileAsync('docker', args, {
			timeout: EXEC_TIMEOUT_MS,
			maxBuffer: EXEC_MAX_BUFFER_BYTES,
		});
		return {ok: true, stdout: result.stdout, stderr: result.stderr};
	} catch (error) {
		const err = error as {stdout?: string; stderr?: string; message?: string};
		return {
			ok: false,
			stdout: err.stdout ?? '',
			stderr: (err.stderr ?? err.message ?? 'docker command failed').trim(),
		};
	}
};

const parseBool = (
	value: string | undefined,
	def: boolean,
	name: string,
	errors: string[],
): boolean => {
	if (value === undefined || value.trim() === '') {
		return def;
	}
	const normalized = value.trim().toLowerCase();
	if (['1', 'true', 'yes'].includes(normalized)) {
		return true;
	}
	if (['0', 'false', 'no'].includes(normalized)) {
		return false;
	}
	errors.push(`${name} must be true or false`);
	return def;
};

const getConfig = (params: Record<string, string>): Config => {
	const errors: string[] = [];
	const severityRaw = (params.severity ?? 'warning').trim().toLowerCase();
	if (severityRaw !== 'warning' && severityRaw !== 'critical') {
		errors.push('severity must be warning or critical');
	}
	const ignore = (params.ignore ?? '')
		.split(',')
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
	return {
		checkRunning: parseBool(params.checkRunning, true, 'checkRunning', errors),
		severity: severityRaw === 'critical' ? 'critical' : 'warning',
		ignore,
		composeFile: (params.composeFile ?? '').trim(),
		dockerfile: (params.dockerfile ?? '').trim(),
		errors,
	};
};

export const parseComposeImages = (content: string): string[] => {
	const images: string[] = [];
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, '');
		const match = line.match(/^\s*image:\s*["']?([^\s"']+)/);
		if (match && !match[1].includes('$')) {
			images.push(match[1]);
		}
	}
	return images;
};

export const parseDockerfileImages = (content: string): string[] => {
	const images: string[] = [];
	const stages = new Set<string>();
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, '').trim();
		const match = line.match(/^FROM\s+(?:--\S+\s+)*(\S+)/i);
		if (!match) {
			continue;
		}
		const ref = match[1];
		const asMatch = line.match(/\bAS\s+([A-Za-z0-9_.-]+)/i);
		const isScratch = ref.toLowerCase() === 'scratch';
		const isVariable = ref.includes('$');
		const isPriorStage = stages.has(ref);
		if (!isScratch && !isVariable && !isPriorStage) {
			images.push(ref);
		}
		if (asMatch) {
			stages.add(asMatch[1]);
		}
	}
	return images;
};

const parseLines = (stdout: string): string[] =>
	stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

const extractLocalDigest = (stdout: string): string | undefined => {
	try {
		const parsed = JSON.parse(stdout) as unknown;
		if (Array.isArray(parsed) && parsed.length > 0) {
			const entry = String(parsed[0]);
			const at = entry.indexOf('@');
			return at >= 0 ? entry.slice(at + 1) : entry;
		}
		return undefined;
	} catch {
		return undefined;
	}
};

const extractRemoteDigest = (stdout: string): string | undefined => {
	try {
		const parsed = JSON.parse(stdout) as Record<string, unknown>;
		const digest = parsed?.digest;
		return typeof digest === 'string' ? digest : undefined;
	} catch {
		return undefined;
	}
};

const readSourceFile = (
	fsImpl: FsLike,
	path: string,
	label: string,
	sourceErrors: string[],
): string | undefined => {
	try {
		return fsImpl.readFileSync(path, 'utf-8');
	} catch {
		sourceErrors.push(`${label} ${path} could not be read`);
		return undefined;
	}
};

const getLocalDigest = async (
	runner: DockerRunner,
	ref: string,
): Promise<
	{kind: 'digest'; digest: string} | {kind: 'local-build'} | {kind: 'error'}
> => {
	const result = await runner([
		'image',
		'inspect',
		ref,
		'--format',
		'{{json .RepoDigests}}',
	]);
	if (!result.ok) {
		return {kind: 'error'};
	}
	const digest = extractLocalDigest(result.stdout);
	return digest ? {kind: 'digest', digest} : {kind: 'local-build'};
};

const getRemoteDigest = async (
	runner: DockerRunner,
	ref: string,
): Promise<string | undefined> => {
	const result = await runner([
		'buildx',
		'imagetools',
		'inspect',
		ref,
		'--format',
		'{{json .Manifest}}',
	]);
	if (!result.ok) {
		return undefined;
	}
	return extractRemoteDigest(result.stdout);
};

const evaluateRef = async (
	runner: DockerRunner,
	ref: string,
): Promise<RefStatus> => {
	const local = await getLocalDigest(runner, ref);
	if (local.kind === 'error') {
		return 'unknown';
	}
	if (local.kind === 'local-build') {
		return 'local-build';
	}
	const remote = await getRemoteDigest(runner, ref);
	if (remote === undefined) {
		return 'unknown';
	}
	return remote === local.digest ? 'up-to-date' : 'outdated';
};

const summarizeRefs = (refs: string[]): string => {
	if (refs.length <= MAX_LISTED_REFS) {
		return refs.join(', ');
	}
	return `${refs.slice(0, MAX_LISTED_REFS).join(', ')} (+${refs.length - MAX_LISTED_REFS} more)`;
};

const buildMessage = (
	counts: Counts,
	outdatedRefs: string[],
	sourceErrors: string[],
): string => {
	const notes: string[] = [];
	if (counts.localBuild > 0) {
		notes.push(`${counts.localBuild} local-build`);
	}
	if (counts.unknown > 0) {
		notes.push(`${counts.unknown} unknown`);
	}
	const noteText = notes.length > 0 ? ` (${notes.join(', ')})` : '';

	let message: string;
	if (counts.outdated > 0) {
		message = `${counts.outdated} of ${counts.total} image(s) outdated: ${summarizeRefs(outdatedRefs)}${noteText}`;
	} else if (counts.upToDate > 0) {
		message = `all ${counts.upToDate} image(s) up to date${noteText}`;
	} else {
		message = `no image digests could be compared (${counts.total} reference(s)${counts.localBuild > 0 ? `, ${counts.localBuild} local-build` : ''}${counts.unknown > 0 ? `, ${counts.unknown} unknown` : ''})`;
	}
	if (sourceErrors.length > 0) {
		message += `; ${sourceErrors.join('; ')}`;
	}
	return message;
};

const buildPerformanceData = (counts: Counts) => [
	{label: 'images_total', value: counts.total, uom: ''},
	{label: 'images_outdated', value: counts.outdated, uom: ''},
	{label: 'images_up_to_date', value: counts.upToDate, uom: ''},
	{label: 'images_local_build', value: counts.localBuild, uom: ''},
	{label: 'images_unknown', value: counts.unknown, uom: ''},
];

export const getStatusText = (
	status: number,
): 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN' => {
	if (status === NagiosReturnCodes.OK) {
		return 'OK';
	}
	if (status === NagiosReturnCodes.WARNING) {
		return 'WARNING';
	}
	if (status === NagiosReturnCodes.CRITICAL) {
		return 'CRITICAL';
	}
	return 'UNKNOWN';
};

export const checkDockerUpdates = async (
	params: Record<string, string> = {},
	runner: DockerRunner = runDocker,
	fsImpl: FsLike = fs,
): Promise<PluginReturn> => {
	const config = getConfig(params);
	if (config.errors.length > 0) {
		return {
			message: `invalid configuration: ${config.errors.join('; ')}`,
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	const sourceErrors: string[] = [];
	const collected: string[] = [];

	if (config.checkRunning) {
		const result = await runner(['ps', '--format', '{{.Image}}']);
		if (!result.ok) {
			sourceErrors.push(`running containers: ${result.stderr}`);
		} else {
			collected.push(...parseLines(result.stdout));
		}
	}

	if (config.composeFile) {
		const content = readSourceFile(
			fsImpl,
			config.composeFile,
			'compose file',
			sourceErrors,
		);
		if (content !== undefined) {
			collected.push(...parseComposeImages(content));
		}
	}

	if (config.dockerfile) {
		const content = readSourceFile(
			fsImpl,
			config.dockerfile,
			'Dockerfile',
			sourceErrors,
		);
		if (content !== undefined) {
			collected.push(...parseDockerfileImages(content));
		}
	}

	const ignoreMatch = (ref: string): boolean =>
		config.ignore.some((token) => ref.includes(token));
	const refs = [...new Set(collected)].filter((ref) => !ignoreMatch(ref));

	if (refs.length === 0) {
		const reason =
			sourceErrors.length > 0 ? `; ${sourceErrors.join('; ')}` : '';
		return {
			message: `no container images found to check${reason}`,
			code: NagiosReturnCodes.UNKNOWN,
		};
	}

	const counts: Counts = {
		total: refs.length,
		outdated: 0,
		upToDate: 0,
		localBuild: 0,
		unknown: 0,
	};
	const outdatedRefs: string[] = [];

	for (const ref of refs) {
		const status = await evaluateRef(runner, ref);
		switch (status) {
			case 'outdated':
				counts.outdated += 1;
				outdatedRefs.push(ref);
				break;
			case 'up-to-date':
				counts.upToDate += 1;
				break;
			case 'local-build':
				counts.localBuild += 1;
				break;
			default:
				counts.unknown += 1;
				break;
		}
	}

	let code: NagiosReturnCode;
	if (counts.outdated > 0) {
		code =
			config.severity === 'critical'
				? NagiosReturnCodes.CRITICAL
				: NagiosReturnCodes.WARNING;
	} else if (counts.upToDate === 0) {
		code = NagiosReturnCodes.UNKNOWN;
	} else {
		code = NagiosReturnCodes.OK;
	}

	return {
		message: `${getStatusText(code)}: ${buildMessage(counts, outdatedRefs, sourceErrors)}`,
		code,
		performanceData: buildPerformanceData(counts),
	};
};
