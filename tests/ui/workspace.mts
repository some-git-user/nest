import {type ChildProcess, spawn} from 'child_process';
import {createHash} from 'crypto';
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'fs';
import {createServer} from 'net';
import path from 'path';

/**
 * Test workspace for the Playwright UI suite.
 *
 * The server scans its plugin directory, verifies hashes and executes every
 * whitelisted plugin at module-load time, and exports nothing — so a test
 * process cannot import the app and can only ever see one PLUGINS_DIR. The
 * whole suite therefore runs against a spawned `dist/server.js` pointed at a
 * throwaway fixture tree.
 *
 * Everything is copied into a scratch directory rather than used in place:
 * the admin editor writes `configs/local-presets.conf`, and the fixtures are
 * tracked inputs that must never be mutated.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * The config-file and TLS path validators only accept paths under the project
 * root (or /etc/nest), and the TLS validator additionally requires a `certs`
 * directory. A plain /tmp scratch dir is rejected by both, so the workspace
 * lives under the repo's gitignored `certs/` tree — the same trick
 * `scripts/check_honeypot_realip.test.sh` uses. `certs/` is absent in a clean
 * checkout, hence the explicit mkdir.
 */
const WORKSPACE_ROOT = path.join(REPO_ROOT, 'certs');

const FIXTURE_PLUGINS = path.join(REPO_ROOT, 'tests/ui/fixtures/plugins');
const FIXTURE_CONFIGS = path.join(REPO_ROOT, 'tests/ui/fixtures/configs');

export const ADMIN_PASSWORD = 'e2e-ui-admin-secret';
export const API_KEY = 'e2e-ui-api-key';

/**
 * The port the UI test server binds to.
 *
 * Fixed rather than dynamically allocated because Playwright reads
 * `use.baseURL` when it loads the config, which happens *before*
 * globalSetup runs — a port discovered at runtime could not be published to
 * the specs. Override with `NEST_UI_E2E_PORT` when the default is taken;
 * `assertPortFree` fails fast rather than silently binding elsewhere.
 */
export const UI_TEST_PORT = Number(process.env.NEST_UI_E2E_PORT ?? 5599);

export const UI_TEST_BASE_URL = `https://127.0.0.1:${String(UI_TEST_PORT)}`;

/**
 * A second fixed port for the rare spec that needs a server configured
 * differently from the suite default — e.g. one with no `ADMIN_UI_PASSWORD`,
 * which renders a page the primary server can never show.
 *
 * A separate process rather than a runtime toggle because the admin password is
 * read once at startup into module state.
 */
export const UI_TEST_SECONDARY_PORT = UI_TEST_PORT + 1;
export const UI_TEST_SECONDARY_BASE_URL = `https://127.0.0.1:${String(UI_TEST_SECONDARY_PORT)}`;

export type UiTestWorkspace = {
	dir: string;
	pluginsDir: string;
	port: number;
	baseUrl: string;
	logPath: string;
	serverLogFile: string;
	pid: number;
	stop: () => Promise<void>;
};

/**
 * Where the running workspace is recorded so `globalTeardown` can find it.
 *
 * globalSetup and globalTeardown are not guaranteed to share module state, so
 * the handoff goes through a file rather than a module-level variable. It also
 * makes an orphaned workspace recoverable: a crashed run leaves the record
 * behind, and the next setup cleans up after it.
 */
export const WORKSPACE_STATE_FILE = path.join(
	WORKSPACE_ROOT,
	'e2e-ui-state.json',
);

export type WorkspaceState = {
	dir: string;
	pid: number;
	port: number;
};

const isPidAlive = (pid: number): boolean => {
	try {
		// Signal 0 performs the existence/permission check without killing.
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as {code?: string}).code;
		// EPERM means the process exists but belongs to another user.
		return code === 'EPERM';
	}
};

/**
 * Tear down a recorded workspace.
 *
 * Safe to call with a stale record: a dead PID is skipped and the directory is
 * removed regardless.
 *
 * The process is reaped *before* the directory is deleted. Removing it while
 * the server still runs races the log writes and fails with ENOTEMPTY, which
 * would otherwise leave scratch trees behind on every run.
 */
export const stopWorkspace = async (state: WorkspaceState): Promise<void> => {
	if (isPidAlive(state.pid)) {
		try {
			process.kill(state.pid, 'SIGTERM');
		} catch {
			// Exited between the check and the kill.
		}
		await waitForExit(state.pid, 5_000);
	}
	rmSync(state.dir, {recursive: true, force: true});
};

const waitForExit = async (pid: number, timeoutMs: number): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isPidAlive(pid)) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	// Still alive after SIGTERM (a stuck close() handler): force it, or the
	// scratch directory can never be reclaimed.
	try {
		process.kill(pid, 'SIGKILL');
	} catch {
		// Already gone.
	}
	await new Promise((resolve) => setTimeout(resolve, 200));
};

