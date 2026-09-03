import {cleanEnv, host, num, port, str} from 'envalid';
import * as fs from 'fs';
import * as path from 'path';
import {validateUnixFileSecurity} from '../lib/file-security';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'production';

// Maximum allowed config file size (10KB)
const MAX_CONFIG_FILE_SIZE = 10 * 1024;

// Allowed directories for config files
const ALLOWED_CONFIG_DIRS = ['/etc/nest', process.cwd()];

function validateConfigFilePath(filepath: string): void {
	// Reject paths containing path traversal sequences
	if (filepath.includes('..')) {
		throw new Error('Config file path contains path traversal sequence');
	}

	// Resolve to absolute path for consistent validation
	const absolutePath = path.resolve(filepath);

	// Check if path is within allowed directories
	const isAllowed = ALLOWED_CONFIG_DIRS.some((baseDir) => {
		const resolvedBaseDir = path.resolve(baseDir);
		return (
			absolutePath.startsWith(resolvedBaseDir + path.sep) ||
			absolutePath === resolvedBaseDir
		);
	});

	if (!isAllowed) {
		throw new Error(
			`Config file path not in allowed directory: ${absolutePath}`,
		);
	}
}

function validateConfigFileSecurityInternal(filepath: string): void {
	const stats = fs.statSync(filepath);

	// Verify it's a regular file
	if (!stats.isFile()) {
		throw new Error('Config file is not a regular file');
	}

	// Check file size
	if (stats.size > MAX_CONFIG_FILE_SIZE) {
		throw new Error(
			`Config file exceeds maximum size limit (${MAX_CONFIG_FILE_SIZE} bytes)`,
		);
	}
}

function loadEnvFile(filepath: string) {
	if (!fs.existsSync(filepath)) {
		return;
	}

	// Validate path security
	validateConfigFilePath(filepath);

	// Validate file security (type, size)
	validateConfigFileSecurityInternal(filepath);

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
		const configPath = argv[idx + 1];
		// Validate the provided path
		validateConfigFilePath(configPath);
		return configPath;
	}
	if (process.env.NEST_CONFIG_FILE) {
		// Validate the environment variable path
		validateConfigFilePath(process.env.NEST_CONFIG_FILE);
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
	PLUGINS_DIR: str({default: 'plugins'}),
	LOG_FILE_PATH: str({default: 'logs/nest.log'}),
	MAX_LOG_FILE_SIZE_BYTES: num({default: 1024 * 1024}), // 1MB in bytes
	API_KEY_HEADER: str({default: 'x-api-key'}),
	API_KEY: str({default: ''}),
	ALLOWED_IPS: str({default: '127.0.0.1, ::1'}), // Loopback addresses by default for IPv4 and IPv6
	// When Nest runs behind a reverse proxy, the real client address only
	// reaches us through `X-Forwarded-For`. Trusting that header is dangerous
	// unless the immediate peer really is our proxy, so it stays disabled by
	// default and the allowlist matches the socket address. Set TRUST_PROXY to
	// enable it: `true` trusts every peer (rarely correct), a number sets the
	// number of proxy hops to trust, or a comma-separated list of CIDR/entries
	// restricts which peers may supply the header.
	TRUST_PROXY: str({default: 'false'}),
	RATE_LIMIT_WINDOW_MS: num({default: 60_000}), // 60 seconds
	RATE_LIMIT_MAX: num({default: 120}), // 120 requests per window
	// The admin UI is always mounted, but it is protected by its own credential
	// and is only usable once ADMIN_UI_PASSWORD is set. Without a password every
	// admin route renders a "not configured" page, and startup prints a warning.
	// It is deliberately separate from API_KEY: holding the monitoring key must
	// never be enough to rewrite the config file.
	ADMIN_UI_PASSWORD: str({default: ''}),
	ADMIN_SESSION_TTL_SECONDS: num({default: 900}), // 15 minutes
	// Login is the only unauthenticated write endpoint, so it gets a much tighter
	// bucket than RATE_LIMIT_MAX.
	ADMIN_LOGIN_RATE_LIMIT_MAX: num({default: 5}),
});
