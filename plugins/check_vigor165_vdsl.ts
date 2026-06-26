import type {
	CipherAlgorithm,
	ClientChannel,
	ConnectConfig,
	KexAlgorithm,
	Prompt,
	ServerHostKeyAlgorithm,
} from 'ssh2';
import {Client} from 'ssh2';
import type {PluginMeta} from '../src/types/plugin-meta';

type VigorVdslParams = {
	host?: string;
	routerUrl?: string;
	port?: string;
	username?: string;
	password?: string;
	command?: string;
	prompt?: string;
	bookedDownstreamMbps?: string;
	warningPercentBelow?: string;
	criticalPercentBelow?: string;
	timeoutMs?: string;
	kexAlgorithms?: string;
	ciphers?: string;
	hostKeyAlgorithms?: string;
};

type ParsedDslMetrics = {
	downstreamMbps?: number;
	upstreamMbps?: number;
	snrDownDb?: number;
	attenuationDownDb?: number;
	crcErrors?: number;
	fecErrors?: number;
	dslUptimeSeconds?: number;
	isDslUp?: boolean;
	esCount?: number;
	feEsCount?: number;
	dsAttainableMbps?: number;
	usAttainableMbps?: number;
	dsPsd?: number;
	usPsd?: number;
	dsInterleaveDepth?: number;
	usInterleaveDepth?: number;
	farAttenuationDb?: number;
	farSnrDb?: number;
};

type PerformanceDataEntry = {
	label: string;
	value: string;
	uom: string;
	warn?: string;
	crit?: string;
	min?: string;
};

type ResolvedTarget = {
	host: string;
	port: number;
};

const STATUS_OK = 0;
const STATUS_WARNING = 1;
const STATUS_CRITICAL = 2;
const STATUS_UNKNOWN = 3;

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_PORT = 22;
const DEFAULT_COMMAND = 'vdsl status';
const DEFAULT_PROMPT = 'DrayTek>';
const DEFAULT_KEX_ALGORITHMS: KexAlgorithm[] = ['diffie-hellman-group1-sha1'];
const DEFAULT_CIPHERS: CipherAlgorithm[] = ['3des-cbc'];
const DEFAULT_HOST_KEY_ALGORITHMS: ServerHostKeyAlgorithm[] = ['ssh-rsa'];

