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
				'Plugin trust warning: plugins/check_test.ts is new or not whitelisted. Current sha256: abc.',
			),
		).toBe('plugin-not-whitelisted');

		expect(
			resolveStartupWarningTopicId(
				'Plugin trust warning: whitelist file plugins/plugin-whitelist.txt has insecure permissions; it must not be writable by group or others. Refusing to trust whitelist entries.',
			),
		).toBe('whitelist-insecure-permissions');
	});

	test('falls back to unknown topic for unmatched warning text', () => {
		expect(resolveStartupWarningTopicId('unrecognized warning payload')).toBe(
			'unknown',
		);
	});

	test('renders warning list entries with dedicated help links', () => {
		const html = renderStartupWarningListItems([
			'Security recommendation: API_KEY is not configured; requests are not protected by shared-secret authentication.',
			'Plugin trust warning: plugins/check_test.ts is new or not whitelisted. Current sha256: abc.',
		]);

		expect(html).toContain('/help/startup-warnings/api-key-missing');
		expect(html).toContain('/help/startup-warnings/plugin-not-whitelisted');
		expect(html).toContain('How to resolve this warning');
	});

	test('renders whitelist line additions as a dedicated single-line code block', () => {
		const html = renderStartupWarningListItems([
			'Plugin trust warning: plugins/check_test.ts is new or not whitelisted. Current sha256: abc123. Review it and add "check_test.ts abc123" to plugins/plugin-whitelist.txt before enabling it.',
		]);

		expect(html).toContain(
			'add the following line to plugins/plugin-whitelist.txt',
		);
		expect(html).toContain(
			'<pre class="startup-warning-whitelist-entry"><code>check_test.ts abc123</code></pre>',
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
});
