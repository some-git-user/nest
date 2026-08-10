// Mock for vm module to enable testing of dynamic route plugin execution
// This mock simulates TypeScript transpilation and module execution in memory
//
// Usage in tests:
//   jest.mock('vm', () => require('../test/mocks/vm'));
//   // Then configure before each test:
//   vmMock.setPluginModule(pluginModule);
import vm from 'vm';

let currentPluginModule: unknown = undefined;

export const setPluginModule = (pluginModule: unknown): void => {
	currentPluginModule = pluginModule;
};

export const resetPluginModule = (): void => {
	currentPluginModule = undefined;
};

export const createContextMock = (contextObject: unknown): vm.Context => {
	// Return the context object as-is
	return contextObject as vm.Context;
};

export const runInContextMock = jest.fn(
	(code: string, context: unknown): unknown => {
		const ctx = context as {
			module: {exports: unknown};
			exports: unknown;
		};

		// If currentPluginModule is set, simulate TypeScript transpilation
		// by setting both exports and module.exports (they reference the same object)
		if (currentPluginModule) {
			Object.assign(
				ctx.exports as Record<string, unknown>,
				currentPluginModule,
			);
			Object.assign(
				ctx.module.exports as Record<string, unknown>,
				currentPluginModule,
			);
		}
		return ctx.module.exports;
	},
);

// Export both default and named exports for ES module compatibility
const vmMock = {
	createContext: createContextMock,
	runInContext: runInContextMock,
};

export default vmMock;
export {vmMock};
