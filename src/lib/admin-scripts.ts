/**
 * Client script for the admin config editor.
 *
 * Served as a static string at a fixed path rather than inlined, because the
 * page's CSP is `script-src 'self'` and inline scripts would be blocked.
 */
export const ADMIN_CONFIG_SCRIPT_PATH = '/admin/local-config.js';

export const ADMIN_CONFIG_SCRIPT = `// Admin config editor
/* global document, window, fetch, HTMLElement, HTMLInputElement, HTMLSelectElement, HTMLButtonElement */

(function () {
	var stateElement = document.getElementById('admin-state');
	if (!(stateElement instanceof HTMLElement)) {
		return;
	}

	var state;
	try {
		state = JSON.parse(stateElement.textContent || '{}');
	} catch (err) {
		return;
	}

	// Reserved parameter that opts a preset into the unified check. It is a
	// directive for the aggregator, not a plugin input, so it is rendered as a
	// dedicated checkbox rather than a parameter field, and stripped server-side
	// before dial-back. Must match NEST_UNIFIED_PARAM in lib/unified-check.ts.
	var NEST_UNIFIED_PARAM = 'nestUnified';

	var commands = Array.isArray(state.commands) ? state.commands : [];
	var entries = Array.isArray(state.entries) ? state.entries : [];
	var drift = state.drift || {};
	var contentHash = typeof state.contentHash === 'string' ? state.contentHash : '';
	// Unix-seconds expiry of the admin session cookie, when the caller logged in
	// with one. A header-authenticated caller has no cookie and so no expiry, and
	// gets no countdown. Kept in seconds to match the state; compared against
	// Date.now()/1000 in the tick.
	var sessionExpiresAt =
		typeof state.sessionExpiresAt === 'number' ? state.sessionExpiresAt : 0;
	var fieldsByCommand = {};
	commands.forEach(function (command) {
		fieldsByCommand[command.command] = Array.isArray(command.fields) ? command.fields : [];
	});

	// Everything interpolated into the form below comes from the stored config
	// file or from plugin metadata, neither of which is trusted here: a preset key
	// or parameter value could otherwise close an attribute and inject markup into
	// a page that holds the admin session.
	var escapeHtml = function (value) {
		if (value === undefined || value === null) {
			return '';
		}
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	};

	// POSIX single-quote quoting for a value shown inside a copyable shell
	// command. Wrapping in single quotes makes every character literal; the only
	// trick is an embedded single quote, which is closed, escaped, and reopened.
	// The result is HTML-escaped too, since it is rendered inside <code>.
	var shellQuote = function (value) {
		var text = value === undefined || value === null ? '' : String(value);
		return escapeHtml("'" + text.replace(/'/g, "'\\\\''") + "'");
	};

	// Working copy of the document. Every edit mutates this array; the server is
	// only contacted on validate / test / save, so editing stays responsive and
	// nothing is written by accident.
	//
	// The "stored" flag marks the entries that came from the config file on disk.
	// Only those have a key the running service will resolve, so only they get the
	// "run this preset" command line; a freshly added draft has no saved key yet.
	var draft = entries.map(function (entry) {
		return {
			key: entry.key,
			command: entry.command,
			params: entry.params || {},
			secretParams: Array.isArray(entry.secretParams) ? entry.secretParams : [],
			stored: true,
		};
	});

	var entriesHost = document.getElementById('entries');
	var statusHost = document.getElementById('status');
	var driftHost = document.getElementById('driftBanner');
	var saveButton = document.getElementById('saveButton');
	var validateButton = document.getElementById('validateButton');
	var revertButton = document.getElementById('revertButton');
	var addButton = document.getElementById('addEntryButton');
	var logoutButton = document.getElementById('logoutButton');

	var setStatus = function (kind, message) {
		if (!(statusHost instanceof HTMLElement)) {
			return;
		}
		statusHost.className = 'status show ' + kind;
		statusHost.textContent = message;
	};

	var clearStatus = function () {
		if (!(statusHost instanceof HTMLElement)) {
			return;
		}
		statusHost.className = 'status';
		statusHost.textContent = '';
	};

	var renderDrift = function () {
		if (!(driftHost instanceof HTMLElement)) {
			return;
		}
		if (!drift.drifted) {
			driftHost.innerHTML =
				'<section class="banner ok"><h2>File matches the whitelist</h2>' +
				'<p>The config file on disk is the one the service approved at startup.</p></section>';
			return;
		}

		var whitelistLine =
			'configs/local-presets.conf ' + escapeHtml(drift.currentHash || 'unknown');
		var approved = drift.approvedHash
			? 'Whitelist approves <code>' + escapeHtml(drift.approvedHash) + '</code>.'
			: 'The file is not in the whitelist at all.';

		driftHost.innerHTML =
			'<section class="banner"><h2>Changes are waiting for manual approval</h2>' +
			'<p>The file on disk is not the file the whitelist approves, so a restart ' +
			'would disable <strong>every</strong> local preset until the hash is updated. ' +
			'The presets that were approved at startup are still the ones being served.</p>' +
			'<p>' + approved + '</p>' +
			'<pre>' + whitelistLine + '</pre>' +
			'<p>Add that line to <code>plugins/plugin-whitelist.txt</code>, then restart ' +
			'the service. Use <em>Revert to approved</em> to discard the changes instead.</p></section>';
	};

	// Values the server masked away. A secret never leaves the server, so the
	// browser only ever sees an empty string plus the name, and an empty string on
	// save means "keep what is stored".
	var isSecret = function (entry, name) {
		return entry.secretParams.indexOf(name) !== -1;
	};

	var paramRows = function (entry, index) {
		var rows = '';
		var fieldNames = {};
		// A command that is not loaded (or not chosen yet) has no declared fields.
		// Falling back to an empty list keeps the render alive, so the undeclared
		// parameters below are still shown instead of the whole form disappearing.
		var fields = fieldsByCommand[entry.command] || [];
		fields.forEach(function (field) {
			fieldNames[field.name] = field;
			var secret = isSecret(entry, field.name) || field.type === 'password';
			var stored = isSecret(entry, field.name);
			var value = entry.params[field.name];
			if (value === undefined) {
				value = secret ? '' : field.default || '';
			}
			var placeholder = stored ? 'stored - leave empty to keep' : '';
			rows +=
				'<label class="field"><span class="field-label">' +
				escapeHtml(field.label) +
				(field.required ? '<span class="required" title="Required field">*</span>' : '') +
				'</span><input id="p' + index + '_' + escapeHtml(field.name) +
				'" data-param="' + escapeHtml(field.name) + '" type="' +
				(secret ? 'password' : 'text') + '" value="' + escapeHtml(value) + '"' +
				(placeholder ? ' placeholder="' + escapeHtml(placeholder) + '"' : '') +
				'></label>';
		});

		// Parameters that the selected plugin does not declare are still shown, so a
		// preset written by hand is never silently dropped on save. The reserved
		// unified flag is excluded: it has its own checkbox, not a text field.
		Object.keys(entry.params).forEach(function (name) {
			if (fieldNames[name] || name === NEST_UNIFIED_PARAM) {
				return;
			}
			var secret = isSecret(entry, name);
			rows +=
				'<label class="field"><span class="field-label">' + escapeHtml(name) +
				'<span class="hint"> (undeclared)</span></span><input id="x' + index + '_' +
				escapeHtml(name) + '" data-param="' + escapeHtml(name) + '" type="' +
				(secret ? 'password' : 'text') + '" value="' + escapeHtml(entry.params[name]) + '"></label>';
		});

		return rows;
	};

	var commandOptions = function (entry) {
		// The selected option has to be marked explicitly: the option list is
		// rebuilt on every render, so without "selected" the browser would show
		// (and later collect) the first command instead of the entry's own one.
		var option = function (value, label) {
			var isSelected = value === entry.command ? ' selected' : '';
			return (
				'<option value="' +
				escapeHtml(value) +
				'"' +
				isSelected +
				'>' +
				escapeHtml(label) +
				'</option>'
			);
	};
		var known = false;
		var options = commands
			.map(function (command) {
				if (command.command === entry.command) {
					known = true;
				}
				return option(command.command, command.command);
			})
			.join('');
		if (!known) {
			options =
				option(
					entry.command,
					entry.command + ' (not loaded)',
				) + options;
		}
		return options;
	};

	var render = function () {
		if (!(entriesHost instanceof HTMLElement)) {
			return;
		}

		if (draft.length === 0) {
			entriesHost.innerHTML =
				'<p class="muted">No presets yet. Use <em>Add preset</em> to create one.</p>';
			return;
		}

		entriesHost.innerHTML = draft
			.map(function (entry, index) {
				// A stored preset has a key the running service resolves, so it can be
				// invoked straight from the Nagios server through the shared wrapper.
				// The key is shell-quoted so a key with spaces or metacharacters stays
				// one argument when the line is copied into a shell.
				var commandHtml = entry.stored
					? '<div class="entry-command"><span class="field-label">Run from Nagios</span>' +
						'<code class="entry-command-line">./check_nest.sh --local-config ' +
						shellQuote(entry.key) +
						'</code></div>'
					: '';
				return (
					'<div class="entry" data-index="' + index + '">' +
					'<div class="entry-head">' +
					'<label class="field"><span class="field-label">Key</span>' +
					'<input id="k' + index + '" data-role="key" type="text" value="' +
					escapeHtml(entry.key) +
					'"></label>' +
					'<label class="field"><span class="field-label">Plugin command</span>' +
					'<select id="c' + index + '" data-role="command">' + commandOptions(entry) + '</select></label>' +
					'</div>' +
					'<div class="key-warning" data-role="keyWarning"></div>' +
					'<div class="key-warning" data-role="requiredWarning"></div>' +
					'<div class="params">' + paramRows(entry, index) + '</div>' +
					'<label class="unified-toggle"><input type="checkbox" data-role="unified"' +
					(entry.params[NEST_UNIFIED_PARAM] === 'true' ? ' checked' : '') +
					'> Include in unified check</label>' +
					commandHtml +
					'<div class="entry-actions">' +
					'<button type="button" data-action="test"' + (runningTestCount > 0 ? ' disabled' : '') + '>Test</button>' +
					'<button type="button" data-action="copy">Copy</button>' +
					'<button type="button" data-action="remove" class="danger">Remove</button>' +
					'</div>' +
					'<div class="test-result" data-role="testResult"></div>' +
					'</div>'
				);
			})
			.join('');
		updateDuplicateKeyWarnings();
		updateRequiredWarnings();
		updateTestButtons();
		updateUnifiedCount();
	};

	// Show how many presets are currently opted into the unified check, so the
	// operator sees the aggregate's scope without counting checkboxes. Counts the
	// draft, not the DOM, so it reflects exactly what a save would write.
	var updateUnifiedCount = function () {
		var countHost = document.getElementById('unifiedCount');
		if (!(countHost instanceof HTMLElement)) {
			return;
		}
		var included = 0;
		draft.forEach(function (entry) {
			if (entry.params[NEST_UNIFIED_PARAM] === 'true') {
				included += 1;
			}
		});
		countHost.textContent =
			included === 0
				? 'Unified check: no presets'
				: 'Unified check: ' + included + ' preset(s)';
	};

	// Flag every preset whose key is used more than once, before the operator
	// ever hits Validate or Save. The server rejects duplicate keys on both
	// validate and save (and startup treats one as a fatal parse error), so this
	// only mirrors that rule live to save a round-trip. Keys are compared
	// exactly as typed, matching the server; an empty key is left to the
	// required-field rule instead.
	var updateDuplicateKeyWarnings = function () {
		if (!(entriesHost instanceof HTMLElement)) {
			return;
		}
		var keyInputs = entriesHost.querySelectorAll('[data-role="key"]');
		var counts = {};
		keyInputs.forEach(function (input) {
			if (!(input instanceof HTMLInputElement)) {
				return;
			}
			var key = input.value.trim();
			if (key.length > 0) {
				counts[key] = (counts[key] || 0) + 1;
			}
		});
		keyInputs.forEach(function (input) {
			if (!(input instanceof HTMLInputElement)) {
				return;
			}
			var entryElement = input.closest('.entry');
			if (!(entryElement instanceof HTMLElement)) {
				return;
			}
			var warningHost = entryElement.querySelector('[data-role="keyWarning"]');
			if (!(warningHost instanceof HTMLElement)) {
				return;
			}
			var key = input.value.trim();
			if (key.length > 0 && counts[key] > 1) {
				warningHost.className = 'key-warning show';
				warningHost.textContent =
					'Duplicate key: another preset uses the same key. Keys must be unique.';
			} else {
				warningHost.className = 'key-warning';
				warningHost.textContent = '';
			}
		});
	};

	// The required parameters a preset must supply, mirroring the server. A
	// required parameter that declares a default is exempt: the route falls back
	// to that default when the value is absent, so the plugin still receives one.
	// A command with no loaded fields requires nothing, matching how the editor
	// renders no fields for it.
	var requiredFieldsForCommand = function (command) {
		var required = [];
		(fieldsByCommand[command] || []).forEach(function (field) {
			if (field.required && !field.default) {
				required.push(field);
			}
		});
		return required;
	};

	// The required parameters of an entry that are still empty. A value of only
	// whitespace counts as empty, matching the server rule. A masked secret is
	// exempt: it always arrives empty with its name in secretParams, and the
	// stored value is restored on save, so an empty secret means "keep stored",
	// not "missing". This mirrors the server, which checks the merged params.
	var missingRequiredFields = function (entry) {
		return requiredFieldsForCommand(entry.command).filter(function (field) {
			if (isSecret(entry, field.name)) {
				return false;
			}
			var value = entry.params[field.name];
			return value === undefined || String(value).trim().length === 0;
		});
	};

	// Flag every preset missing a required parameter, before the operator hits
	// Validate or Save. The server rejects these too; this mirrors the rule live
	// so the reason is visible next to the field rather than in the status line.
	var updateRequiredWarnings = function () {
		if (!(entriesHost instanceof HTMLElement)) {
			return;
		}
		entriesHost.querySelectorAll('.entry').forEach(function (entryElement) {
			if (!(entryElement instanceof HTMLElement)) {
				return;
			}
			var index = Number(entryElement.getAttribute('data-index'));
			var entry = draft[index];
			var warningHost = entryElement.querySelector('[data-role="requiredWarning"]');
			if (!entry || !(warningHost instanceof HTMLElement)) {
				return;
			}
			var missing = missingRequiredFields(entry);
			if (missing.length > 0) {
				var labels = missing.map(function (field) {
					return field.label;
				});
				warningHost.className = 'key-warning show';
				warningHost.textContent =
					'Required: ' + escapeHtml(labels.join(', ')) + '.';
			} else {
				warningHost.className = 'key-warning';
				warningHost.textContent = '';
			}
		});
	};

	// Stop a Validate or Save request when a preset is missing a required
	// parameter, and point at the first offending card. The server would reject
	// it anyway; catching it here keeps the reason beside the field instead of
	// only in the page-wide status line, and avoids a doomed round-trip.
	var firstMissingRequiredEntry = function (entries) {
		var first = null;
		entries.forEach(function (entry) {
			if (first === null && missingRequiredFields(entry).length > 0) {
				first = entry;
			}
		});
		return first;
	};

	var reportMissingRequired = function (entries) {
		var first = firstMissingRequiredEntry(entries);
		if (first === null) {
			return false;
		}
		var labels = missingRequiredFields(first).map(function (field) {
			return field.label;
		});
		var name = first.key.length > 0 ? first.key : '(untitled)';
		setStatus(
			'error',
			'Preset "' + name + '" is missing required parameter(s): ' + labels.join(', ') + '.',
		);
		if (entriesHost instanceof HTMLElement) {
			var cards = entriesHost.querySelectorAll('.entry');
			for (var i = 0; i < cards.length; i++) {
				var card = cards[i];
				if (card instanceof HTMLElement && Number(card.getAttribute('data-index')) === draft.indexOf(first)) {
					card.scrollIntoView({behavior: 'smooth', block: 'nearest'});
					break;
				}
			}
		}
		return true;
	};

	// Collect the visible form back into the draft entry.
	//
	// When commandChanged is set the caller is the command dropdown handler:
	// the DOM still shows the PREVIOUS command's fields, and switching plugins
	// must not smuggle the old plugin's untouched default values into the new
	// one as bogus undeclared params. So a param is dropped when it was declared
	// by the previous command and its input still holds that field's default
	// (i.e. the operator never touched it). Anything else - a value the operator
	// edited, or a param the previous command never declared (added by hand or
	// loaded from a stored preset) - is kept.
	var collectEntry = function (element, commandChanged) {
		var index = Number(element.getAttribute('data-index'));
		var entry = draft[index];
		if (!entry) {
			return undefined;
		}

		// The command select is harvested below and overwrites entry.command,
		// so remember which plugin's fields are currently rendered.
		var previousCommand = entry.command;
		var previousFields = {};
		(fieldsByCommand[previousCommand] || []).forEach(function (field) {
			previousFields[field.name] = field;
		});

		var params = {};

		element.querySelectorAll('[data-role="key"]').forEach(function (input) {
			if (input instanceof HTMLInputElement) {
				entry.key = input.value.trim();
			}
		});
		element.querySelectorAll('[data-role="command"]').forEach(function (input) {
			if (input instanceof HTMLSelectElement) {
				entry.command = input.value;
			}
		});
		// The unified checkbox is a directive, not a plugin param: checked writes
		// the reserved flag, unchecked removes it entirely (rather than storing a
		// literal "false"), so the saved line stays clean and the server's
		// "=== 'true'" test is the single source of truth.
		element.querySelectorAll('[data-role="unified"]').forEach(function (input) {
			if (input instanceof HTMLInputElement) {
				if (input.checked) {
					params[NEST_UNIFIED_PARAM] = 'true';
				}
			}
		});
		element.querySelectorAll('[data-param]').forEach(function (input) {
			if (!(input instanceof HTMLInputElement)) {
				return;
			}
			var name = input.getAttribute('data-param') || '';
			if (commandChanged) {
				var declared = previousFields[name];
				if (
					declared !== undefined &&
					input.value === (declared.default || '')
				) {
					// A field the previous plugin declared that the operator never
					// changed: pure prefill, not worth carrying to the new plugin.
					return;
				}
			}
			params[name] = input.value;
		});

		entry.params = params;
		return entry;
	};

	var collectDraft = function () {
		var collected = [];
		if (!(entriesHost instanceof HTMLElement)) {
			return collected;
		}
		entriesHost.querySelectorAll('.entry').forEach(function (element) {
			if (!(element instanceof HTMLElement)) {
				return;
			}
			var entry = collectEntry(element);
			if (entry) {
				collected.push(entry);
			}
		});
		return collected;
	};

	var api = function (path, payload) {
		return fetch(path, {
			method: 'POST',
			headers: {'content-type': 'application/json', 'x-nest-admin': '1'},
			body: JSON.stringify(payload || {}),
		}).then(function (response) {
			return response
				.json()
				.catch(function () {
					return {message: 'Request failed with status ' + response.status};
				})
				.then(function (body) {
					if (!response.ok) {
						// Validation failures return { ok: false, problems: [...] } with no
						// 'message'; show the real reasons instead of a bare status code.
						var detail = body.message;
						if (!detail && body.problems && body.problems.length) {
							detail = body.problems.join(' ');
						}
						throw new Error(detail || 'Request failed with status ' + response.status);
					}
					return body;
				});
		});
	};

	var showProblems = function (problems) {
		if (!problems || problems.length === 0) {
			return;
		}
		setStatus('error', problems.join(' '));
	};

	// Only one plugin run at a time. A Test request spawns a real plugin process
	// on the server, so a second click while one is in flight would overlap two
	// spawns, and two different presets could be exercised concurrently. Every
	// Test button is disabled while any run is pending and re-enabled once the
	// request settles, whatever the outcome. The count lives outside the DOM so
	// a re-render cannot lose it; render() re-applies it to the rebuilt buttons.
	var runningTestCount = 0;
	var updateTestButtons = function () {
		if (!(entriesHost instanceof HTMLElement)) {
			return;
		}
		entriesHost.querySelectorAll('[data-action="test"]').forEach(function (button) {
			if (button instanceof HTMLButtonElement) {
				button.disabled = runningTestCount > 0;
			}
		});
	};

	var onTest = function (element) {
		var entry = collectEntry(element);
		if (!entry) {
			return;
		}
		var resultHost = element.querySelector('[data-role="testResult"]');
		runningTestCount += 1;
		updateTestButtons();
		var releaseTestLock = function () {
			runningTestCount -= 1;
			updateTestButtons();
		};
		api('/admin/api/test', {entry: entry})
			.then(function (body) {
				if (!(resultHost instanceof HTMLElement)) {
					return;
				}
				resultHost.className = 'test-result show';
				resultHost.textContent =
					'HTTP ' + body.statusCode + ' - ' + (typeof body.body === 'string' ? body.body : '');
			})
			.catch(function (error) {
				if (!(resultHost instanceof HTMLElement)) {
					return;
				}
				resultHost.className = 'test-result show';
				resultHost.textContent = String(error.message || error);
			})
			.then(releaseTestLock);
	};

	// Build a key for a copied preset: the source key with a counter appended,
	// bumped until it no longer collides with an existing preset. Keys must be
	// unique (the server rejects duplicates), so a plain duplicate would be
	// rejected on the next validate/save; the counter makes the copy usable as-is.
	var uniqueCopyKey = function (baseKey) {
		var used = {};
		draft.forEach(function (existing) {
			if (existing.key.length > 0) {
				used[existing.key] = true;
			}
		});
		var counter = 1;
		var candidate = baseKey + '-' + counter;
		while (used[candidate]) {
			counter += 1;
			candidate = baseKey + '-' + counter;
		}
		return candidate;
	};

	// Duplicate a preset: harvest its current form, clone it with a fresh
	// counter-suffixed key, and insert the clone right below the original so the
	// operator can tweak it in place. The clone is a draft (stored:false) since it
	// is not on disk yet, so it does not claim a runnable Nagios command line.
	var onCopy = function (element) {
		collectEntry(element);
		var index = Number(element.getAttribute('data-index'));
		var source = draft[index];
		if (!source) {
			return;
		}
		var params = {};
		Object.keys(source.params).forEach(function (name) {
			params[name] = source.params[name];
		});
		draft.splice(index + 1, 0, {
			key: uniqueCopyKey(source.key),
			command: source.command,
			params: params,
			secretParams: source.secretParams.slice(),
			stored: false,
		});
		render();
		if (entriesHost instanceof HTMLElement) {
			var copied = entriesHost.children[index + 1];
			if (copied instanceof HTMLElement) {
				copied.scrollIntoView({behavior: 'smooth', block: 'nearest'});
			}
		}
	};

	if (entriesHost instanceof HTMLElement) {
		entriesHost.addEventListener('click', function (event) {
			if (!(event.target instanceof HTMLElement)) {
				return;
			}
			var action = event.target.getAttribute('data-action');
			if (!action) {
				return;
			}
			var entryElement = event.target.closest('.entry');
			if (!(entryElement instanceof HTMLElement)) {
				return;
			}
			if (action === 'remove') {
				var index = Number(entryElement.getAttribute('data-index'));
				draft.splice(index, 1);
				render();
				return;
			}
			if (action === 'copy') {
				onCopy(entryElement);
				return;
			}
			if (action === 'test') {
				onTest(entryElement);
			}
		});

		// Changing the command has to re-render, because the parameter form is
		// derived from the selected plugin's field metadata.
		entriesHost.addEventListener('change', function (event) {
			if (!(event.target instanceof HTMLElement)) {
				return;
			}
			if (event.target.getAttribute('data-role') !== 'command') {
				return;
			}
			var entryElement = event.target.closest('.entry');
			if (entryElement instanceof HTMLElement) {
				collectEntry(entryElement, true);
				render();
			}
		});

		// A key or parameter edit does not change the form structure, so update the
		// warnings in place instead of re-rendering, which would steal focus.
		entriesHost.addEventListener('input', function (event) {
			if (!(event.target instanceof HTMLElement)) {
				return;
			}
			var role = event.target.getAttribute('data-role');
			if (
				role !== 'key' &&
				role !== 'unified' &&
				!event.target.hasAttribute('data-param')
			) {
				return;
			}
			var entryElement = event.target.closest('.entry');
			if (entryElement instanceof HTMLElement) {
				collectEntry(entryElement);
			}
			updateDuplicateKeyWarnings();
			updateRequiredWarnings();
			updateUnifiedCount();
		});
	}

	if (addButton instanceof HTMLElement) {
		addButton.addEventListener('click', function () {
			collectDraft();
			// Start from the first loaded plugin so the new row immediately shows the
			// parameter fields that belong to it. An empty command would be rejected
			// by the validator anyway.
			draft.push({
				key: '',
				command: commands.length > 0 ? commands[0].command : '',
				params: {},
				secretParams: [],
				stored: false,
			});
			render();
			// The new entry is appended at the bottom of the list, which is often
			// off-screen. Scroll it into view so the operator sees the fresh row
			// instead of wondering whether the click did anything.
			if (entriesHost instanceof HTMLElement) {
				var added = entriesHost.lastElementChild;
				if (added instanceof HTMLElement) {
					added.scrollIntoView({behavior: 'smooth', block: 'nearest'});
				}
			}
		});
	}

	if (validateButton instanceof HTMLElement) {
		validateButton.addEventListener('click', function () {
			var draftEntries = collectDraft();
			if (reportMissingRequired(draftEntries)) {
				return;
			}
			api('/admin/api/validate', {entries: draftEntries})
				.then(function (body) {
					clearStatus();
					if (body.ok) {
						setStatus('ok', 'All presets are valid.');
						return;
					}
					showProblems(body.problems);
				})
				.catch(function (error) {
					setStatus('error', String(error.message || error));
				});
		});
	}

	if (saveButton instanceof HTMLElement) {
		saveButton.addEventListener('click', function () {
			var draftEntries = collectDraft();
			if (reportMissingRequired(draftEntries)) {
				return;
			}
			api('/admin/api/save', {entries: draftEntries, baseHash: contentHash})
				.then(function (body) {
					contentHash = body.contentHash;
					drift = body.drift || {};
					renderDrift();
					clearStatus();
					setStatus(
						'ok',
						'Saved. The file on disk changed, so it now needs whitelist approval and a restart.',
					);
				})
				.catch(function (error) {
					setStatus('error', String(error.message || error));
				});
		});
	}

	if (revertButton instanceof HTMLElement) {
		revertButton.addEventListener('click', function () {
			if (!window.confirm('Replace the file with the version the whitelist approves? Unsaved edits are lost.')) {
				return;
			}
			api('/admin/api/revert', {})
				.then(function (body) {
					contentHash = body.contentHash;
					drift = body.drift || {};
					entries = Array.isArray(body.entries) ? body.entries : [];
					draft = entries.map(function (entry) {
						return {
							key: entry.key,
							command: entry.command,
							params: entry.params || {},
							secretParams: Array.isArray(entry.secretParams) ? entry.secretParams : [],
						};
					});
					render();
					renderDrift();
					setStatus('ok', 'Restored the whitelist-approved file.');
				})
				.catch(function (error) {
					setStatus('error', String(error.message || error));
				});
		});
	}

	if (logoutButton instanceof HTMLElement) {
		logoutButton.addEventListener('click', function () {
			api('/admin/logout', {}).then(function () {
				window.location.assign('/admin/local-config');
			});
		});
	}

	// Session countdown, shown in the header next to Sign out. The cookie is
	// HttpOnly, so the only way to know when it lapses is the expiry the server
	// embedded in the page state. Tick once a second: show mm:ss remaining, turn
	// amber under a minute, and on expiry replace the countdown with a sign-in
	// prompt rather than letting the next save/validate fail with a bare 401.
	//
	// A header-authenticated caller has no cookie and no expiry, so the server
	// renders neither the timer nor the Refresh button (sessionExpiresAt is 0 and
	// #sessionTimer is absent): there is nothing time-limited to show or extend.
	var sessionTimerElement = document.getElementById('sessionTimer');
	var sessionErrorElement = document.getElementById('sessionError');
	var refreshSessionButton = document.getElementById('refreshSessionButton');
	if (
		sessionExpiresAt > 0 &&
		sessionTimerElement instanceof HTMLElement
	) {
		var formatRemaining = function (seconds) {
			var mm = Math.floor(seconds / 60);
			var ss = seconds % 60;
			return mm + ':' + (ss < 10 ? '0' : '') + ss;
		};
		var SESSION_WARN_SECONDS = 60;
		var sessionTimerId = 0;
		var renderSessionTimer = function () {
			var remaining = sessionExpiresAt - Math.floor(Date.now() / 1000);
			if (remaining <= 0) {
				sessionTimerElement.className = 'session-timer expired';
				sessionTimerElement.textContent =
					'Session expired. Reload to sign in again.';
				return false;
			}
			sessionTimerElement.className =
				'session-timer' +
				(remaining <= SESSION_WARN_SECONDS ? ' warn' : '');
			sessionTimerElement.textContent =
				'Session expires in ' + formatRemaining(remaining);
			return true;
		};
		var startSessionTimer = function () {
			if (sessionTimerId) {
				window.clearInterval(sessionTimerId);
			}
			if (renderSessionTimer()) {
				sessionTimerId = window.setInterval(function () {
					if (!renderSessionTimer()) {
						window.clearInterval(sessionTimerId);
						sessionTimerId = 0;
					}
				}, 1000);
			}
		};
		startSessionTimer();

		if (refreshSessionButton instanceof HTMLElement) {
			refreshSessionButton.addEventListener('click', function () {
				api('/admin/api/refresh-session', {})
					.then(function (body) {
						// No success toast: the countdown visibly resetting is the
						// confirmation. A failure is shown inline in the header,
						// next to the timer it concerns, not in the page-wide
						// status line far below. #sessionError is always rendered
						// beside the refresh button, so it is present here.
						if (sessionErrorElement instanceof HTMLElement) {
							sessionErrorElement.hidden = true;
							sessionErrorElement.textContent = '';
						}
						if (typeof body.sessionExpiresAt === 'number') {
							sessionExpiresAt = body.sessionExpiresAt;
						}
						startSessionTimer();
					})
					.catch(function (error) {
						if (sessionErrorElement instanceof HTMLElement) {
							sessionErrorElement.hidden = false;
							sessionErrorElement.textContent = String(
								error.message || error,
							);
						}
					});
			});
		}
	}

	renderDrift();
	render();
})();
`;