export const meta = {
	usage: {
		http: '/plugins/check-vigor165-vdsl?host=<router-ip-or-dns>&port=<ssh-port>&username=<user>&password=<pass>&bookedDownstreamMbps=<number>&warningPercentBelow=<0-100>&criticalPercentBelow=<0-100>&timeoutMs=<milliseconds>&command=<optional-cli-command>&prompt=<optional-cli-prompt>&kexAlgorithms=<csv>&ciphers=<csv>&hostKeyAlgorithms=<csv>',
		shell:
			'./check_nest.sh check-vigor165-vdsl host=<router-ip-or-dns> port=<ssh-port> username=<user> password=<pass> bookedDownstreamMbps=<number> warningPercentBelow=<0-100> criticalPercentBelow=<0-100>',
	},
	examples: [
		{
			label: 'DrayTek CLI over SSH',
			method: 'POST',
			path: '/plugins/check-vigor165-vdsl',
			fields: [
				{
					name: 'host',
					label: 'Router Host or IP',
					defaultValue: '192.168.111.1',
				},
				{name: 'port', label: 'SSH Port', defaultValue: '22333'},
				{name: 'username', label: 'Username', defaultValue: 'admin'},
				{name: 'password', label: 'Password', type: 'password'},
				{
					name: 'bookedDownstreamMbps',
					label: 'Booked Downstream (Mbps)',
					defaultValue: '100',
				},
				{
					name: 'warningPercentBelow',
					label: 'Warning % Below Booked',
					defaultValue: '20',
				},
				{
					name: 'criticalPercentBelow',
					label: 'Critical % Below Booked',
					defaultValue: '40',
				},
				{name: 'timeoutMs', label: 'Timeout (ms)', defaultValue: '10000'},
			],
		},
	],
	help: `<h1>check-vigor165-vdsl</h1>
<p>Checks VDSL line health for a DrayTek Vigor 165 over SSH by logging into the router CLI, issuing <code>vdsl status</code>, parsing line metrics, and comparing downstream sync speed against the booked line speed.</p>

<h2>Observed Workflow</h2>
<p>This plugin matches the manual CLI flow:</p>
<pre><code>ssh -oKexAlgorithms=+diffie-hellman-group1-sha1 -c 3des-cbc -oHostKeyAlgorithms=+ssh-rsa admin@192.168.111.1 -p 22333
DrayTek&gt; vdsl status</code></pre>

<h2>Authentication</h2>
<ul>
  <li><code>username</code> and <code>password</code> are required.</li>
  <li>The plugin enables password auth and keyboard-interactive fallback for older router firmwares.</li>
</ul>

<h2>Legacy SSH Algorithms</h2>
<p>By default the plugin appends the legacy algorithms observed in the manual workflow:</p>
<ul>
  <li><code>kexAlgorithms=diffie-hellman-group1-sha1</code></li>
  <li><code>ciphers=3des-cbc</code></li>
  <li><code>hostKeyAlgorithms=ssh-rsa</code></li>
</ul>
<p>You can override these with comma-separated values if the router firmware differs.</p>

<h2>Required Parameters</h2>
<ul>
  <li><code>host</code> - SSH host or IP of the router. For backward compatibility, <code>routerUrl</code> is also accepted and its host/port are used.</li>
  <li><code>username</code> - SSH username</li>
  <li><code>password</code> - SSH password</li>
  <li><code>bookedDownstreamMbps</code> - contracted downstream speed in Mbps</li>
</ul>

<h2>Optional Parameters</h2>
<ul>
  <li><code>port</code> - SSH port, default <code>22</code></li>
  <li><code>command</code> - CLI command to run, default <code>vdsl status</code></li>
  <li><code>prompt</code> - CLI prompt marker, default <code>DrayTek&gt;</code></li>
  <li><code>timeoutMs</code> - total SSH/session timeout, default <code>10000</code> ms</li>
</ul>

<h2>Threshold Logic</h2>
<p>Given booked speed <code>B</code> and measured downstream <code>D</code>:</p>
<ul>
  <li>Below percentage = <code>((B - D) / B) * 100</code></li>
  <li><strong>CRITICAL</strong> if below percentage is greater than or equal to <code>criticalPercentBelow</code></li>
  <li><strong>WARNING</strong> if below percentage is greater than or equal to <code>warningPercentBelow</code></li>
  <li><strong>OK</strong> otherwise</li>
</ul>

<h2>Example</h2>
<pre><code>./check_nest.sh check-vigor165-vdsl \
  host=192.168.111.1 \
  port=22333 \
  username=admin \
  password=secret \
  bookedDownstreamMbps=100 \
  warningPercentBelow=20 \
  criticalPercentBelow=40 \
  timeoutMs=10000</code></pre>`,
} satisfies PluginMeta;

const usageMessage = (): string =>
	`Usage: ${meta.usage.http}. Provide host, username, password, and bookedDownstreamMbps.`;

const round = (value: number, digits: number): string => value.toFixed(digits);

const parsePositiveNumber = (
	value: string | undefined,
	defaultValue: number,
): number => {
	if (!value) {
		return defaultValue;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return defaultValue;
	}

	return parsed;
};

const parsePercent = (
	value: string | undefined,
	defaultValue: number,
): number => {
	if (!value) {
		return defaultValue;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
		return defaultValue;
	}

	return parsed;
};

const parseCsvList = <T extends string>(
	value: string | undefined,
	fallback: readonly T[],
): T[] => {
	if (!value || value.trim().length === 0) {
		return [...fallback];
	}

	const parsed = value
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0) as T[];

	return parsed.length > 0 ? parsed : [...fallback];
};

const readRegexNumber = (
	text: string,
	patterns: RegExp[],
): number | undefined => {
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (!match || !match[1]) {
			continue;
		}

		const parsed = Number(match[1]);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return undefined;
};

const readRegexValue = (
	text: string,
	patterns: RegExp[],
): string | undefined => {
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match && match[1]) {
			return match[1];
		}
	}

	return undefined;
};