const sha256 = (filePath: string): string =>
	createHash('sha256').update(readFileSync(filePath, 'utf8')).digest('hex');

/**
 * Fail fast if the fixed test port is already taken.
 *
 * Better to refuse to run than to bind somewhere else and have the specs
 * probe a stale server from an earlier run, which produces assertions that
 * are wrong in a very confusing way.
 */
const assertPortFree = (port: number): Promise<void> =>
	new Promise((resolve, reject) => {
		const listener = createServer();
		listener.unref();
		listener.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'EADDRINUSE') {
				reject(
					new Error(
						`Port ${String(port)} is already in use. Free it or set NEST_UI_E2E_PORT to another port.`,
					),
				);
				return;
			}
			reject(error);
		});
		listener.listen(port, '127.0.0.1', () => {
			listener.close(() => resolve());
		});
	});

const copyPluginFixtures = (targetPluginsDir: string): string[] => {
	mkdirSync(targetPluginsDir, {recursive: true});
	const files = readdirSync(FIXTURE_PLUGINS).filter(
		(name) => name.endsWith('.ts') && !name.includes('.test.'),
	);
	for (const file of files) {
		copyFileSync(
			path.join(FIXTURE_PLUGINS, file),
			path.join(targetPluginsDir, file),
		);
	}
	return files;
};

/**
 * Write the trust whitelist for the fixture tree.
 *
 * A plugin whose sha256 is absent is skipped **silently** — no route, no
 * error, just a missing entry in the overview. That failure mode is miserable
 * to debug from a browser, so the whitelist is generated here from the bytes
 * that were actually copied rather than maintained by hand.
 *
 * Mode 0600 and current-user ownership are both mandatory: the loader refuses
 * to trust *any* entry when the whitelist is group/other-writable or owned by
 * someone else.
 */
const writeWhitelist = (pluginsDir: string, pluginFiles: string[]): void => {
	const lines = [
		'# Generated by the Playwright UI test harness — do not edit by hand.',
		'# filename sha256',
	];
	for (const file of pluginFiles) {
		lines.push(`${file} ${sha256(path.join(pluginsDir, file))}`);
	}
	lines.push(
		`configs/local-presets.conf ${sha256(path.join(pluginsDir, 'configs', 'local-presets.conf'))}`,
	);

	const whitelistPath = path.join(pluginsDir, 'plugin-whitelist.txt');
	// writeFile's mode is masked by umask; set it explicitly like the server does.
	writeFileSync(whitelistPath, `${lines.join('\n')}\n`);
	chmodSync(whitelistPath, 0o600);
};

/**
 * Poll until the listener answers, or the child dies.
 *
 * `/nagios/honey-pot` is used because it is mounted early, needs no API key
 * from loopback, and returns Nagios JSON for every outcome — so any HTTP
 * status below 500 proves the listener is up and the middleware chain is live.
 */
