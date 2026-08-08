/**
 * Convert plugin command to route path
 * Shared utility used by both dynamic-routes.ts and local-config.ts
 *
 * @param command Plugin command name (e.g., 'check-test', 'check_debian_eol')
 * @returns Route path (e.g., '/plugins/check-test', '/plugins/check-debian-eol')
 */
export const commandToRoutePath = (command: string): string => {
	// Convert underscores to hyphens and lowercase (same as buildPluginRoutePath)
	const normalizedPathSegment = command
		.replace(/_/g, '-')
		.replace(/[^a-zA-Z0-9]/g, '-')
		.toLowerCase();

	return `/plugins/${normalizedPathSegment}`;
};
