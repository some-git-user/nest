import {getErrorMessage} from './error-message';
import {readConfigDocument} from './local-config-store';
import {logger} from './logger';
import {
	createSecretKey,
	getSecretKeyPath,
	isEncryptedValue,
	secretKeyFileExists,
} from './secret-crypto';

/**
 * Outcome of the startup key bootstrap, surfaced as a startup warning.
 */
export type SecretKeyBootstrapResult =
	| {status: 'present'}
	| {status: 'created'; message: string}
	| {status: 'missing-with-secrets'; message: string}
	| {status: 'error'; message: string};

/**
 * True when any preset value on disk is an encrypted blob.
 *
 * Reads the raw document (not the decrypted cache) so it works even when the
 * key is absent - which is exactly the case being decided here.
 */
const presetsContainEncryptedSecrets = (): boolean => {
	const {doc} = readConfigDocument();
	return doc.entries.some((entry) =>
		Object.values(entry.params).some((value) => isEncryptedValue(value)),
	);
};

/**
 * Ensure a master key exists before the config is loaded and decrypted.
 *
 * Mirrors the TLS certificate bootstrap: a deployment with no key yet gets one
 * created automatically, so a fresh development checkout needs no manual step.
 * The deb creates the key in `postinst` instead, so this is a no-op there.
 *
 * The safety rule: a key is only auto-created when no encrypted secret exists
 * yet. If the presets already hold `enc:v1:` values but the key is gone (an
 * accidental delete, a restore that skipped it), silently minting a new key
 * would produce a key that cannot decrypt them and a confusing failure later.
 * Instead the operator is told to restore the original key.
 *
 * @returns The bootstrap outcome, for the caller to record as a warning
 */
export const bootstrapSecretKey = (): SecretKeyBootstrapResult => {
	// secretKeyFileExists validates the configured path and throws on a
	// misconfiguration (traversal, or outside the allowed directories). Catch it
	// so this function keeps its non-throwing contract and the caller can record
	// a clean startup warning instead of crashing on a raw stack trace.
	let keyPresent: boolean;
	try {
		keyPresent = secretKeyFileExists();
	} catch (error) {
		const message = `Invalid secret key path: ${getErrorMessage(error)}`;
		logger.error(message);
		return {status: 'error', message};
	}
	if (keyPresent) {
		return {status: 'present'};
	}

	let hasSecrets: boolean;
	try {
		hasSecrets = presetsContainEncryptedSecrets();
	} catch (error) {
		// The presets file could not be inspected (missing is fine and treated as
		// "no secrets"; a real read error is reported by the config loader). Treat
		// an unreadable file as unsafe to auto-create and let the loader surface it.
		const message = `Could not inspect the presets file for encrypted secrets: ${getErrorMessage(error)}`;
		logger.error(message);
		return {status: 'error', message};
	}

	if (hasSecrets) {
		const message =
			`The presets file contains encrypted secrets but the secret key ` +
			`(${getSecretKeyPath()}) is missing. Restore the original key file; a new ` +
			`key cannot decrypt existing secrets. Presets with encrypted parameters ` +
			`will be unavailable until it is restored.`;
		logger.error(message);
		return {status: 'missing-with-secrets', message};
	}

	try {
		createSecretKey();
	} catch (error) {
		const message = `Could not create the secret key: ${getErrorMessage(error)}`;
		logger.error(message);
		return {status: 'error', message};
	}

	const message =
		`Generated a new secret key at ${getSecretKeyPath()} (0600). Secrets saved ` +
		`through the admin UI are now encrypted with it. Back this file up: without ` +
		`it, encrypted secrets cannot be recovered.`;
	logger.warn(message);
	return {status: 'created', message};
};
