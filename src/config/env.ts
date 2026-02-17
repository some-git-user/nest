import {EnvError, cleanEnv, host, makeValidator, num, port, str} from 'envalid';
import * as fs from 'fs';
import * as path from 'path';

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
	return path.resolve(process.cwd(), '.env');
}

loadEnvFile(getConfigPath());

const nonEmptyStrValidator = makeValidator<string>((input: string) => {
	const trimmedInput = input.trim();
	if (trimmedInput !== '') {
		return trimmedInput;
	} else {
		throw new EnvError(`Not a non-empty string: "${input}"`);
	}
});

const nonEmptyStr = nonEmptyStrValidator();

export const strList = makeValidator<Array<string>>((input: string) => {
	const validateList = (input: string | Array<string>): Array<string> => {
		if (Array.isArray(input)) {
			return input.map(nonEmptyStr._parse);
		} else {
			const inputArray = input.split(/,\s*/).filter((str) => str !== '');
			return validateList(inputArray);
		}
	};

	try {
		return validateList(input);
	} catch {
		throw new EnvError(`Not a (list of) valid string(s): "${input}"`);
	}
});

export const env = cleanEnv(process.env, {
	NODE_ENV: str({default: 'production'}),
	HOST: host({default: 'localhost'}),
	PORT: port({default: 5000}),
	PLUGINS_DIR: str({default: 'plugins'}),
	LOG_FILE_PATH: str({default: 'logs/nest.log'}),
	MAX_LOG_FILE_SIZE: num({default: 1024 * 1024}), // 1MB in bytes
});
