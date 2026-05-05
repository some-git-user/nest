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
	'middleware-disabled': {
		id: 'middleware-disabled',
		title: 'Security Middleware Disabled',
		description:
			'Core security middleware is disabled, so rate limiting and access-control checks are not active.',
		handlingSteps: [
			'Set ENABLE_SECURITY_MIDDLEWARE=true in your configuration.',
			'Restart the service and verify startup warnings no longer include this item.',
		],
	},
	'api-key-missing': {
		id: 'api-key-missing',
		title: 'API Key Not Configured',
		description:
			'Requests are not protected by a shared-secret API key, which weakens endpoint access control.',
		handlingSteps: [
			'Set a strong API_KEY and keep it out of source control.',
			'Optionally set API_KEY_HEADER if you need a custom header name.',
			'Restart the service and update clients to send the configured header.',
		],
	},
	'allowed-ips-empty': {
		id: 'allowed-ips-empty',
		title: 'Allowed IP List Is Empty',
		description:
			'No source-IP restriction is applied, so requests can come from any address.',
		handlingSteps: [
			'Set ALLOWED_IPS to a comma-separated list of trusted monitoring source IPs.',
			'Use exact IP values and avoid leaving the variable blank.',
		],
	},
	'allowed-ips-loopback-only': {
		id: 'allowed-ips-loopback-only',
		title: 'Allowed IPs Limited To Loopback',
		description:
			'Only localhost is allowed. Remote monitoring systems will be blocked until trusted source IPs are added.',
		handlingSteps: [
			'Append trusted monitoring source IPs to ALLOWED_IPS.',
			'Keep loopback entries if local checks are still required.',
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
	'whitelist-created': {
		id: 'whitelist-created',
		title: 'Whitelist File Created Automatically',
		description:
			'The whitelist file was missing and has been created with secure permissions, but it contains no approved plugin hashes yet.',
		handlingSteps: [
			'Review each plugin file currently in PLUGINS_DIR.',
			'Add approved entries in the form "<filename> <sha256>".',
			'Restart the service after approving the intended plugins.',
		],
	},
	'whitelist-create-failed': {
		id: 'whitelist-create-failed',
		title: 'Whitelist File Creation Failed',
		description:
			'The service could not create the plugin whitelist file, so plugin trust checks cannot be initialized reliably.',
		handlingSteps: [
			'Ensure the parent directory exists and is writable by the service user.',
			'Create the whitelist file manually with mode 0600 if needed.',
		],
	},
	'whitelist-invalid-line': {
		id: 'whitelist-invalid-line',
		title: 'Whitelist Contains Invalid Line',
		description:
			'At least one whitelist line does not match the expected "filename hash" or "hash filename" format.',
		handlingSteps: [
			'Fix malformed lines in the whitelist file.',
			'Use a 64-character lowercase/uppercase SHA-256 hex value.',
		],
	},
	'whitelist-duplicate-entry': {
		id: 'whitelist-duplicate-entry',
		title: 'Duplicate Whitelist Entry',
		description:
			'The same plugin appears multiple times in the whitelist file; only the last entry is used.',
		handlingSteps: [
			'Remove duplicate lines so each plugin appears exactly once.',
			'Keep only the latest reviewed hash for each plugin.',
		],
	},
	'whitelist-insecure-ownership': {
		id: 'whitelist-insecure-ownership',
		title: 'Whitelist File Ownership Is Insecure',
		description:
			'The whitelist file owner uid does not match the service user uid, so the file cannot be trusted.',
		handlingSteps: [
			'Change ownership of the whitelist file to the service account user.',
			'On Linux, use chown with the service uid/user and verify with ls -l.',
		],
	},
	'whitelist-insecure-permissions': {
		id: 'whitelist-insecure-permissions',
		title: 'Whitelist File Permissions Are Insecure',
		description:
			'The whitelist file is writable by group or others, so third parties could weaken plugin trust checks.',
		handlingSteps: [
			'Set restrictive mode (0600) on the whitelist file.',
			'Confirm permissions no longer include group/other write bits.',
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
	'plugin-not-whitelisted': {
		id: 'plugin-not-whitelisted',
		title: 'Plugin Not Whitelisted',
		description:
			'The plugin is new or not listed in the whitelist file, so startup blocked route registration.',
		handlingSteps: [
			'Review the plugin source code and intended behavior.',
			'Add the provided sha256 to the whitelist file for this plugin.',
			'Restart the service to load the now-approved plugin.',
		],
	},
	'plugin-hash-changed': {
		id: 'plugin-hash-changed',
		title: 'Plugin Hash Changed',
		description:
			'The current plugin file hash does not match the approved hash in the whitelist file.',
		handlingSteps: [
			'Review the plugin diff and confirm the change is expected.',
			'Update the whitelist entry with the new approved sha256 hash.',
			'Restart the service to load the updated plugin.',
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
	{
		id: 'middleware-disabled',
		matcher: /ENABLE_SECURITY_MIDDLEWARE is disabled/i,
	},
	{id: 'api-key-missing', matcher: /API_KEY is not configured/i},
	{id: 'allowed-ips-empty', matcher: /ALLOWED_IPS is empty/i},
	{
		id: 'allowed-ips-loopback-only',
		matcher: /ALLOWED_IPS is limited to loopback addresses/i,
	},
	{
		id: 'rate-limit-disabled',
		matcher: /rate limiting is effectively disabled/i,
	},
	{
		id: 'whitelist-created',
		matcher: /whitelist file .* was missing and has been created/i,
	},
	{id: 'whitelist-create-failed', matcher: /could not create whitelist file/i},
	{
		id: 'whitelist-invalid-line',
		matcher: /invalid line \d+ in .*plugin-whitelist\.txt/i,
	},
	{id: 'whitelist-duplicate-entry', matcher: /duplicate whitelist entry/i},
	{
		id: 'whitelist-insecure-ownership',
		matcher: /whitelist file .* insecure ownership/i,
	},
	{
		id: 'whitelist-insecure-permissions',
		matcher: /whitelist file .* insecure permissions/i,
	},
	{
		id: 'plugin-hash-failed',
		matcher: /could not hash .*skipping plugin registration/i,
	},
	{id: 'plugin-not-whitelisted', matcher: /is new or not whitelisted/i},
	{id: 'plugin-hash-changed', matcher: /hash changed\. whitelist expects/i},
];

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

type RenderedStartupWarning = {
	message: string;
	whitelistEntry?: string;
};

const extractWhitelistEntry = (warning: string): RenderedStartupWarning => {
	const addMatch = warning.match(/add "([^"]+)" to /i);
	if (addMatch) {
		return {
			message: warning.replace(
				/add "[^"]+" to /i,
				'add the following line to ',
			),
			whitelistEntry: addMatch[1],
		};
	}

	const updateMatch = warning.match(/update "([^"]+)" in /i);
	if (updateMatch) {
		return {
			message: warning.replace(
				/update "[^"]+" in /i,
				'update the following line in ',
			),
			whitelistEntry: updateMatch[1],
		};
	}

	return {message: warning};
};

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
			const renderedWarning = extractWhitelistEntry(warning);
			const whitelistEntryHtml = renderedWarning.whitelistEntry
				? `<pre class="startup-warning-whitelist-entry"><code>${escapeHtml(renderedWarning.whitelistEntry)}</code></pre>`
				: '';

			return `<li><p>${escapeHtml(renderedWarning.message)}</p>${whitelistEntryHtml}<p><a href="${helpPath}">How to resolve this warning</a></p></li>`;
		})
		.join('');
};

export const renderStartupWarningHelpHtml = (
	topic: StartupWarningHelpTopic,
): string => {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Startup Warning Help: ${escapeHtml(topic.title)}</title>
<style>
body{font-family:sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem;line-height:1.6}
code{background:#f4f4f4;padding:.2rem .4rem;border-radius:4px}
li{margin:.4rem 0}
.crumbs{margin-bottom:1rem}
</style>
</head>
<body>
<p class="crumbs"><a href="/">Back to route overview</a></p>
<h1>${escapeHtml(topic.title)}</h1>
<p>${escapeHtml(topic.description)}</p>
<h2>How To Handle</h2>
<ol>${topic.handlingSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
</body>
</html>`;
};
