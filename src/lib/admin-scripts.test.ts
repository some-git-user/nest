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
				"input.value === (declared.default || '')",
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

		it('warns about duplicate keys before validate or save', () => {
			// The server rejects duplicate keys on validate and save; the editor
			// mirrors that rule live so the operator sees it while typing.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'var updateDuplicateKeyWarnings = function ()',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'counts[key] = (counts[key] || 0) + 1',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain('counts[key] > 1');
			expect(ADMIN_CONFIG_SCRIPT).toContain('data-role="keyWarning"');
			// Rendered per entry, refreshed after render and on every key edit.
			expect(ADMIN_CONFIG_SCRIPT).toContain('updateDuplicateKeyWarnings();');
			expect(ADMIN_CONFIG_SCRIPT).toContain("role !== 'key'");
		});

		it('validates required parameters declared by the plugin', () => {
			// A plugin marks a parameter required in meta.params; the editor must
			// not let the operator validate or save without it. A required field
			// that declares a default is exempt (the route falls back to it), and
			// whitespace counts as empty, matching the server rule.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'var requiredFieldsForCommand = function',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain('field.required && !field.default');
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'var missingRequiredFields = function',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'String(value).trim().length === 0',
			);
			// A masked secret is exempt: it always arrives empty and the stored
			// value is restored on save, so empty means "keep stored", not missing.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'if (isSecret(entry, field.name)) {\n\t\t\t\treturn false;',
			);
			// Live inline warning, refreshed after render and on parameter edits.
			expect(ADMIN_CONFIG_SCRIPT).toContain('data-role="requiredWarning"');
			expect(ADMIN_CONFIG_SCRIPT).toContain('updateRequiredWarnings();');
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				"event.target.hasAttribute('data-param')",
			);
			// Preflight blocks the request and points at the first offending card.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'var reportMissingRequired = function',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'if (reportMissingRequired(draftEntries))',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'is missing required parameter(s):',
			);
		});

		it('duplicates a preset with a counter-suffixed unique key', () => {
			// Copying an existing preset must produce a usable draft, not a
			// duplicate the server would reject: the key gets a counter appended
			// and bumped until it is unique among the current presets.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'<button type="button" data-action="copy">Copy</button>',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain('var uniqueCopyKey = function');
			expect(ADMIN_CONFIG_SCRIPT).toContain("baseKey + '-' + counter");
			expect(ADMIN_CONFIG_SCRIPT).toContain('while (used[candidate])');
			expect(ADMIN_CONFIG_SCRIPT).toContain('draft.splice(index + 1, 0, {');
			expect(ADMIN_CONFIG_SCRIPT).toContain('key: uniqueCopyKey(source.key)');
		});

		it('disables every Test button while a run is in flight', () => {
			// A Test request spawns a real plugin process on the server, so a
			// second click must not overlap it. The in-flight count lives outside
			// the DOM (a re-render rebuilds the buttons) and render() re-applies it;
			// the lock is released on settle, whatever the outcome.
			expect(ADMIN_CONFIG_SCRIPT).toContain('var runningTestCount = 0');
			expect(ADMIN_CONFIG_SCRIPT).toContain('var updateTestButtons = function');
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'button.disabled = runningTestCount > 0',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				"runningTestCount > 0 ? ' disabled' : ''",
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain('runningTestCount += 1');
			expect(ADMIN_CONFIG_SCRIPT).toContain('runningTestCount -= 1');
			// Released via a trailing .then so both success and failure unlock.
			expect(ADMIN_CONFIG_SCRIPT).toContain('.then(releaseTestLock)');
		});

		it('renders an Include-in-unified checkbox per preset', () => {
			// The reserved nestUnified flag is a directive for the aggregator, not a
			// plugin param: it gets a dedicated checkbox, is excluded from the
			// undeclared-param list, and is collected from the checkbox state rather
			// than a text value.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				"var NEST_UNIFIED_PARAM = 'nestUnified'",
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain('data-role="unified"');
			expect(ADMIN_CONFIG_SCRIPT).toContain('Include in unified check');
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'fieldNames[name] || name === NEST_UNIFIED_PARAM',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'element.querySelectorAll(\'[data-role="unified"]\')',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				"params[NEST_UNIFIED_PARAM] = 'true'",
			);
		});

		it('shows how many presets are in the unified check', () => {
			// The count reflects the draft (what a save would write), refreshed on
			// render and on every checkbox edit.
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'var updateUnifiedCount = function',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain("getElementById('unifiedCount')");
			expect(ADMIN_CONFIG_SCRIPT).toContain('updateUnifiedCount();');
			expect(ADMIN_CONFIG_SCRIPT).toContain("role !== 'unified'");
		});

		it('contains no inline </script> sequence', () => {
			expect(ADMIN_CONFIG_SCRIPT).not.toContain('</script>');
		});

		it('counts the session down in the header', () => {
			// The cookie is HttpOnly, so the expiry the server embedded in the
			// state is the only countdown source. It ticks, turns amber near the
			// end, and stops when expired.
			expect(ADMIN_CONFIG_SCRIPT).toContain("getElementById('sessionTimer')");
			expect(ADMIN_CONFIG_SCRIPT).toContain('state.sessionExpiresAt');
			expect(ADMIN_CONFIG_SCRIPT).toContain("'session-timer expired'");
			expect(ADMIN_CONFIG_SCRIPT).toContain('SESSION_WARN_SECONDS');
			expect(ADMIN_CONFIG_SCRIPT).toContain('window.setInterval');
			expect(ADMIN_CONFIG_SCRIPT).toContain('window.clearInterval');
		});

		it('refreshes the session and reports errors inline', () => {
			// A refresh extends the cookie; the countdown resetting is the only
			// success feedback, and a failure prints beside the timer rather than
			// in the page-wide status line.
			expect(ADMIN_CONFIG_SCRIPT).toContain('/admin/api/refresh-session');
			expect(ADMIN_CONFIG_SCRIPT).toContain("getElementById('sessionError')");
			expect(ADMIN_CONFIG_SCRIPT).toContain(
				'sessionErrorElement.hidden = false',
			);
			expect(ADMIN_CONFIG_SCRIPT).toContain('startSessionTimer()');
		});
	});
});
