import type {
	HtmlTemplateString,
	PluginMeta,
	PluginReturn,
} from '../../../../src/types/plugin';

/**
 * Fixture plugin that declares **no** parameters.
 *
 * Exists to cover the bare-GET rendering path: the overview page must show the
 * route header without a run form, and the admin editor must render an entry
 * with an empty parameter grid rather than breaking.
 */
export const meta: PluginMeta = {
	usage: {
		http: '/plugins/check-ui-minimal',
		shell: './check_nest.sh check-ui-minimal',
	},
	help: `<h1>check-ui-minimal</h1>
<p>Fixture plugin with no parameters.</p>` as HtmlTemplateString,
	params: [],
};

export const checkUiMinimal = (): PluginReturn => ({
	message: 'MINIMAL: fixture plugin with no parameters',
	code: 0,
});