const normalizeRateToMbps = (value: number): number => {
	if (value >= 1_000_000) {
		return value / 1_000_000;
	}
	if (value >= 1_000) {
		return value / 1_000;
	}
	return value;
};

const parseDurationToSeconds = (
	value: string | undefined,
): number | undefined => {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	const dayTimeMatch = trimmed.match(
		/(\d+)\s*d(?:ays?)?\s*(\d{1,2}):(\d{1,2}):(\d{1,2})/i,
	);
	if (dayTimeMatch) {
		const days = Number(dayTimeMatch[1]);
		const hours = Number(dayTimeMatch[2]);
		const minutes = Number(dayTimeMatch[3]);
		const seconds = Number(dayTimeMatch[4]);
		if ([days, hours, minutes, seconds].every(Number.isFinite)) {
			return days * 86400 + hours * 3600 + minutes * 60 + seconds;
		}
	}

	const hmsMatch = trimmed.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/);
	if (hmsMatch) {
		const hours = Number(hmsMatch[1]);
		const minutes = Number(hmsMatch[2]);
		const seconds = Number(hmsMatch[3]);
		if ([hours, minutes, seconds].every(Number.isFinite)) {
			return hours * 3600 + minutes * 60 + seconds;
		}
	}

	return undefined;
};

const escapeRegExp = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveTarget = (params: VigorVdslParams): ResolvedTarget | undefined => {
	let host = params.host?.trim();
	let portFromRouterUrl: number | undefined;

	if ((!host || host.length === 0) && params.routerUrl) {
		const trimmed = params.routerUrl.trim();
		if (trimmed.includes('://')) {
			const parsed = new URL(trimmed);
			host = parsed.hostname;
			if (parsed.port) {
				portFromRouterUrl = Number(parsed.port);
			}
		} else {
			host = trimmed;
		}
	}

	if (!host || host.length === 0) {
		return undefined;
	}

	const routerUrlPort =
		typeof portFromRouterUrl === 'number' && Number.isFinite(portFromRouterUrl)
			? portFromRouterUrl
			: DEFAULT_PORT;

	return {
		host,
		port: parsePositiveNumber(params.port, routerUrlPort),
	};
};

const buildPromptRegex = (prompt: string): RegExp =>
	new RegExp(escapeRegExp(prompt), 'g');

const countPromptOccurrences = (text: string, prompt: string): number => {
	const matches = text.match(buildPromptRegex(prompt));
	return matches ? matches.length : 0;
};

const buildKeyboardInteractiveResponses = (
	prompts: Prompt[],
	password: string,
): string[] =>
	prompts.map((prompt) => {
		const promptText = prompt.prompt.trim().toLowerCase();
		if (!prompt.echo && promptText.includes('password')) {
			return password;
		}

		return '';
	});

