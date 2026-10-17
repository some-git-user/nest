import {
	getStartupWarningHelpPath,
	getStartupWarningHelpTopic,
	renderStartupWarningHelpHtml,
	renderStartupWarningListItems,
	resolveStartupWarningTopicId,
} from './startup-warning-help';

describe('startup warning help', () => {
	test('classifies known warning messages into help topic ids', () => {
		expect(
			resolveStartupWarningTopicId(
				'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
			),
		).toBe('api-key-missing');

		expect(
			resolveStartupWarningTopicId(
				'Security recommendation: ADMIN_UI_PASSWORD is not configured; the admin UI is mounted but no credential can grant access to it.',
			),
		).toBe('admin-ui-password-missing');

		expect(
			resolveStartupWarningTopicId(
				'Skipping plugin /opt/nest-plugins/check_test.ts: no manifest /opt/nest-plugins/check_test.manifest.json. Every plugin must ship a sidecar manifest to be trusted.',
			),
		).toBe('plugin-no-manifest');

		expect(
			resolveStartupWarningTopicId(
				'Plugin trust warning: check_test has no "hash" in its manifest. Loading without integrity verification - run "nest plugins hash" to record the current hash.',
			),
		).toBe('plugin-unhashed');

		expect(
			resolveStartupWarningTopicId(
				'Skipping plugin /opt/nest-plugins/check_nvidia_smi.ts due to insecure permissions: plugin files must not be writable by group or others.',
			),
		).toBe('plugin-insecure-permissions');

		expect(
			resolveStartupWarningTopicId(
				'Plugin trust warning: /opt/nest-plugins/check_test.ts hash changed. Manifest expects oldHash, current sha256 is newHash. Run "nest plugins hash" to update it.',
			),
		).toBe('plugin-hash-changed');

		expect(
			resolveStartupWarningTopicId(
				'Plugin trust warning: could not hash /opt/nest-plugins/check_test.ts. Error: EACCES.',
			),
		).toBe('plugin-hash-failed');

		expect(
			resolveStartupWarningTopicId(
				'Config file configs/local-presets.conf has insecure permissions (0660); it must not be writable by group or others.',
			),
		).toBe('config-insecure-permissions');

		expect(
			resolveStartupWarningTopicId(
				'TLS certificate replaced automatically: Certificate SAN does not include DNS:localhost. New self-signed certificate: /certs/nest-cert.pem. What to do now: nothing has to be configured.',
			),
		).toBe('cert-replaced');

		expect(
			resolveStartupWarningTopicId(
				'TLS certificate or key was missing. New self-signed certificate: /certs/nest-cert.pem. What to do now: nothing has to be configured.',
			),
		).toBe('cert-generated');

		expect(
			resolveStartupWarningTopicId(
				'Config drift: the local config presets file on disk is awaiting approval. Run "nest plugins hash" or set "LOCAL_CONFIG_HASH=abc" in the nest config file and restart the service to activate the file on disk.',
			),
		).toBe('config-drift-awaiting-approval');
	});

	test('falls back to unknown topic for unmatched warning text', () => {
		expect(resolveStartupWarningTopicId('unrecognized warning payload')).toBe(
			'unknown',
		);
	});

	test('renders warning list entries with dedicated help links', () => {
		const html = renderStartupWarningListItems([
			'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
			'Skipping plugin /opt/nest-plugins/check_test.ts: no manifest /opt/nest-plugins/check_test.manifest.json. Every plugin must ship a sidecar manifest to be trusted.',
			'Skipping plugin /opt/nest-plugins/check_nvidia_smi.ts due to insecure permissions: plugin files must not be writable by group or others.',
			'Config file configs/local-presets.conf has insecure permissions (0660); it must not be writable by group or others.',
		]);

		expect(html).toContain('/help/startup-warnings/api-key-missing');
		expect(html).toContain('/help/startup-warnings/plugin-no-manifest');
		expect(html).toContain(
			'/help/startup-warnings/plugin-insecure-permissions',
		);
		expect(html).toContain(
			'/help/startup-warnings/config-insecure-permissions',
		);
		expect(html).toContain('How to resolve this warning');
	});

	test('renders manifest hash guidance in the help topic', () => {
		const topic = getStartupWarningHelpTopic('plugin-hash-changed');
		expect(topic).toBeDefined();
		const html = renderStartupWarningHelpHtml(topic!);
		expect(html).toContain('nest plugins hash');
	});

	test('renders certificate warning entries with a link to the new topics', () => {
		const html = renderStartupWarningListItems([
			'TLS certificate replaced automatically: Certificate expires in 12 days (threshold: 30 days). New self-signed certificate: /certs/nest-cert.pem. What to do now: nothing has to be configured.',
			'TLS certificate or key was missing. New self-signed certificate: /certs/nest-cert.pem. What to do now: nothing has to be configured.',
		]);

		expect(html).toContain('/help/startup-warnings/cert-replaced');
		expect(html).toContain('/help/startup-warnings/cert-generated');

		const replacedTopic = getStartupWarningHelpTopic('cert-replaced');
		expect(replacedTopic).toBeDefined();
		expect(renderStartupWarningHelpHtml(replacedTopic!)).toContain(
			'openssl x509 -in &lt;cert path&gt; -noout -fingerprint -sha256',
		);

		const generatedTopic = getStartupWarningHelpTopic('cert-generated');
		expect(generatedTopic).toBeDefined();
		expect(renderStartupWarningHelpHtml(generatedTopic!)).toContain(
			'TLS Certificate Generated Automatically',
		);
	});

	test('provides known topics and renders topic help HTML', () => {
		const topic = getStartupWarningHelpTopic('plugin-hash-changed');
		expect(topic).toBeDefined();
		expect(getStartupWarningHelpPath('plugin-hash-changed')).toBe(
			'/help/startup-warnings/plugin-hash-changed',
		);

		const html = renderStartupWarningHelpHtml(topic!);
		expect(html).toContain('Plugin Hash Changed');
		expect(html).toContain('How To Handle');
		expect(html).toContain('Back to route overview');
	});

	test('returns undefined for unknown help topic id', () => {
		expect(getStartupWarningHelpTopic('no-such-topic')).toBeUndefined();
	});

	test('renders the admin UI password help topic', () => {
		const topic = getStartupWarningHelpTopic('admin-ui-password-missing');
		expect(topic).toBeDefined();
		expect(getStartupWarningHelpPath('admin-ui-password-missing')).toBe(
			'/help/startup-warnings/admin-ui-password-missing',
		);

		const html = renderStartupWarningHelpHtml(topic!);
		expect(html).toContain('Admin UI Password Not Configured');
		expect(html).toContain('How To Handle');
	});

	test('renders the config drift help topic', () => {
		const topic = getStartupWarningHelpTopic('config-drift-awaiting-approval');
		expect(topic).toBeDefined();
		expect(getStartupWarningHelpPath('config-drift-awaiting-approval')).toBe(
			'/help/startup-warnings/config-drift-awaiting-approval',
		);

		const html = renderStartupWarningHelpHtml(topic!);
		expect(html).toContain('Config File Changed Since Approval');
		expect(html).toContain('How To Handle');
	});
});
