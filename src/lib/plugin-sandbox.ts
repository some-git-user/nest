/**
 * Builds the global object handed to `vm.createContext` when running a plugin.
 *
 * Why a plain `{ ...globalThis }` is not enough
 * ─────────────────────────────────────────────
 * Spreading copies only *enumerable own* properties, but many standard globals
 * are defined as non-enumerable on `globalThis`. `URL`, `URLSearchParams`,
 * `console`, `TextEncoder`, `AbortController`, `Headers`, `Request`, `Response`
 * and friends are all non-enumerable data properties, so a spread silently
 * drops them and a plugin that calls `new URL(...)` fails at runtime with
 * `ReferenceError: URL is not defined` - even though the same code works when
 * the plugin is loaded through `require` on the filesystem.
 *
 * The fix copies every non-enumerable *data* property in addition to the
 * spread. Non-enumerable *accessor* properties are deliberately skipped:
 * reading them eagerly triggers side effects (the `localStorage` getter warns
 * without `--localstorage-file`, and `punycode`, `sys` and `WASI` emit
 * deprecation/experimental warnings) and they were never available to plugins
 * before. The one accessor plugins legitimately need, `Buffer`, is copied
 * explicitly by reference instead.
 */

/**
 * Non-enumerable accessor globals that are safe and useful to expose. They are
 * read by reference rather than through the `globalThis` getter to avoid the
 * warnings that reading some other accessors would emit.
 */
const EXPOSED_ACCESSOR_GLOBALS: Readonly<Record<string, unknown>> = {
	Buffer,
};

/**
 * A shallow copy of the host globals plus any plugin-specific overrides
 * (`require`, `module`, `exports`, `__filename`, `__dirname`). The result is
 * meant to be passed straight to `vm.createContext`.
 */
export const buildPluginSandbox = (
	overrides: Record<string, unknown>,
): Record<string, unknown> => {
	const sandbox: Record<string, unknown> = {...globalThis};

	const descriptors = Object.getOwnPropertyDescriptors(globalThis);
	for (const [key, descriptor] of Object.entries(descriptors)) {
		// Only fill the gaps the spread left: non-enumerable data properties.
		// Accessors are skipped so their getters are never invoked eagerly.
		if (!descriptor.enumerable && 'value' in descriptor) {
			sandbox[key] = descriptor.value;
		}
	}

	Object.assign(sandbox, EXPOSED_ACCESSOR_GLOBALS);

	return Object.assign(sandbox, overrides);
};