const runSshCommand = async (
	params: VigorVdslParams,
	target: ResolvedTarget,
	timeoutMs: number,
): Promise<string> => {
	const username = params.username?.trim() || '';
	const password = params.password || '';
	const command = params.command?.trim() || DEFAULT_COMMAND;
	const prompt = params.prompt?.trim() || DEFAULT_PROMPT;
	const kexAlgorithms = parseCsvList(
		params.kexAlgorithms,
		DEFAULT_KEX_ALGORITHMS,
	);
	const ciphers = parseCsvList(params.ciphers, DEFAULT_CIPHERS);
	const hostKeyAlgorithms = parseCsvList(
		params.hostKeyAlgorithms,
		DEFAULT_HOST_KEY_ALGORITHMS,
	);
	const algorithms: NonNullable<ConnectConfig['algorithms']> = {
		kex: {append: kexAlgorithms, prepend: [], remove: []},
		cipher: {append: ciphers, prepend: [], remove: []},
		serverHostKey: {
			append: hostKeyAlgorithms,
			prepend: [],
			remove: [],
		},
	};

	return await new Promise<string>((resolve, reject) => {
		const client = new Client();
		let stream: ClientChannel | undefined;
		let settled = false;
		let commandSent = false;
		let promptSeenCount = 0;
		let stdout = '';
		let stderr = '';

		const finish = (callback: () => void): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutHandle);
			callback();
			client.end();
		};

		const timeoutHandle = setTimeout(() => {
			finish(() => {
				reject(
					new Error(
						commandSent
							? `timeout after ${timeoutMs}ms while waiting for command output`
							: `timeout after ${timeoutMs}ms while waiting for CLI prompt ${prompt}`,
					),
				);
			});
		}, timeoutMs);

		client.on(
			'keyboard-interactive',
			(
				_name: string,
				_instructions: string,
				_language: string,
				prompts: Prompt[],
				finishPrompts: (responses: string[]) => void,
			) => {
				finishPrompts(buildKeyboardInteractiveResponses(prompts, password));
			},
		);

		client.on('ready', () => {
			client.shell({term: 'vt100', cols: 120, rows: 40}, (error, channel) => {
				if (error) {
					finish(() => reject(error));
					return;
				}

				stream = channel;
				stream.setEncoding('utf8');

				stream.on('data', (chunk: string | Buffer) => {
					stdout += chunk.toString();
					const nextPromptCount = countPromptOccurrences(stdout, prompt);

					if (!commandSent && nextPromptCount > 0) {
						commandSent = true;
						promptSeenCount = nextPromptCount;
						stream?.write(`${command}\n`);
						return;
					}

					if (commandSent && nextPromptCount > promptSeenCount) {
						finish(() => resolve(stdout));
					}
				});

				stream.stderr.on('data', (chunk: string | Buffer) => {
					stderr += chunk.toString();
				});

				stream.on('close', () => {
					if (settled) {
						return;
					}

					if (stdout.trim().length > 0) {
						finish(() => resolve(stdout));
						return;
					}

					const message =
						stderr.trim().length > 0
							? stderr.trim()
							: 'SSH shell closed unexpectedly';
					finish(() => reject(new Error(message)));
				});
			});
		});

		client.on('error', (error: Error) => {
			finish(() => reject(error));
		});

		client.on('close', () => {
			if (settled) {
				return;
			}
			const message =
				stderr.trim().length > 0
					? stderr.trim()
					: 'SSH connection closed unexpectedly';
			finish(() => reject(new Error(message)));
		});

		const config: ConnectConfig = {
			host: target.host,
			port: target.port,
			username,
			password,
			readyTimeout: timeoutMs,
			tryKeyboard: true,
			algorithms,
		};

		client.connect(config);
	});
};

