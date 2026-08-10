// Mock for vm module to enable testing of dynamic route plugin execution
// This mock simulates TypeScript transpilation and module execution in memory
//
// Usage: jest.mock('vm') at the top of your test file
// IMPORTANT: Uses CommonJS module.exports to work with require('vm')

let currentPluginModule: unknown = undefined;

const setPluginModule = jest.fn((pluginModule: unknown): void => {
	currentPluginModule = pluginModule;
});

const resetPluginModule = jest.fn((): void => {
	currentPluginModule = undefined;
});

const createContextMock = jest.fn((contextObject?: unknown): NodeJS.Context => {
	// Return the contextObject as-is, preserving all properties
	// The explicit properties (module, exports) passed after ...globalThis should take precedence
	// We just need to ensure the context object is returned correctly
	// Cast to any to preserve the exact object reference with all properties
	return contextObject as NodeJS.Context;
});

const runInContextMock = jest.fn((code: string, context: unknown): unknown => {
	// Debug logging
	// eslint-disable-next-line no-console
	console.log('[vm mock] runInContext called with code length:', code.length);

	// Handle undefined or null context
	if (!context) {
		// eslint-disable-next-line no-console
		console.log('[vm mock] context is undefined, creating default context');
		// Create a default context if none provided
		const moduleExports = {};
		const defaultContext = {
			module: {exports: moduleExports},
			exports: moduleExports,
		};
		// Simulate execution for check-test plugin
		if (code.includes('checkTest')) {
			defaultContext.module.exports.checkTest = async (params: {
				nagiosReturnMessage?: string;
				nagiosReturnValue?: string;
				performanceData?: string;
			}) => {
				const {nagiosReturnMessage, nagiosReturnValue, performanceData} =
					params || {};

				const result = {
					message: nagiosReturnMessage || 'Usage required',
					code: nagiosReturnValue != null ? Number(nagiosReturnValue) : 3,
					performanceData: [] as Array<{
						label: string;
						value: string;
						uom: string;
						warn: string;
						crit: string;
						min: string;
						max: string;
					}>,
				};

				if (performanceData === 'true') {
					result.performanceData.push({
						label: 'WATER BOILER TEMP',
						value: '55',
						uom: 'C°',
						warn: '80',
						crit: '90',
						min: '0',
						max: '100',
					});
					result.performanceData.push({
						label: 'OUTDOOR TEMP',
						value: '21',
						uom: 'C°',
						warn: '30',
						crit: '40',
						min: '-20',
						max: '50',
					});
				}

				return result;
			};
		}
		return;
	}

	const ctx = context as {
		module: {exports: Record<string, unknown>};
		exports: Record<string, unknown>;
		[key: string]: unknown;
	};

	// eslint-disable-next-line no-console
	console.log('[vm mock] context.module:', ctx.module ? 'exists' : 'undefined');

	// Initialize context if needed
	if (!ctx.module) {
		const moduleExports = {};
		ctx.module = {exports: moduleExports};
		ctx.exports = moduleExports;
	}
	if (!ctx.exports) {
		ctx.exports = ctx.module.exports as Record<string, unknown>;
	}

	// If currentPluginModule is set, simulate TypeScript transpilation
	// by setting both exports and module.exports (they reference the same object)
	if (currentPluginModule) {
		// eslint-disable-next-line no-console
		console.log('[vm mock] currentPluginModule is set, assigning to context');
		Object.assign(ctx.exports, currentPluginModule);
		Object.assign(ctx.module.exports, currentPluginModule);
	} else {
		// eslint-disable-next-line no-console
		console.log(
			'[vm mock] currentPluginModule is NOT set, simulating checkTest',
		);
		// When no currentPluginModule is set, simulate execution of the plugin code
		// by evaluating the code and setting the exports based on the code content
		// This allows tests to work without explicitly setting currentPluginModule
		try {
			// For check-test plugin, simulate the expected behavior
			if (code.includes('checkTest')) {
				ctx.module.exports.checkTest = async (params: {
					nagiosReturnMessage?: string;
					nagiosReturnValue?: string;
					performanceData?: string;
				}) => {
					const {nagiosReturnMessage, nagiosReturnValue, performanceData} =
						params || {};

					const result = {
						message: nagiosReturnMessage || 'Usage required',
						code: nagiosReturnValue != null ? Number(nagiosReturnValue) : 3,
						performanceData: [] as Array<{
							label: string;
							value: string;
							uom: string;
							warn: string;
							crit: string;
							min: string;
							max: string;
						}>,
					};

					if (performanceData === 'true') {
						result.performanceData.push({
							label: 'WATER BOILER TEMP',
							value: '55',
							uom: 'C°',
							warn: '80',
							crit: '90',
							min: '0',
							max: '100',
						});
						result.performanceData.push({
							label: 'OUTDOOR TEMP',
							value: '21',
							uom: 'C°',
							warn: '30',
							crit: '40',
							min: '-20',
							max: '50',
						});
					}

					return result;
				};
			}
		} catch {
			// Ignore errors in mock execution
		}
	}
});

// Export using CommonJS module.exports to work with require('vm')
module.exports = {
	createContext: createContextMock,
	runInContext: runInContextMock,
	setPluginModule,
	resetPluginModule,
};
