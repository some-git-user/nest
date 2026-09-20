import type {NagiosReturnCode} from '../../../../src/types/nagios';
import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../../../../src/types/plugin';

/**
 * Fixture plugin for the Playwright UI suite.
 *
 * Lives in `tests/ui/fixtures/plugins/` and is copied into a scratch directory
 * at test setup, never into the real `plugins/` tree. It is deliberately
 * inert: no subprocess, no network, no filesystem. Every result is derived
 * from its parameters, so assertions are deterministic and the admin "Test"
 * button — which executes a plugin with the server's own API key — can only
 * ever reach code that cannot touch the host.
 *
 * The parameter set is chosen to exercise the whole form-rendering path:
 * text, number, boolean, a required field, and a default.
 */
export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-ui-echo?message=<string>&code=<0|1|2|3>&repeat=<number>&flag=<true|false>',
		shell:
			'./check_nest.sh check-ui-echo message=<string> code=<0|1|2|3> repeat=<number> flag=<true|false>',
	},
	help: `<h1>check-ui-echo</h1>
<p>Fixture plugin used by the UI tests. Echoes its parameters back so a test
can assert exactly what the server received.</p>` as HtmlTemplateString,
	params: [
		{
			name: 'message',
			label: 'Message',
			type: 'text',
			required: true,
			description: 'The message to echo back in the check result.',
		},
		{
			name: 'code',
			label: 'Return code',
			type: 'number',
			default: '0',
			description:
				'Nagios return code: 0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN.',
		},
		{
			name: 'repeat',
			label: 'Repeat',
			type: 'number',
			default: '1',
			description: 'How many times to repeat the message.',
		},
		{
			name: 'flag',
			label: 'Include performance data',
			type: 'boolean',
			default: 'false',
			description: 'When true, attaches sample performance data.',
		},
	],
};

const toCode = (value: unknown): NagiosReturnCode => {
	const parsed = Number(value);
	return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : 0;
};

export const checkUiEcho = (params: {
	message?: string;
	code?: number;
	repeat?: number;
	flag?: boolean;
}): PluginReturn => {
	const message = params.message ?? 'no message given';
	const repeat = Number.isFinite(params.repeat) ? Number(params.repeat) : 1;
	const code = toCode(params.code);

	const result: PluginReturn = {
		message: Array.from({length: Math.max(1, repeat)}, () => message).join(' '),
		code,
		performanceData: [],
	};

	if (params.flag === true) {
		result.performanceData?.push({
			label: 'ui_echo_messages',
			value: repeat,
			uom: 'count',
			warn: '5',
			crit: '10',
		});
	}

	return result;
};