export const extractDslMetricsFromPayload = (
	payloadText: string,
): ParsedDslMetrics => {
	const text = payloadText.split('\0').join(' ');

	const downstreamRaw = readRegexNumber(text, [
		/DS\s+Actual\s+Rate\s*:\s*([\d.]+)/i,
		/Actual\s+Rate\s+([\d.]+)/i,
		/downstream(?:\s+sync)?(?:\s+rate)?[^\d]{0,20}([\d.]+)/i,
		/rx\s*rate[^\d]{0,20}([\d.]+)/i,
	]);
	const upstreamRaw = readRegexNumber(text, [
		/US\s+Actual\s+Rate\s*:\s*([\d.]+)/i,
		/Actual\s+Rate\s+[\d.]+\s+Kbps\s+([\d.]+)/i,
		/upstream(?:\s+sync)?(?:\s+rate)?[^\d]{0,20}([\d.]+)/i,
		/tx\s*rate[^\d]{0,20}([\d.]+)/i,
	]);

	const snrDownDb = readRegexNumber(text, [
		/Cur\s+SNR\s+Margin\s*:\s*([\d.]+)/i,
		/snr(?:\s*margin)?\s*(?:down(?:stream)?)?[^\d]{0,20}([\d.]+)/i,
		/noise\s*margin\s*(?:down(?:stream)?)?[^\d]{0,20}([\d.]+)/i,
	]);

	const attenuationDownDb = readRegexNumber(text, [
		/NE\s+Current\s+Attenuation\s*:\s*([\d.]+)/i,
		/attenuation\s*(?:down(?:stream)?)?[^\d]{0,20}([\d.]+)/i,
		/line\s*attenuation\s*(?:down(?:stream)?)?[^\d]{0,20}([\d.]+)/i,
	]);

	const crcErrors = readRegexNumber(text, [
		/NE\s+CRC\s+Count\s*:\s*(\d+)/i,
		/crc(?:\s+errors?)?[^\d]{0,20}(\d+)/i,
	]);
	const fecErrors = readRegexNumber(text, [
		/FEC(?:\s+Errors?)?[^\d]{0,20}(\d+)/i,
		/fec(?:\s+errors?)?[^\d]{0,20}(\d+)/i,
	]);
	const esCount = readRegexNumber(text, [
		/NE\s+ES\s+Count\s*:\s*(\d+)/i,
		/es(?:\s+seconds?)?[^\d]{0,20}(\d+)/i,
	]);
	const feEsCount = readRegexNumber(text, [
		/FE\s+ES\s+Count\s*:\s*(\d+)/i,
		/far.*es.*count[^\d]{0,20}(\d+)/i,
	]);

	const dsAttainableRaw = readRegexNumber(text, [
		/DS\s+Attainable\s+Rate\s*:\s*([\d.]+)/i,
		/attainable.*rate.*ds[^\d]{0,20}([\d.]+)/i,
	]);
	const usAttainableRaw = readRegexNumber(text, [
		/US\s+Attainable\s+Rate\s*:\s*([\d.]+)/i,
		/attainable.*rate.*us[^\d]{0,20}([\d.]+)/i,
	]);

	const dsPsd = readRegexNumber(text, [
		/NE\s+actual\s+PSD\s*:\s*([\d.]+)/i,
		/ds.*psd[^\d]{0,20}([\d.]+)/i,
	]);
	const usPsd = readRegexNumber(text, [
		/US\s+actual\s+PSD\s*:\s*([\d.]+)/i,
		/us.*psd[^\d]{0,20}([\d.]+)/i,
	]);

	const dsInterleaveDepth = readRegexNumber(text, [
		/DS\s+Interleave\s+Depth\s*:\s*(\d+)/i,
		/ds.*interleave.*depth[^\d]{0,20}(\d+)/i,
	]);
	const usInterleaveDepth = readRegexNumber(text, [
		/US\s+Interleave\s+Depth\s*:\s*(\d+)/i,
		/us.*interleave.*depth[^\d]{0,20}(\d+)/i,
	]);

	const farAttenuationDb = readRegexNumber(text, [
		/Far\s+Current\s+Attenuation\s*:\s*([\d.]+)/i,
		/far.*attenuation[^\d]{0,20}([\d.]+)/i,
	]);
	const farSnrDb = readRegexNumber(text, [
		/Far\s+SNR\s+Margin\s*:\s*([\d.]+)/i,
		/far.*snr.*margin[^\d]{0,20}([\d.]+)/i,
	]);

	const uptimeString = readRegexValue(text, [
		/(?:dsl\s*)?uptime[^\dA-Za-z]{0,20}([\ddhms:\s]+)/i,
	]);
	const dslUptimeSeconds = parseDurationToSeconds(uptimeString);

	const linkState = readRegexValue(text, [
		/State\s*:\s*([A-Za-z]+)/i,
		/(?:dsl\s*)?(?:link|line)\s*(?:state|status)[^A-Za-z]{0,20}([A-Za-z]+)/i,
	]);
	const isDslUp =
		typeof linkState === 'string'
			? ['up', 'showtime', 'connected', 'online'].includes(
					linkState.trim().toLowerCase(),
				)
			: undefined;

	return {
		downstreamMbps:
			typeof downstreamRaw === 'number'
				? normalizeRateToMbps(downstreamRaw)
				: undefined,
		upstreamMbps:
			typeof upstreamRaw === 'number'
				? normalizeRateToMbps(upstreamRaw)
				: undefined,
		snrDownDb,
		attenuationDownDb,
		crcErrors,
		fecErrors,
		dslUptimeSeconds,
		isDslUp,
		esCount,
		feEsCount,
		dsAttainableMbps:
			typeof dsAttainableRaw === 'number'
				? normalizeRateToMbps(dsAttainableRaw)
				: undefined,
		usAttainableMbps:
			typeof usAttainableRaw === 'number'
				? normalizeRateToMbps(usAttainableRaw)
				: undefined,
		dsPsd,
		usPsd,
		dsInterleaveDepth,
		usInterleaveDepth,
		farAttenuationDb,
		farSnrDb,
	};
};

