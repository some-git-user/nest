import {bool, cleanEnv, host, num, port, str} from 'envalid';
import * as fs from 'fs';
import * as path from 'path';
import {validateUnixFileSecurity} from '../lib/file-security';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'production';

function loadEnvFile(filepath: string) {
	if (!fs.existsSync(filepath)) {
		return;
	}
	const lines = fs.readFileSync(filepath, 'utf8').split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx === -1) {
			continue;
		}
		const key = trimmed.slice(0, eqIdx).trim();
		let value = trimmed.slice(eqIdx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		process.env[key] = value;
	}
}

function getConfigPath(): string {
	const argv = process.argv;
	const idx = argv.indexOf('--configPath');
	if (idx !== -1 && argv[idx + 1]) {
		return argv[idx + 1];
	}
	if (process.env.NEST_CONFIG_FILE) {
		return process.env.NEST_CONFIG_FILE;
	}
	// In production prefer the system config file installed by the package
	if (process.env.NODE_ENV === 'production') {
		return '/etc/nest/nest.conf';
	}
	return path.resolve(process.cwd(), '.env');
}

function validateConfigFileSecurity(filepath: string) {
	if (process.env.NODE_ENV !== 'production') {
		return;
	}

	if (!fs.existsSync(filepath)) {
		return;
	}

	// This check targets Unix-like production deployments where uid/mode semantics are available.
	if (typeof process.getuid !== 'function') {
		return;
	}

	const fileStat = fs.statSync(filepath);
	const currentUid = process.getuid();
	const validation = validateUnixFileSecurity(fileStat, currentUid);

	if (!validation.ok && validation.reason === 'owner-mismatch') {
		throw new Error(
			`Insecure config file ownership for ${filepath}: owner uid ${validation.actualUid} does not match process uid ${validation.expectedUid}`,
		);
	}

	if (!validation.ok && validation.reason === 'group-or-other-writable') {
		throw new Error(
			`Insecure config file permissions for ${filepath}: file must not be writable by group or others`,
		);
	}
}

const resolvedConfigPath = getConfigPath();
validateConfigFileSecurity(resolvedConfigPath);
loadEnvFile(resolvedConfigPath);

export const env = cleanEnv(process.env, {
	NODE_ENV: str({default: 'development'}),
	HOST: host({default: 'localhost'}),
	PORT: port({default: 5000}),
	TLS_CERT_PATH: str({default: 'certs/nest-cert.pem'}),
	TLS_KEY_PATH: str({default: 'certs/nest-key.pem'}),
	TLS_CERT_COMMON_NAME: str({default: 'localhost'}),
	TLS_CERT_DAYS: num({default: 365}),
	PLUGINS_DIR: str({default: 'plugins'}),
	LOG_FILE_PATH: str({default: 'logs/nest.log'}),
	MAX_LOG_FILE_SIZE_BYTES: num({default: 1024 * 1024}), // 1MB in bytes
	ENABLE_SECURITY_MIDDLEWARE: bool({default: true}),
	API_KEY_HEADER: str({default: 'x-api-key'}),
	API_KEY: str({default: ''}),
	ALLOWED_IPS: str({default: '127.0.0.1, ::1'}), // Loopback addresses by default for IPv4 and IPv6
	PLUGIN_WHITELIST_PATH: str({default: ''}),
	RATE_LIMIT_WINDOW_MS: num({default: 60_000}), // 60 seconds
	RATE_LIMIT_MAX: num({default: 120}), // 120 requests per window
});
