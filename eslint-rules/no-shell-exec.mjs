/**
 * Custom ESLint rule: forbid shell-based child_process execution.
 *
 * Building a command as a single string and running it through a shell is the
 * classic command-injection primitive: any attacker-controlled value that lands
 * in the string can break out and run arbitrary commands (`; rm -rf /`,
 * backticks, `$(...)`, pipes, ...). The safe shape is to pass the program and
 * its arguments separately (`execFile`/`spawn` with an argv array) and never
 * enable the `shell` option, so arguments are handed to the OS as data, never
 * re-parsed by a shell.
 *
 * This rule enforces that contract statically:
 *
 *   DISALLOWED:
 *     exec(`du -sh ${dir}`)                 // always runs via /bin/sh
 *     execSync('smartctl -a ' + device)     // always runs via /bin/sh
 *     execFile('sh', ['-c', cmd])           // (best effort - see note below)
 *     execFileSync('dmesg', args, {shell: true})
 *     spawn('cmd', args, {shell: true})
 *
 *   ALLOWED:
 *     execFile('nvidia-smi', ['--query-gpu=...'])
 *     execFileSync('smartctl', ['-a', '--json=c', device])
 *     spawnSync('openssl', ['x509', '-in', certPath])
 *
 * The rule tracks names imported (or `require`d) from `child_process`, both as
 * named bindings (`import {execSync} ...`) and namespace members
 * (`cp.execSync(...)`), so aliased imports are still caught.
 *
 * NOTE: `promisify(execFile)` produces a local alias the rule cannot trace, so
 * a `shell: true` passed to that alias is not detected. That is an accepted
 * limitation of a syntactic rule; the direct `exec`/`execSync` ban and the
 * literal `shell: true` check cover the realistic cases.
 */

// Always shell-based: the whole command is one string handed to /bin/sh.
const SHELL_ONLY_FUNCTIONS = new Set(['exec', 'execSync']);

// Safe when given an argv array, unsafe when `shell: true` is set.
const SHELL_OPTION_FUNCTIONS = new Set([
	'execFile',
	'execFileSync',
	'spawn',
	'spawnSync',
]);

const CHILD_PROCESS_MODULE = 'child_process';

/**
 * Is `node` a truthy-enough value to enable a shell? `true` and any non-empty
 * string path (e.g. `shell: '/bin/bash'`) both turn the shell on.
 */
const isTruthyShellValue = (node) => {
	if (!node) {
		return false;
	}
	if (node.type === 'Literal') {
		return Boolean(node.value);
	}
	if (node.type === 'TemplateLiteral') {
		// `shell: \`\`` is falsy; anything with content or substitutions is treated
		// as enabling a shell, which is the safe assumption.
		return (
			node.quasis.length > 1 || node.quasis.some((q) => q.value.cooked !== '')
		);
	}
	// Identifiers, calls, member access, etc. - assume they enable a shell.
	return true;
};

/**
 * Find a `shell: <truthy>` property on an options object literal.
 */