export const checkVigor165Vdsl = async (params: {[key: string]: string}) => {
	const resolvedParams: VigorVdslParams = params;

	const target = resolveTarget(resolvedParams);
	if (!target || !resolvedParams.username || !resolvedParams.password) {
		return {
			message: usageMessage(),
			code: STATUS_UNKNOWN,
		};
	}

	const bookedDownstreamMbps = parsePositiveNumber(
		resolvedParams.bookedDownstreamMbps,
		NaN,
	);
	if (!Number.isFinite(bookedDownstreamMbps)) {
		return {
			message: `${usageMessage()} bookedDownstreamMbps must be a positive number.`,
			code: STATUS_UNKNOWN,
		};
	}

	const warningPercentBelow = parsePercent(
		resolvedParams.warningPercentBelow,
		20,
	);
	const criticalPercentBelow = parsePercent(
		resolvedParams.criticalPercentBelow,
		40,
	);
	if (criticalPercentBelow < warningPercentBelow) {
		return {
			message:
				'criticalPercentBelow must be greater than or equal to warningPercentBelow.',
			code: STATUS_UNKNOWN,
		};
	}

	const timeoutMs = parsePositiveNumber(
		resolvedParams.timeoutMs,
		DEFAULT_TIMEOUT_MS,
	);

	try {
		const payloadText = await runSshCommand(resolvedParams, target, timeoutMs);
		const metrics = extractDslMetricsFromPayload(payloadText);

		if (typeof metrics.downstreamMbps !== 'number') {
			return {
				message:
					'Could not parse downstream sync rate from VDSL SSH output. Verify the CLI command and prompt settings for this DrayTek router.',
				code: STATUS_UNKNOWN,
			};
		}

		const deltaPercent =
			((bookedDownstreamMbps - metrics.downstreamMbps) / bookedDownstreamMbps) *
			100;
		const boundedDelta = Math.max(0, deltaPercent);

		let code = STATUS_OK;
		const findings: string[] = [];
		if (metrics.isDslUp === false) {
			code = STATUS_CRITICAL;
			findings.push('dsl link appears down');
		}

		if (boundedDelta >= criticalPercentBelow) {
			code = Math.max(code, STATUS_CRITICAL);
			findings.push(
				`downstream ${round(metrics.downstreamMbps, 2)} Mbps is ${round(
					boundedDelta,
					1,
				)}% below booked ${round(bookedDownstreamMbps, 2)} Mbps (critical ${criticalPercentBelow}%)`,
			);
		} else if (boundedDelta >= warningPercentBelow) {
			code = Math.max(code, STATUS_WARNING);
			findings.push(
				`downstream ${round(metrics.downstreamMbps, 2)} Mbps is ${round(
					boundedDelta,
					1,
				)}% below booked ${round(bookedDownstreamMbps, 2)} Mbps (warning ${warningPercentBelow}%)`,
			);
		}

		const summaryParts: string[] = [
			`down ${round(metrics.downstreamMbps, 2)} Mbps`,
		];
		if (typeof metrics.upstreamMbps === 'number') {
			summaryParts.push(`up ${round(metrics.upstreamMbps, 2)} Mbps`);
		}
		if (typeof metrics.snrDownDb === 'number') {
			summaryParts.push(`snrDown ${round(metrics.snrDownDb, 1)} dB`);
		}
		if (typeof metrics.attenuationDownDb === 'number') {
			summaryParts.push(`attDown ${round(metrics.attenuationDownDb, 1)} dB`);
		}

		const performanceData: PerformanceDataEntry[] = [
			{
				label: 'downstream_mbps',
				value: round(metrics.downstreamMbps, 2),
				uom: 'Mb/s',
				warn: round(bookedDownstreamMbps * (1 - warningPercentBelow / 100), 2),
				crit: round(bookedDownstreamMbps * (1 - criticalPercentBelow / 100), 2),
				min: '0',
			},
			{
				label: 'downstream_below_percent',
				value: round(boundedDelta, 2),
				uom: '%',
				warn: String(warningPercentBelow),
				crit: String(criticalPercentBelow),
				min: '0',
			},
		];

		if (typeof metrics.upstreamMbps === 'number') {
			performanceData.push({
				label: 'upstream_mbps',
				value: round(metrics.upstreamMbps, 2),
				uom: 'Mb/s',
				min: '0',
			});
		}
		if (typeof metrics.snrDownDb === 'number') {
			performanceData.push({
				label: 'snr_down_db',
				value: round(metrics.snrDownDb, 2),
				uom: 'dB',
				min: '0',
			});
		}
		if (typeof metrics.attenuationDownDb === 'number') {
			performanceData.push({
				label: 'attenuation_down_db',
				value: round(metrics.attenuationDownDb, 2),
				uom: 'dB',
				min: '0',
			});
		}
		if (typeof metrics.crcErrors === 'number') {
			performanceData.push({
				label: 'crc_errors',
				value: String(metrics.crcErrors),
				uom: 'c',
				min: '0',
			});
		}
		if (typeof metrics.fecErrors === 'number') {
			performanceData.push({
				label: 'fec_errors',
				value: String(metrics.fecErrors),
				uom: 'c',
				min: '0',
			});
		}
		if (typeof metrics.esCount === 'number') {
			performanceData.push({
				label: 'es_errors',
				value: String(metrics.esCount),
				uom: 'c',
				min: '0',
			});
		}
		if (typeof metrics.feEsCount === 'number') {
			performanceData.push({
				label: 'fe_es_errors',
				value: String(metrics.feEsCount),
				uom: 'c',
				min: '0',
			});
		}
		if (typeof metrics.dsAttainableMbps === 'number') {
			performanceData.push({
				label: 'ds_attainable_mbps',
				value: round(metrics.dsAttainableMbps, 2),
				uom: 'Mb/s',
				min: '0',
			});
		}
		if (typeof metrics.usAttainableMbps === 'number') {
			performanceData.push({
				label: 'us_attainable_mbps',
				value: round(metrics.usAttainableMbps, 2),
				uom: 'Mb/s',
				min: '0',
			});
		}
		if (typeof metrics.dsPsd === 'number') {
			performanceData.push({
				label: 'ds_psd',
				value: round(metrics.dsPsd, 2),
				uom: 'dB',
				min: '0',
			});
		}
		if (typeof metrics.usPsd === 'number') {
			performanceData.push({
				label: 'us_psd',
				value: round(metrics.usPsd, 2),
				uom: 'dB',
				min: '0',
			});
		}
		if (typeof metrics.dsInterleaveDepth === 'number') {
			performanceData.push({
				label: 'ds_interleave_depth',
				value: String(metrics.dsInterleaveDepth),
				uom: 'c',
				min: '0',
			});
		}
		if (typeof metrics.usInterleaveDepth === 'number') {
			performanceData.push({
				label: 'us_interleave_depth',
				value: String(metrics.usInterleaveDepth),
				uom: 'c',
				min: '0',
			});
		}
		if (typeof metrics.farAttenuationDb === 'number') {
			performanceData.push({
				label: 'far_attenuation_db',
				value: round(metrics.farAttenuationDb, 2),
				uom: 'dB',
				min: '0',
			});
		}
		if (typeof metrics.farSnrDb === 'number') {
			performanceData.push({
				label: 'far_snr_db',
				value: round(metrics.farSnrDb, 2),
				uom: 'dB',
				min: '0',
			});
		}
		if (typeof metrics.dslUptimeSeconds === 'number') {
			performanceData.push({
				label: 'dsl_uptime_seconds',
				value: String(metrics.dslUptimeSeconds),
				uom: 's',
				min: '0',
			});
		}
		if (typeof metrics.isDslUp === 'boolean') {
			performanceData.push({
				label: 'dsl_up',
				value: metrics.isDslUp ? '1' : '0',
				uom: 'c',
				min: '0',
			});
		}

		const stateText =
			['OK', 'WARNING', 'CRITICAL', 'UNKNOWN'][code] || 'UNKNOWN';
		const details =
			findings.length > 0
				? findings.join('; ')
				: `router reachable over ssh, ${summaryParts.join(', ')}`;

		return {
			message: `Vigor 165 VDSL ${stateText} - ${details}`,
			code,
			performanceData,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return {
			message: `Vigor SSH status error: ${errorMessage}`,
			code: STATUS_UNKNOWN,
		};
	}
};
