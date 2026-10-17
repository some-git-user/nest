import path from 'path';
import {CONFIG_FILE_PATH, env} from '../config/env';
import {getErrorMessage} from '../lib/error-message';
import {runPluginsHash} from './plugins-hash';

/**
 * Minimal argv-based command dispatcher for the `nest` binary.
 *
 * Returns `true` when a CLI command was handled (the caller must then NOT start
 * the HTTP server), or `false` for a normal server start. Kept dependency-free
 * so it runs before the server module loads.
 */
const printUsage = (log: (line: string) => void): void => {
	log('nest — Nagios Rest Server');
	log('');
	log('Usage:');
	log('  nest                       Start the HTTP server.');
	log(
		'  nest plugins hash          Recompute plugin manifest hashes and the config hash.',
	);
	log('');
	log('Run "nest plugins hash" after editing a plugin (updates its sidecar');
	log(
		'manifest) or the local config presets (updates LOCAL_CONFIG_HASH in the',
	);
	log(
		'config file). In a packaged install these are root-owned, so run it with sudo.',
	);
};

const KNOWN_COMMANDS = new Set(['plugins', 'help', '--help', '-h']);

// A script path passed to node/tsx, in any JS or TS flavour. Commands (`plugins`,
// `help`, `--help`, `-h`) never match, so stripping these is unambiguous.
const SCRIPT_PATH = /\.[cm]?[jt]sx?$/;

/**
 * Reduce `process.argv` to just the command tokens.
 *
 * The offset differs between a packaged SEA binary (`argv = [execPath, ...args]`)
 * and development (`argv = [node, script, ...args]`). Drop the leading executable
 * and, when present, a leading script path. The script extension varies by how the
 * server is launched — compiled `.js` (`node dist/server.js`) or on-the-fly `.ts`
 * (`tsx src/server-preload.ts` under nodemon) — so match any JS/TS extension, not
 * just `.js`. What remains are the command tokens, or flags such as `--configPath`
 * that belong to the server rather than the CLI.
 */
const commandTokens = (argv: string[]): string[] => {
	const tokens = argv.slice(1);
	if (tokens.length > 0 && SCRIPT_PATH.test(tokens[0])) {
		return tokens.slice(1);
	}

	return tokens;
};

export const runCli = (
	argv: string[],
	log: (line: string) => void = (line) => console.log(line),
): boolean => {
	const args = commandTokens(argv);
	if (args.length === 0) {
		return false;
	}

	const [command, subcommand] = args;

	// A leading flag (e.g. `--configPath`) is a server option, not a CLI
	// command: let the server start and parse it.
	if (command.startsWith('-') && !KNOWN_COMMANDS.has(command)) {
		return false;
	}

	if (command === 'plugins') {
		if (subcommand === 'hash') {
			const pluginsDir = path.resolve(process.cwd(), env.PLUGINS_DIR);
			log(`Recomputing plugin hashes in ${pluginsDir}`);
			try {
				const result = runPluginsHash(pluginsDir, CONFIG_FILE_PATH);
				for (const warning of result.warnings) {
					log(`! ${warning}`);
				}

				for (const update of result.manifests) {
					if (update.status === 'updated') {
						log(`~ ${update.name} (manifest updated)`);
					} else if (update.status === 'unhashed') {
						log(`- ${update.name} (no hash declared, left as-is)`);
					}
				}

				if (result.configHash) {
					if (result.configHash.status === 'updated') {
						log('~ LOCAL_CONFIG_HASH (config updated)');
					} else if (result.configHash.status === 'added') {
						log('+ LOCAL_CONFIG_HASH (config added)');
					}
				}

				if (result.changes === 0) {
					log('All hashes already up to date.');
				} else {
					log(`${result.changes} plugin(s) updated. Restart nest to apply.`);
				}
			} catch (err) {
				log(
					`Failed to update plugin hashes: ${getErrorMessage(err)}. Are you running as root?`,
				);
				process.exitCode = 1;
			}

			return true;
		}

		log(`Unknown "nest plugins" subcommand: ${subcommand ?? ''}`);
		printUsage(log);
		process.exitCode = 1;
		return true;
	}

	if (command === 'help' || command === '--help' || command === '-h') {
		printUsage(log);
		return true;
	}

	log(`Unknown command: ${command}`);
	printUsage(log);
	process.exitCode = 1;
	return true;
};
