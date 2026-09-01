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

		it('contains no inline </script> sequence', () => {
			expect(ADMIN_CONFIG_SCRIPT).not.toContain('</script>');
		});
	});
});
