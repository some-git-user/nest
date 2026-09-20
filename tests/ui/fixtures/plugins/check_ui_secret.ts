import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../../../../src/types/plugin';

/**
 * Fixture plugin with a secret parameter.
 *
 * Exercises the masking path end to end: `param.type === 'password'` makes the
 * admin editor render a password input with the "stored — leave empty to keep"
 * placeholder, and `secretParamNamesForCommand()` reports the name so the
 * stored value never reaches the browser.
 *
 * The check itself never logs or returns the secret's value — only its length —
 * so a leaked secret cannot leak further through a test assertion.
 */
export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-ui-secret?token=<string>&endpoint=<string>',
		shell: './check_nest.sh check-ui-secret token=<string> endpoint=<string>',
	},
	help: `<h1>check-ui-secret</h1>
<p>Fixture plugin with a password-typed parameter, used to verify secret
masking in the admin editor.</p>` as HtmlTemplateString,
	params: [
		{
			name: 'token',
			label: 'API token',
			type: 'password',
			required: true,
			description: 'A secret the editor must never send to the browser.',
		},
		{
			name: 'endpoint',
			label: 'Endpoint',
			type: 'text',
			default: 'https://example.invalid',
			description: 'A non-secret parameter, for contrast.',
		},
	],
};

export const checkUiSecret = (params: {
	token?: string;
	endpoint?: string;
}): PluginReturn => {
	const token = params.token ?? '';
	if (token.length === 0) {
		return {
			message: 'UI_SECRET: missing token',
			code: 3,
		};
	}

	return {
		message: `UI_SECRET: token accepted (length ${token.length})`,
		code: 0,
		performanceData: [
			{
				label: 'token_length',
				value: token.length,
				uom: 'count',
			},
		],
	};
};
