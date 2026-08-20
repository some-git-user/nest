/**
 * Global type declarations for native addon stubs
 * These are used for SEA (Single Executable Application) compatibility
 */

declare global {
	namespace NodeJS {
		interface Global {
			__SSH2_CRYPTO_STUB__: Record<string, unknown>;
			__CPU_FEATURES_STUB__: Record<string, unknown>;
		}
	}

	interface GlobalThis {
		__SSH2_CRYPTO_STUB__: Record<string, unknown>;
		__CPU_FEATURES_STUB__: Record<string, unknown>;
	}
}

export {};
