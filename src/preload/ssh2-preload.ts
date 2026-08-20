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
	// eslint-disable-next-line @typescript-eslint/no-require-imports
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
	// Extract the native addon from SEA assets to a temp file
	console.log('[SSH2 Preload] Extracting sshcrypto.node from SEA assets');
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
	const tempPath = path.join(os.tmpdir(), `sshcrypto-${process.pid}.node`);
	fs.writeFileSync(tempPath, sshcryptoBuffer);
	console.log(`[SSH2 Preload] Extracted sshcrypto.node to ${tempPath}`);
	console.log('[SSH2 Preload] File size:', fs.statSync(tempPath).size, 'bytes');

	// Load the native addon using a proper Module instance
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const Module = require('module') as typeof import('module');
	const nativeModule = new Module('ssh2-crypto') as Module & {
		exports: Record<string, unknown>;
	};
	console.log('[SSH2 Preload] Calling process.dlopen() with Module instance');
	let nativeExports: Record<string, unknown> | null = null;
	try {
		process.dlopen(nativeModule, tempPath);
		console.log('[SSH2 Preload] Loaded native addon via dlopen');
		nativeExports = nativeModule.exports as Record<string, unknown>;
		console.log(
			'[SSH2 Preload] nativeAddon exports:',
			Object.keys(nativeExports),
		);
	} catch (dlopenErr) {
		// istanbul ignore next - dlopen failure is hard to test in Jest isolation
		console.error('[SSH2 Preload] dlopen failed:', dlopenErr);
		// istanbul ignore next - dlopen failure is hard to test in Jest isolation
		console.log('[SSH2 Preload] Will use empty stub instead');
	}

	// Preload ssh2 module now that native addon is loaded
	console.log('[SSH2 Preload] Preloading ssh2 module');
	let preloadedSsh2: Record<string, unknown> | null = null;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		preloadedSsh2 = require('ssh2') as Record<string, unknown>;
		console.log('[SSH2 Preload] ssh2 module preloaded successfully');
	} catch (preloadErr) {
		// istanbul ignore next - ssh2 preload failure is hard to test in Jest isolation
		console.error('[SSH2 Preload] Failed to preload ssh2:', preloadErr);
	}

	return {Module, nativeExports, preloadedSsh2, tempPath};
}