const findTruthyShellProperty = (objectNode) => {
	if (!objectNode || objectNode.type !== 'ObjectExpression') {
		return null;
	}
	for (const property of objectNode.properties) {
		if (property.type !== 'Property') {
			continue;
		}
		const key = property.key;
		const keyName =
			key.type === 'Identifier' && !property.computed
				? key.name
				: key.type === 'Literal'
					? String(key.value)
					: undefined;
		if (keyName === 'shell' && isTruthyShellValue(property.value)) {
			return property;
		}
	}
	return null;
};

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Forbid shell-based child_process execution (exec/execSync and shell:true). Use execFile/spawn with an argv array instead.',
			recommended: true,
		},
		fixable: null,
		schema: [],
		messages: {
			noShellExec:
				'"{{name}}" runs its command through a shell and is vulnerable to command injection. Use execFile()/spawn() with a separate argv array instead.',
			noShellOption:
				'Do not enable the "shell" option on "{{name}}": it re-parses arguments through a shell and reintroduces command injection. Pass an argv array with the shell disabled.',
		},
	},
	create(context) {
		// localName -> imported child_process function name
		const namedImports = new Map();
		// Set of local names bound to the whole module (`import * as cp`, or the
		// result of `require('child_process')`), so `cp.execSync(...)` resolves.
		const namespaceImports = new Set();

		const isChildProcessRequire = (node) =>
			node.type === 'CallExpression' &&
			node.callee.type === 'Identifier' &&
			node.callee.name === 'require' &&
			node.arguments.length === 1 &&
			node.arguments[0].type === 'Literal' &&
			node.arguments[0].value === CHILD_PROCESS_MODULE;

		const registerRequireBinding = (idNode, init) => {
			if (!isChildProcessRequire(init)) {
				return;
			}
			if (idNode.type === 'Identifier') {
				namespaceImports.add(idNode.name);
			} else if (idNode.type === 'ObjectPattern') {
				for (const prop of idNode.properties) {
					if (prop.type !== 'Property') {
						continue;
					}
					const imported =
						prop.key.type === 'Identifier' && !prop.computed
							? prop.key.name
							: prop.key.type === 'Literal'
								? String(prop.key.value)
								: undefined;
					if (
						imported &&
						(prop.value.type === 'Identifier' ||
							prop.value.type === 'ObjectPattern')
					) {
						if (prop.value.type === 'Identifier') {
							namedImports.set(prop.value.name, imported);
						}
					}
				}
			}
		};

		/**
		 * Resolve a callee to the child_process function it refers to, or null.
		 */
		const resolveCalleeFunction = (callee) => {
			if (callee.type === 'Identifier') {
				return namedImports.get(callee.name) ?? null;
			}
			if (
				callee.type === 'MemberExpression' &&
				!callee.computed &&
				callee.object.type === 'Identifier' &&
				callee.property.type === 'Identifier' &&
				namespaceImports.has(callee.object.name)
			) {
				return callee.property.name;
			}
			return null;
		};

		return {
			ImportDeclaration(node) {
				if (node.source.value !== CHILD_PROCESS_MODULE) {
					return;
				}
				for (const spec of node.specifiers) {
					if (spec.type === 'ImportSpecifier') {
						const imported =
							spec.imported.type === 'Identifier'
								? spec.imported.name
								: String(spec.imported.value);
						namedImports.set(spec.local.name, imported);
					} else if (
						spec.type === 'ImportNamespaceSpecifier' ||
						spec.type === 'ImportDefaultSpecifier'
					) {
						namespaceImports.add(spec.local.name);
					}
				}
			},

			VariableDeclarator(node) {
				if (node.init) {
					registerRequireBinding(node.id, node.init);
				}
			},

			AssignmentExpression(node) {
				if (
					node.operator === '=' &&
					(node.left.type === 'Identifier' ||
						node.left.type === 'ObjectPattern')
				) {
					registerRequireBinding(node.left, node.right);
				}
			},

			'CallExpression, NewExpression'(node) {
				const fnName = resolveCalleeFunction(node.callee);
				if (!fnName) {
					return;
				}

				if (SHELL_ONLY_FUNCTIONS.has(fnName)) {
					context.report({
						node: node.callee,
						messageId: 'noShellExec',
						data: {name: fnName},
					});
					return;
				}

				if (SHELL_OPTION_FUNCTIONS.has(fnName)) {
					// Options object is the 3rd argument for execFile/spawn and their
					// sync variants; scan any object-literal argument to be safe.
					for (const arg of node.arguments) {
						const shellProp = findTruthyShellProperty(arg);
						if (shellProp) {
							context.report({
								node: shellProp,
								messageId: 'noShellOption',
								data: {name: fnName},
							});
							break;
						}
					}
				}
			},
		};
	},
};