const waitForReady = async (
	baseUrl: string,
	serverProcess: ChildProcess,
	serverLogFile: string,
	timeoutMs = 30_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	const probeUrl = `${baseUrl}/nagios/honey-pot`;

	// The certificate is self-signed, so the probe cannot verify it. Scoped to
	// the readiness poll and restored afterwards rather than left off for the
	// whole test process.
	const previousTlsPolicy = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

	try {
		while (Date.now() < deadline) {
			if (serverProcess.exitCode !== null) {
				throw new Error(
					`Test server exited during startup (code ${String(serverProcess.exitCode)}).\n--- server log ---\n${readFileSync(serverLogFile, 'utf8')}`,
				);
			}
			try {
				const response = await fetch(probeUrl, {
					headers: {'x-api-key': API_KEY},
					signal: AbortSignal.timeout(2_000),
				});
				if (response.status < 500) {
					return;
				}
			} catch {
				// Not listening yet, or the handshake was refused — keep polling.
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}

		throw new Error(
			`Test server did not become ready within ${String(timeoutMs)} ms.\n--- server log ---\n${readFileSync(serverLogFile, 'utf8')}`,
		);
	} finally {
		if (previousTlsPolicy === undefined) {
			delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
		} else {
			process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsPolicy;
		}
	}
};

/**
 * Build the scratch workspace and boot a real server against it.
 *
 * Returns the workspace plus a `stop` callback. The caller owns the process
 * for the whole test run: the admin session cookie is signed with a
 * per-process ephemeral secret, so restarting the server mid-suite would
 * invalidate every session at once.
 */
export type StartOptions = {
	/** Port to bind. Defaults to the suite-wide `UI_TEST_PORT`. */
	port?: number;
	/**
	 * `ADMIN_UI_PASSWORD` for the server. Pass an empty string to exercise the
	 * "admin UI is not configured" page. Defaults to `ADMIN_PASSWORD`.
	 */
	adminPassword?: string;
	/**
	 * Whether to record the workspace in the state file so `globalTeardown`
	 * reaps it. True for the primary suite server; a short-lived secondary
	 * server a spec starts and stops itself should pass false, so it never
	 * clobbers the primary record.
	 */
	recordState?: boolean;
};

export const startUiTestServer = async (
	options: StartOptions = {},
): Promise<UiTestWorkspace> => {
	const {
		port = UI_TEST_PORT,
		adminPassword = ADMIN_PASSWORD,
		recordState = true,
	} = options;

	const serverEntry = path.join(REPO_ROOT, 'dist', 'server.js');
	if (!existsSync(serverEntry)) {
		throw new Error(
			'dist/server.js is missing. Run `npm run build` before the UI tests.',
		);
	}

	mkdirSync(WORKSPACE_ROOT, {recursive: true});

	// A previous run that crashed leaves its workspace behind. Clean it up before
	// creating a new one so repeated failures do not accumulate scratch trees.
	// Only the primary server owns the state file; a secondary server must not
	// touch it or it would erase the primary's teardown record.
	if (recordState && existsSync(WORKSPACE_STATE_FILE)) {
		try {
			await stopWorkspace(
				JSON.parse(
					readFileSync(WORKSPACE_STATE_FILE, 'utf8'),
				) as WorkspaceState,
			);
		} catch {
			// Unreadable record: drop it and carry on.
		}
		rmSync(WORKSPACE_STATE_FILE, {force: true});
	}

	const dir = path.join(
		WORKSPACE_ROOT,
		`e2e-ui-${String(process.pid)}-${String(port)}`,
	);
	const pluginsDir = path.join(dir, 'plugins');
	const configsDir = path.join(pluginsDir, 'configs');
	const serverLogFile = path.join(dir, 'server.log');
	const logPath = path.join(dir, 'nest.log');

	mkdirSync(configsDir, {recursive: true});
	const pluginFiles = copyPluginFixtures(pluginsDir);
	cpSync(FIXTURE_CONFIGS, configsDir, {recursive: true});
	// cpSync preserves the source mode, and a group-writable config file is
	// rejected by the loader's Unix permission check — the presets would be
	// silently untrusted and the Local Config Presets section would never render.
	chmodSync(path.join(configsDir, 'local-presets.conf'), 0o600);
	writeWhitelist(pluginsDir, pluginFiles);

	const baseUrl = `https://127.0.0.1:${String(port)}`;
	await assertPortFree(port);

	// Capture the child's stdout/stderr: without this a boot failure is silent
	// and the only clue is a timeout.
	const logFd = openSync(serverLogFile, 'a');

	const serverProcess = spawn(process.execPath, [serverEntry], {
		cwd: REPO_ROOT,
		stdio: ['ignore', logFd, logFd],
		env: {
			...process.env,
			// development skips the production uid/ownership checks on config
			// and whitelist files, which a scratch dir cannot satisfy.
			NODE_ENV: 'development',
			HOST: '127.0.0.1',
			PORT: String(port),
			PLUGINS_DIR: pluginsDir,
			NEST_CONFIG_FILE: path.join(dir, 'absent-e2e-ui.conf'),
			TLS_CERT_PATH: path.join(dir, 'nest-cert.pem'),
			TLS_KEY_PATH: path.join(dir, 'nest-key.pem'),
			LOG_FILE_PATH: logPath,
			API_KEY,
			ADMIN_UI_PASSWORD: adminPassword,
			// The defaults (120 requests/min, 5 logins/window) are exhausted by
			// a single page load of scripts plus API calls, which surfaces as
			// flaky 429s that look like application bugs.
			RATE_LIMIT_WINDOW_MS: '60000',
			RATE_LIMIT_MAX: '100000',
			ADMIN_LOGIN_RATE_LIMIT_MAX: '1000',
		},
	});

	try {
		await waitForReady(baseUrl, serverProcess, serverLogFile);
	} catch (error) {
		serverProcess.kill('SIGTERM');
		throw error;
	}

	const state: WorkspaceState = {
		dir,
		pid: serverProcess.pid ?? -1,
		port,
	};
	if (recordState) {
		writeFileSync(WORKSPACE_STATE_FILE, `${JSON.stringify(state)}\n`);
	}

	return {
		dir,
		pluginsDir,
		port,
		baseUrl,
		logPath,
		serverLogFile,
		pid: state.pid,
		stop: async () => {
			await stopWorkspace(state);
		},
	};
};
