import type {NagiosPerformanceData, NagiosReturnCode} from './nagios';

export type PluginParamInputType =
	| 'text'
	| 'password'
	| 'url'
	| 'number'
	| 'boolean';

/**
 * Authoring-time parameter definition used inside plugin meta.params.
 *
 * This is the authoritative list of query parameters a plugin accepts. It
 * drives the overview-page run form, the admin local-preset editor, and
 * secret masking — so every settable parameter must be declared here.
 *
 * Defaults applied by the core parser:
 * - label falls back to name
 * - required defaults to false (plugin parameters are optional unless the
 *   plugin rejects their absence)
 * - type defaults to text
 */
type PluginMetaParamDefinition = {
	name: string;
	label?: string;
	required?: boolean;
	type?: PluginParamInputType;
	default?: string;
	/** Explanatory line rendered under the input. */
	description?: string;
};

export type PluginMetaUsage = {
	http?: string;
	shell?: string;
};

/**
 * HTML template string type for help content.
 * Used to distinguish HTML content from regular strings in plugin metadata.
 *
 * @example
 * ```typescript
 * const help = `<h1>Plugin Help</h1><p>Description here</p>`;
 * ```
 */
export type HtmlTemplateString = string & {
	readonly __htmlTemplate: unique symbol;
};

/**
 * Shared plugin metadata contract consumed by both plugin authors and the core loader.
 */
export type PluginMeta = {
	usage: PluginMetaUsage;
	help: HtmlTemplateString;
	params: PluginMetaParamDefinition[];
};

/**
 * Normalized runtime parameter shape after the core parser has applied defaults.
 */
export type PluginParam = {
	name: string;
	label: string;
	required: boolean;
	type: PluginParamInputType;
	default?: string;
	description?: string;
};

/**
 * Standard return type for plugin execution results.
 * Used by both the core plugin loader and plugin implementations.
 */
export type PluginReturn = {
	message: string;
	code: NagiosReturnCode;
	performanceData?: NagiosPerformanceData[];
};
