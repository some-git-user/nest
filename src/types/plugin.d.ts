import type {NagiosPerformanceData} from './nagios';

export type PluginExampleFieldInputType = 'text' | 'password' | 'url';

/**
 * Authoring-time field definition used inside plugin meta.examples.
 *
 * Defaults applied by the core parser:
 * - label falls back to name
 * - required defaults to true unless explicitly set to false
 * - type defaults to text unless explicitly set to password or url
 */
type PluginMetaExampleFieldDefinition = {
	name: string;
	label?: string;
	required?: boolean;
	type?: PluginExampleFieldInputType;
	defaultValue?: string;
};

/**
 * Authoring-time example definition used by plugins.
 *
 * Supported forms:
 * - object: interactive example rendered as a GET or POST form
 */
type PluginMetaExampleDefinition = {
	label?: string;
	method?: 'GET' | 'POST';
	path: string;
	fields: PluginMetaExampleFieldDefinition[];
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
	examples: PluginMetaExampleDefinition[];
};

/**
 * Normalized runtime field shape after the core parser has applied defaults.
 */
export type PluginExampleField = {
	name: string;
	label: string;
	required: boolean;
	type: PluginExampleFieldInputType;
	defaultValue?: string;
};

/**
 * Normalized runtime example shape rendered by the overview page.
 */
export type PluginRouteExample =
	| {
			kind: 'link';
			label: string;
			method: 'GET';
			href: string;
	  }
	| {
			kind: 'interactive';
			label: string;
			method: 'GET' | 'POST';
			path: string;
			fields: PluginExampleField[];
	  };

/**
 * Standard return type for plugin execution results.
 * Used by both the core plugin loader and plugin implementations.
 */
export type PluginReturn = {
	message: string;
	code: NagiosReturnCodes;
	performanceData?: NagiosPerformanceData[];
};
