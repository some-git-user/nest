/**
 * Client script for the admin config editor.
 *
 * Served as a static string at a fixed path rather than inlined, because the
 * page's CSP is `script-src 'self'` and inline scripts would be blocked.
 */
export const ADMIN_CONFIG_SCRIPT_PATH = '/admin/local-config.js';

export const ADMIN_CONFIG_SCRIPT = `// Admin config editor
/* global document, window, fetch, HTMLElement, HTMLInputElement, HTMLSelectElement */

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

	var commands = Array.isArray(state.commands) ? state.commands : [];
	var entries = Array.isArray(state.entries) ? state.entries : [];
	var drift = state.drift || {};
	var contentHash = typeof state.contentHash === 'string' ? state.contentHash : '';
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
				value = secret ? '' : field.defaultValue || '';
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
		// preset written by hand is never silently dropped on save.
		Object.keys(entry.params).forEach(function (name) {
			if (fieldNames[name]) {
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
					'<div class="params">' + paramRows(entry, index) + '</div>' +
					commandHtml +
					'<div class="entry-actions">' +
					'<button type="button" data-action="test">Test</button>' +
					'<button type="button" data-action="copy">Copy</button>' +
					'<button type="button" data-action="remove" class="danger">Remove</button>' +
					'</div>' +
					'<div class="test-result" data-role="testResult"></div>' +
					'</div>'
				);
			})
			.join('');
		updateDuplicateKeyWarnings();
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
		element.querySelectorAll('[data-param]').forEach(function (input) {
			if (!(input instanceof HTMLInputElement)) {
				return;
			}
			var name = input.getAttribute('data-param') || '';
			if (commandChanged) {
				var declared = previousFields[name];
				if (
					declared !== undefined &&
					input.value === (declared.defaultValue || '')
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

	var onTest = function (element) {
		var entry = collectEntry(element);
		if (!entry) {
			return;
		}
		var resultHost = element.querySelector('[data-role="testResult"]');
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
			});
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

		// A key edit does not change the form structure, so update the duplicate
		// warnings in place instead of re-rendering, which would steal focus.
		entriesHost.addEventListener('input', function (event) {
			if (!(event.target instanceof HTMLElement)) {
				return;
			}
			if (event.target.getAttribute('data-role') !== 'key') {
				return;
			}
			var entryElement = event.target.closest('.entry');
			if (entryElement instanceof HTMLElement) {
				collectEntry(entryElement);
			}
			updateDuplicateKeyWarnings();
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
			api('/admin/api/validate', {entries: collectDraft()})
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
			api('/admin/api/save', {entries: collectDraft(), baseHash: contentHash})
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

	renderDrift();
	render();
})();
`;
