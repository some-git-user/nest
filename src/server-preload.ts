// Preload entry point: sets up ssh2 interception before server loads
import {runCli} from './cli/dispatch.js';
import {setupSsh2Interception} from './preload/ssh2-preload.js';

setupSsh2Interception();

// A CLI subcommand (e.g. `nest plugins hash`) runs instead of starting the
// server. runCli returns true when it handled a command, so we stop here.
if (runCli(process.argv)) {
	process.exit(process.exitCode ?? 0);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./server');
