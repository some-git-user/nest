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
		it('contains no inline </script> sequence', () => {
			expect(ADMIN_CONFIG_SCRIPT).not.toContain('</script>');
		});
	});
});
