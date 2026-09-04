import {ADMIN_CONFIG_SCRIPT, ADMIN_CONFIG_SCRIPT_PATH} from './admin-scripts';

describe('admin-scripts', () => {
	describe('ADMIN_CONFIG_SCRIPT_PATH', () => {
		it('is served under the admin mount path', () => {
			expect(ADMIN_CONFIG_SCRIPT_PATH).toBe('/admin/local-config.js');
		});
	});

	describe('ADMIN_CONFIG_SCRIPT', () => {
		it('is a non-empty script string', () => {
			expect(typeof ADMIN_CONFIG_SCRIPT).toBe('string');
			expect(ADMIN_CONFIG_SCRIPT.length).toBeGreaterThan(0);
		});

		it('reads the embedded state element', () => {
			expect(ADMIN_CONFIG_SCRIPT).toContain("getElementById('admin-state')");
		});

		it('calls the admin API endpoints', () => {
			for (const endpoint of [
				'/admin/api/test',
				'/admin/api/validate',
				'/admin/api/save',
				'/admin/api/revert',
			]) {
				expect(ADMIN_CONFIG_SCRIPT).toContain(endpoint);
			}
		});

		it('tags API requests with the admin header', () => {
			expect(ADMIN_CONFIG_SCRIPT).toContain("'x-nest-admin': '1'");
		});

		it('scrolls a newly added preset into view', () => {
			// The new row is appended at the bottom of the list and is often
			// off-screen, so the add handler scrolls it into view after rendering.
			expect(ADMIN_CONFIG_SCRIPT).toContain('scrollIntoView');
			expect(ADMIN_CONFIG_SCRIPT).toContain('entriesHost.lastElementChild');
		});

		it('drops untouched defaults when the plugin command changes', () => {
			// Switching a preset's command must not carry the previous plugin's
			// prefilled default values over as bogus undeclared params. The
			// command-change handler flags the collection, and a declared field
			// still sitting at its default is skipped.
			expect(ADMIN_CONFIG_SCRIPT).toContain('collectEntry(entryElement, true)');
			expect(ADMIN_CONFIG_SCRIPT).toContain('if (commandChanged) {');
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				"input.value === (declared.defaultValue || '')",
			);
		});

		it('tolerates a command without declared fields', () => {
			// A freshly added preset has no known command; looking the command up
			// must not throw, or the whole form fails to render.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'fieldsByCommand[entry.command] || []',
			);
		});

		it('prefills a new preset with a loaded command', () => {
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				"command: commands.length > 0 ? commands[0].command : ''",
			);
		});
		it('marks the command of an entry as selected', () => {
			// Rebuilding the option list without "selected" would silently switch
			// every entry to the first plugin on the next render.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'var isSelected = value === entry.command',
			);
		});

		it('escapes every value interpolated into the form', () => {
			// Preset keys, parameter names/values and plugin metadata all end up in
			// HTML on a page that carries the admin session.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'var escapeHtml = function (value)',
			);
			for (const call of [
				'escapeHtml(field.label)',
				'escapeHtml(field.name)',
				'escapeHtml(value)',
				'escapeHtml(placeholder)',
				'escapeHtml(name)',
				'escapeHtml(entry.params[name])',
				'escapeHtml(entry.key)',
				'escapeHtml(label)',
				'escapeHtml(drift.currentHash',
				'escapeHtml(drift.approvedHash)',
			]) {
				expect(ADMIN_CONFIG_SCRIPT).toContain(call);
			}
		});

		it('shows a copyable check_nest.sh command for a stored preset', () => {
			// A preset that exists on disk has a key the service resolves, so the
			// editor surfaces the exact wrapper invocation for it.
			expect(ADMIN_CONFIG_SCRIPT).toContain('./check_nest.sh --local-config ');
			expect(ADMIN_CONFIG_SCRIPT).toContain('shellQuote(entry.key)');
			expect(ADMIN_CONFIG_SCRIPT).toContain('entry-command-line');
		});

		it('shell-quotes the key so it stays one argument', () => {
			// A key with a space or metacharacter must not split or execute when the
			// line is pasted into a shell: wrap in single quotes, escaping any quote.
			expect(ADMIN_CONFIG_SCRIPT).toContain("text.replace(/'/g, \"'\\\\''\")");
		});

		it('omits the command line for a freshly added draft', () => {
			// A new preset has no saved key yet, so there is nothing to run.
			expect(ADMIN_CONFIG_SCRIPT).toContain('entry.stored');
			expect(ADMIN_CONFIG_SCRIPT).toContain('stored: false');
		});

		it('contains no inline </script> sequence', () => {
			expect(ADMIN_CONFIG_SCRIPT).not.toContain('</script>');
		});
	});
});
