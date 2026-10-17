import {escapeHtml} from './html-escape';
import {renderHtmlDocument} from './ui-components';

export type StartupWarningHelpTopic = {
	id: string;
	title: string;
	description: string;
	handlingSteps: string[];
};

type StartupWarningClassifier = {
	id: string;
	matcher: RegExp;
};

const HELP_ROUTE_PREFIX = '/help/startup-warnings';

const WARNING_TOPICS: Record<string, StartupWarningHelpTopic> = {
	'api-key-missing': {
		id: 'api-key-missing',
		title: 'API Key Not Configured',
		description:
			'Requests are not protected by a shared-secret API key, which weakens endpoint access control.',
		handlingSteps: [
			'Set a strong API_KEY in the service configuration file (/etc/nest/nest.conf).',
			'Keep the configuration file readable only by the service account (chmod 600).',
			'Optionally set API_KEY_HEADER if you need a custom header name.',
			'Restart the service and update clients to send the configured header.',
		],
	},
	'admin-ui-password-missing': {
		id: 'admin-ui-password-missing',
		title: 'Admin UI Password Not Configured',
		description:
			'The admin UI is always mounted, but ADMIN_UI_PASSWORD is empty, so no credential can grant access to it. Every admin route renders a "not configured" page until a password is set.',
		handlingSteps: [
			'Set a strong ADMIN_UI_PASSWORD in the service configuration file (/etc/nest/nest.conf).',
			'Keep the configuration file readable only by the service account (chmod 600).',
			'Restart the service, then open the /admin path to sign in.',
		],
	},
	'allowed-ips-empty': {
		id: 'allowed-ips-empty',
		title: 'Allowed IP List Not Configured',
		description:
			'No ALLOWED_IPS value is configured, so access is restricted to loopback by default (127.0.0.1, ::1).',
		handlingSteps: [
			'Set ALLOWED_IPS to a comma-separated list of trusted monitoring source IPs.',
			'Use exact IP values and avoid leaving the variable blank.',
			'Alternatively, use * to allow all IPs (NOT recommended for production).',
		],
	},
	'rate-limit-disabled': {
		id: 'rate-limit-disabled',
		title: 'Rate Limiting Effectively Disabled',
		description:
			'RATE_LIMIT_WINDOW_MS or RATE_LIMIT_MAX is non-positive, so rate limiting does not protect the server.',
		handlingSteps: [
			'Set RATE_LIMIT_WINDOW_MS to a positive value (for example 60000).',
			'Set RATE_LIMIT_MAX to a positive value that fits your traffic profile.',
		],
	},
	'plugin-hash-failed': {
		id: 'plugin-hash-failed',
		title: 'Plugin Hash Calculation Failed',
		description:
			'The service could not read or hash a plugin file, so it was not registered.',
		handlingSteps: [
			'Confirm the plugin file exists and is readable by the service user.',
			'Check filesystem errors and path configuration for PLUGINS_DIR.',
		],
	},
	'plugin-no-manifest': {
		id: 'plugin-no-manifest',
		title: 'Plugin Has No Manifest',
		description:
			'Each plugin is trusted by a sidecar manifest (<name>.manifest.json) sitting next to it. A plugin file with no manifest is refused at startup (fail-secure), so its routes are not registered.',
		handlingSteps: [
			'Review the plugin source code and intended behavior.',
			'Create a sidecar manifest named "<plugin>.manifest.json" next to the plugin file, declaring at least "name", "version" and "entry".',
			'Run "nest plugins hash" to record the plugin SHA-256 into its manifest.',
			'Restart the service to load the now-trusted plugin.',
		],
	},
	'plugin-unhashed': {
		id: 'plugin-unhashed',
		title: 'Plugin Manifest Has No Hash',
		description:
			'The plugin loaded, but its manifest declares no "hash", so it was loaded without integrity verification. Filesystem ownership and permission checks remain the security boundary for this case.',
		handlingSteps: [
			'Review the plugin source and confirm it is the intended code.',
			'Run "nest plugins hash" to record the current SHA-256 into the plugin manifest.',
			'Restart the service so the plugin is loaded with integrity verification.',
		],
	},
	'plugin-insecure-permissions': {
		id: 'plugin-insecure-permissions',
		title: 'Plugin File Permissions Are Insecure',
		description:
			'The plugin file is writable by group or other users, so the service refuses to register it.',
		handlingSteps: [
			'Set restrictive permissions on the plugin file so only the service owner can modify it.',
			'Confirm the file is not group-writable or world-writable with ls -l.',
			'Restart the service after fixing the file permissions.',
		],
	},
	'config-insecure-permissions': {
		id: 'config-insecure-permissions',
		title: 'Config File Permissions Are Insecure',
		description:
			'The config file is writable by group or other users, so the service refuses to trust it.',
		handlingSteps: [
			'Set restrictive permissions on the config file so only the service owner can modify it.',
			'Use chmod 640 or chmod 600 to remove group/world write access.',
			'Example: chmod 640 plugins/configs/local-presets.conf',
			'Restart the service after fixing the file permissions.',
		],
	},
	'plugin-hash-changed': {
		id: 'plugin-hash-changed',
		title: 'Plugin Hash Changed',
		description:
			'The current plugin file hash does not match the hash declared in its sidecar manifest, so the plugin was not loaded.',
		handlingSteps: [
			'Review the plugin diff and confirm the change is expected.',
			'Run "nest plugins hash" to update the hash in the plugin manifest.',
			'Restart the service to load the updated plugin.',
		],
	},
	'config-drift-awaiting-approval': {
		id: 'config-drift-awaiting-approval',
		title: 'Config File Changed Since Approval',
		description:
			'The local config presets file on disk no longer matches the hash stored in LOCAL_CONFIG_HASH. The presets that are currently served are still the approved ones; the edited file is only loaded after the hash is approved and the service is restarted.',
		handlingSteps: [
			'Review the file contents, for example with: diff <file> <backup> or the admin UI editor.',
			'Calculate the current hash: sha256sum plugins/configs/local-presets.conf',
			'Run "nest plugins hash" or set "LOCAL_CONFIG_HASH=<sha256>" in the nest config file (/etc/nest/nest.conf).',
			'Restart the service so the approved file is loaded again.',
			'If the edit was accidental, use "Revert to approved" in the admin UI instead of approving it.',
		],
	},
	'cert-replaced': {
		id: 'cert-replaced',
		title: 'TLS Certificate Replaced Automatically',
		description:
			'The certificate on disk did not qualify anymore - it missed a required SAN or was close to expiry - so the service created a new self-signed certificate before starting HTTPS. The old key is gone and the new certificate has a different fingerprint.',
		handlingSteps: [
			'No configuration change is needed: HTTPS is already serving the new certificate.',
			'Re-open the Web UI and accept the new certificate, or re-import it into the client trust store.',
			'If a certificate fingerprint is pinned somewhere (monitoring, SSH tunnel, client config), replace it with the new one: openssl x509 -in <cert path> -noout -fingerprint -sha256',
			'Serve a certificate from your own CA at TLS_CERT_PATH and TLS_KEY_PATH to avoid self-signed warnings permanently.',
			'Restart the service once: the warning belongs to the run that replaced the certificate and is not shown again.',
		],
	},
	'cert-generated': {
		id: 'cert-generated',
		title: 'TLS Certificate Generated Automatically',
		description:
			'No usable certificate and key were found at TLS_CERT_PATH and TLS_KEY_PATH, so the service generated a self-signed pair to be able to start HTTPS.',
		handlingSteps: [
			'No configuration change is needed: HTTPS is already serving the new certificate.',
			'Open the Web UI and accept the self-signed certificate, or import it into the client trust store.',
			'Keep the generated files: regenerating them changes the fingerprint again and invalidates any pinned value.',
			'Serve a certificate from your own CA at TLS_CERT_PATH and TLS_KEY_PATH to avoid self-signed warnings permanently.',
			'Restart the service once: the warning belongs to the run that created the certificate and is not shown again.',
		],
	},
	unknown: {
		id: 'unknown',
		title: 'Generic Startup Warning',
		description:
			'This warning did not match a known category. Use the message text and startup logs to triage the issue.',
		handlingSteps: [
			'Read the full warning text and related server log lines.',
			'Resolve the underlying configuration or file-state issue.',
		],
	},
};

