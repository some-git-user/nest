/**
 * SSH2 Preload Module
 *
 * This module MUST be loaded before any other code to intercept ssh2 native addon requires.
 * It sets up require() interception that will catch ssh2's native module loads.
 *
 * Usage: This file is imported by server-preload.ts which is the actual entry point.
 */
import fs from 'fs';
import type {Module} from 'module';
import os from 'os';
import path from 'path';

// Simple error message helper (avoiding circular dependency)
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return String(error);
}

// Initialize global stubs for native addons BEFORE any ssh2 code runs
// These will be populated by process.dlopen() at runtime
declare global {
	var __SSH2_CRYPTO_STUB__: Record<string, unknown>;
	var __CPU_FEATURES_STUB__: Record<string, unknown>;
}

globalThis.__SSH2_CRYPTO_STUB__ = {};
globalThis.__CPU_FEATURES_STUB__ = {};

// This will be set when dlopen succeeds
let nativeAddonExports: Record<string, unknown> | null = null;
let interceptionSetup = false;
let preloadedSsh2: Record<string, unknown> | null = null;

/**
 * Setup require() interception for ssh2 native addon.
 * Exported for testing.
 */
export function setupRequireInterception(
	Module: typeof import('module'),
	nativeExports: Record<string, unknown> | null,
	preloaded: Record<string, unknown> | null,
): void {
	const originalRequire = Module.prototype.require.bind(Module);
	let inSsh2Require = false;

	const requireInterceptor: typeof Module.prototype.require = ((
		id: string,
		...args: unknown[]
	): unknown => {
		// Check if this is the ssh2 native addon path (relative path from ssh2's crypto.js)
		if (id === './crypto/build/Release/sshcrypto.node') {
			return nativeExports;
		}
		// Check if this is the main ssh2 package - return preloaded ssh2
		if (id === 'ssh2' && !inSsh2Require) {
			console.log('[SSH2 Preload] Intercepted ssh2 package require');
			if (preloaded) {
				console.log('[SSH2 Preload] Returning preloaded ssh2 module');
				return preloaded;
			}
			console.log('[SSH2 Preload] No preloaded ssh2, using original require');
			inSsh2Require = true;
			try {
				const ssh2Module = (
					originalRequire as (id: string, ...args: unknown[]) => unknown
				).call(originalRequire, id, ...args);
				console.log('[SSH2 Preload] ssh2 package loaded successfully');
				return ssh2Module;
			} finally {
				inSsh2Require = false;
			}
		}
		// Call original require for everything else
		return (
			originalRequire as (id: string, ...args: unknown[]) => unknown
		).call(originalRequire, id, ...args);
	}) as typeof Module.prototype.require;

	Module.prototype.require = requireInterceptor;
}

/**
 * Setup ssh2 native addon interception.
 * This MUST be called before any module tries to require ssh2.
 */
export function setupSsh2Interception(): void {
	console.log('[SSH2 Preload] setupSsh2Interception() called');

	if (interceptionSetup) {
		console.log('[SSH2 Preload] Already set up, returning');
		return; // Already set up
	}

	// Check if we're running in SEA mode
	// Note: We must use require() here because this code runs before ES module
	// initialization in SEA mode. The 'node:sea' API is only available at runtime
	// when the binary is executed, not during bundling.
	// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
	const seaModule: unknown = require('node:sea');
	if (
		!(
			typeof seaModule === 'object' &&
			seaModule !== null &&
			'isSea' in seaModule &&
			typeof (seaModule as {isSea: unknown}).isSea === 'function'
		)
	) {
		console.log('[SSH2 Preload] Invalid seaModule object');
		interceptionSetup = true;
		return;
	}
	const seaModuleApi = seaModule as {
		isSea: () => boolean;
		getRawAsset: (name: string) => Buffer;
	};
	console.log('[SSH2 Preload] Checking SEA mode:', seaModuleApi.isSea());
	if (!seaModuleApi.isSea()) {
		console.log(
			'[SSH2 Preload] Not running in SEA mode, ssh2 will load normally',
		);
		interceptionSetup = true;
		return;
	}

	console.log(
		'[SSH2 Preload] Running in SEA mode, setting up ssh2 native addon interception',
	);

	try {
		const result = setupSsh2InSeaMode(seaModuleApi);
		nativeAddonExports = result.nativeExports;
		preloadedSsh2 = result.preloadedSsh2;

		// Intercept require calls to intercept ssh2's native module load
		console.log('[SSH2 Preload] Setting up require() interception');
		setupRequireInterception(result.Module, nativeAddonExports, preloadedSsh2);

		interceptionSetup = true;
		console.log('[SSH2 Preload] SSH2 native addon interception setup complete');

		// Clean up temp file after a delay
		// istanbul ignore next - cleanup runs asynchronously after test completes
		setTimeout(() => {
			try {
				fs.rmSync(result.tempPath);
				console.log('[SSH2 Preload] Cleaned up temp sshcrypto.node file');
			} catch (err) {
				const errorMsg = getErrorMessage(err);
				console.log(
					`[SSH2 Preload] Temp file cleanup error (ignored): ${errorMsg}`,
				);
			}
		}, 10000);
	} catch (err) {
		const errorMsg = getErrorMessage(err);
		console.error(
			`[SSH2 Preload] Failed to setup ssh2 interception: ${errorMsg}`,
		);
	}
}

