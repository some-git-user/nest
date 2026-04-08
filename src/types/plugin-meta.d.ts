export type PluginExampleFieldInputType = 'text' | 'password' | 'url';

/**
 * Authoring-time field definition used inside plugin meta.examples.
 *
 * Defaults applied by the core parser:
 * - label falls back to name
 * - required defaults to true unless explicitly set to false
 * - type defaults to text unless explicitly set to password or url
 */
export type PluginMetaExampleFieldDefinition = {
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
 * - string: GET link example beginning with /
 * - object: interactive example rendered as a GET or POST form
 */
export type PluginMetaExampleDefinition =
	| string
	| {
			label?: string;
			method?: 'GET' | 'POST';
			path: string;
			fields: PluginMetaExampleFieldDefinition[];
	  };

export type PluginMetaUsage =
	| string
	| {
			http?: string;
			shell?: string;
	  };

/**
 * Shared plugin metadata contract consumed by both plugin authors and the core loader.
 */
export type PluginMeta = {
	usage?: PluginMetaUsage;
	help?: string;
	examples?: PluginMetaExampleDefinition[];
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