const CLASSIFIERS: StartupWarningClassifier[] = [
	{id: 'api-key-missing', matcher: /API_KEY is not configured/i},
	{
		id: 'admin-ui-password-missing',
		matcher: /ADMIN_UI_PASSWORD is not configured/i,
	},
	{id: 'allowed-ips-empty', matcher: /ALLOWED_IPS is not configured/i},
	{
		id: 'rate-limit-disabled',
		matcher: /rate limiting is effectively disabled/i,
	},
	{
		id: 'plugin-hash-failed',
		matcher: /Plugin trust warning: could not hash/i,
	},
	{id: 'plugin-unhashed', matcher: /has no "hash" in its manifest/i},
	{id: 'plugin-hash-changed', matcher: /hash changed\. Manifest expects/i},
	{
		id: 'plugin-no-manifest',
		matcher: /: no manifest .*must ship a sidecar manifest/i,
	},
	{
		id: 'plugin-insecure-permissions',
		matcher: /Skipping plugin .* due to insecure permissions/i,
	},
	{
		id: 'config-insecure-permissions',
		matcher: /Config file .* has insecure permissions/i,
	},
	{
		id: 'config-drift-awaiting-approval',
		matcher: /presets file on disk is awaiting approval/i,
	},
	{id: 'cert-replaced', matcher: /TLS certificate replaced automatically/i},
	{id: 'cert-generated', matcher: /TLS certificate or key was missing/i},
];

export const resolveStartupWarningTopicId = (warning: string): string => {
	for (const classifier of CLASSIFIERS) {
		if (classifier.matcher.test(warning)) {
			return classifier.id;
		}
	}

	return 'unknown';
};

export const getStartupWarningHelpPath = (topicId: string): string =>
	`${HELP_ROUTE_PREFIX}/${topicId}`;

export const getStartupWarningHelpTopic = (
	topicId: string,
): StartupWarningHelpTopic | undefined => WARNING_TOPICS[topicId];

export const renderStartupWarningListItems = (warnings: string[]): string => {
	return warnings
		.map((warning) => {
			const topicId = resolveStartupWarningTopicId(warning);
			const helpPath = getStartupWarningHelpPath(topicId);

			return `<li><p>${escapeHtml(warning)}</p><p><a href="${helpPath}">How to resolve this warning</a></p></li>`;
		})
		.join('');
};

export const renderStartupWarningHelpHtml = (
	topic: StartupWarningHelpTopic,
): string => {
	return renderHtmlDocument({
		title: `Startup Warning Help: ${topic.title}`,
		backHref: '/',
		subtitle: topic.description,
		contentHtml: `<h2>How To Handle</h2>
<ol>${topic.handlingSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`,
	});
};