/**
 * Setup SSH2 in SEA mode.
 * Exported for testing.
 */
export function setupSsh2InSeaMode(
	this: void,
	seaModuleApi: {
		getRawAsset: (name: string) => Buffer;
	},
): {
	Module: typeof import('module');
	nativeExports: Record<string, unknown> | null;
	preloadedSsh2: Record<string, unknown> | null;
	tempPath: string;
} {
	// Try to extract the native addon from SEA assets to a temp file
	// Note: Native addon may not be available if it couldn't be built for this Node.js version
	console.log(
		'[SSH2 Preload] Attempting to extract sshcrypto.node from SEA assets',
	);
	let tempPath = '';
	let nativeExports: Record<string, unknown> | null = null;

	try {
		const rawAsset = seaModuleApi.getRawAsset('sshcrypto.node');
		console.log('[SSH2 Preload] Raw asset type:', typeof rawAsset);
		// getRawAsset returns ArrayBuffer in SEA mode, convert to Buffer
		const sshcryptoBuffer: Buffer = Buffer.isBuffer(rawAsset)
			? rawAsset
			: Buffer.from(rawAsset as ArrayBuffer);
		console.log(
			'[SSH2 Preload] Converted to Buffer:',
			Buffer.isBuffer(sshcryptoBuffer),
		);
		tempPath = path.join(os.tmpdir(), `sshcrypto-${process.pid}.node`);
		fs.writeFileSync(tempPath, sshcryptoBuffer);
		console.log(`[SSH2 Preload] Extracted sshcrypto.node to ${tempPath}`);
		console.log(
			'[SSH2 Preload] File size:',
			fs.statSync(tempPath).size,
			'bytes',
		);

		// Load the native addon using a proper Module instance
		// Note: We must use require('module') here to get a fresh Module constructor
		// for creating a new module instance to load the native addon. This is required
		// because we need to call process.dlopen() on a Module instance we create,
		// not the imported module type.
		// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
		const Module = require('module') as typeof import('module');
		const nativeModule = new Module('ssh2-crypto') as Module & {
			exports: Record<string, unknown>;
		};
		console.log('[SSH2 Preload] Calling process.dlopen() with Module instance');
		try {
			process.dlopen(nativeModule, tempPath);
			console.log('[SSH2 Preload] Loaded native addon via dlopen');
			nativeExports = nativeModule.exports as Record<string, unknown>;
			console.log(
				'[SSH2 Preload] nativeAddon exports:',
				Object.keys(nativeExports),
			);
		} catch (dlopenErr) {
			// istanbul ignore next - dlopen failure is hard to test in SEA mode
			console.error('[SSH2 Preload] dlopen failed:', dlopenErr);
			console.log(
				'[SSH2 Preload] Native addon failed, will use ssh2 JS fallback',
			);
			// Clean up temp file if dlopen failed
			try {
				fs.rmSync(tempPath);
				tempPath = '';
			} catch (cleanupErr) {
				// Ignore cleanup errors
				void cleanupErr;
			}
			nativeExports = null;
		}
	} catch (err) {
		// Native addon not in SEA assets or extraction failed
		// This is expected if the native addon couldn't be built for this Node.js version
		const errorMsg = getErrorMessage(err);
		console.log('[SSH2 Preload] No native addon in SEA assets:', errorMsg);
		console.log('[SSH2 Preload] ssh2 will use JavaScript crypto fallback');
		tempPath = '';
		nativeExports = null;
	}

	// Preload ssh2 module now that native addon is loaded (or JS fallback will be used)
	console.log('[SSH2 Preload] Preloading ssh2 module');
	let preloadedSsh2: Record<string, unknown> | null = null;
	try {
		// Preload ssh2 module using require() to ensure it loads with our
		// require() interception already in place. This is necessary because
		// ssh2 may try to load its native addon during import, and we need
		// to catch that require() call.
		// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
		preloadedSsh2 = require('ssh2') as Record<string, unknown>;
		console.log('[SSH2 Preload] ssh2 module preloaded successfully');
		console.log('[SSH2 Preload] ssh2 exports:', Object.keys(preloadedSsh2));
	} catch (preloadErr) {
		// istanbul ignore next - ssh2 preload failure is hard to test in Jest isolation
		console.error('[SSH2 Preload] Failed to preload ssh2:', preloadErr);
	}
	// Get Module constructor for return value
	// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
	const mod = require('module') as typeof import('module');

	return {Module: mod, nativeExports, preloadedSsh2, tempPath};
}
