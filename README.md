# Nagios REST Server

![logo](favicon.ico)

Nest is a Node.js/Express HTTPS server that exposes Nagios-compatible checks and dynamically loads plugin-based checks at startup.

Unlike many traditional Nagios setups centered on Bash/Python/Ruby scripts, this project is built around TypeScript/JavaScript plugins so teams can use modern tooling, shared libraries, typing, and test workflows in one ecosystem.

## Why This Exists

Most Nagios plugin stacks grow as mixed shell scripts that are hard to type-check, test, and reuse.

Nest gives you a TypeScript-first monitoring runtime where checks are HTTP-addressable plugins with a strict Nagios output contract.

Use this project when your platform/services already run on Node.js and you want monitoring logic to follow the same engineering standards as application code.

## Table of Contents

- [Features](#features)
- [Why TypeScript for Nagios Checks](#why-typescript-for-nagios-checks)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Quick Start](#quick-start)
- [Build Targets](#build-targets)
- [Configuration](#configuration)
- [HTTP API](#http-api)
- [Plugin Development](#plugin-development)
- [Testing and Quality](#testing-and-quality)
- [Nmap Honeypot E2E](#nmap-honeypot-e2e)
- [Release Process (.deb)](#release-process-deb)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Features

- HTTPS-only server with automatic self-signed certificate generation when missing.
- Nagios-compatible payloads: `message`, `code`, optional `performanceData`.
- Dynamic plugin loading from a filesystem directory.
- Runtime TypeScript plugin transpilation and cache reuse.
- Unified language stack for service logic and checks (TypeScript/JavaScript end to end).
- Honeypot and probe detection endpoint with Nagios reporting.
- Shell-friendly checks via `script/check_nest.sh`.

## Why TypeScript for Nagios Checks

- Strong typing helps prevent fragile monitoring logic and parameter mistakes.
- Reuse existing Node.js libraries instead of reimplementing logic in shell scripts.
- Better testing ergonomics (Jest), linting, formatting, and CI integration.
- Easier onboarding for teams already shipping TypeScript services.
- Keeps plugin implementation and application runtime in a single ecosystem.

## Architecture at a Glance

- Core app routes are mounted in `src/server.ts`.
- Dynamic plugins are discovered from `PLUGINS_DIR` and mounted as routes.
- Unknown routes are recorded as honeypot signals and return Nagios UNKNOWN.
- TLS/client protocol errors are also tracked as probe signals.

## Quick Start

### Development

```bash
npm install
npm run dev
```

### Production (compiled)

```bash
npm install
npm run build
npm start
```

Default listen address is `https://localhost:5000` unless overridden by config.

## Build Targets

### Standalone executable

```bash
npm run build:release
```

Output is produced in `standalone/`.

### Debian package

```bash
npm run build:deb
```

Package artifacts are generated in `build_deb/`.

## Configuration

Configuration is loaded in this order:

1. `--configPath <file>` CLI argument
2. `NEST_CONFIG_FILE` environment variable
3. `/etc/nest/nest.conf` when `NODE_ENV=production`
4. `.env` in current working directory (development fallback)

Main variables:

- `NODE_ENV` (default: `development`)
- `HOST` (default: `localhost`)
- `PORT` (default: `5000`)
- `TLS_CERT_PATH` (default: `certs/nest-cert.pem`)
- `TLS_KEY_PATH` (default: `certs/nest-key.pem`)
- `TLS_CERT_COMMON_NAME` (default: `localhost`)
- `TLS_CERT_DAYS` (default: `365`)
- `PLUGINS_DIR` (default: `plugins`)
- `LOG_FILE_PATH` (default: `logs/nest.log`)
- `MAX_LOG_FILE_SIZE_BYTES` (default: `1048576`)

## HTTP API

### Built-in routes

| Method | Path                     | Purpose                                                  |
| ------ | ------------------------ | -------------------------------------------------------- |
| `GET`  | `/nagios`                | Built-in app metrics check                               |
| `GET`  | `/nagios/honey-pot`      | Honeypot/probe status in Nagios format                   |
| `ALL`  | `/nagios/honey-pot/trip` | Intentional honeypot trip endpoint (returns 404 UNKNOWN) |
| `GET`  | `/favicon.ico`           | Returns HTTP 204                                         |

### Dynamic routes

| Method | Path                      | Purpose                            |
| ------ | ------------------------- | ---------------------------------- |
| `GET`  | `/plugins/<plugin-route>` | Executes a discovered plugin check |

### Fallback behavior

- Unknown routes return HTTP 404 with Nagios UNKNOWN payload (`code=3`).
- Unknown-route hits are recorded as honeypot signals.

## Plugin Development

At startup, the server scans `PLUGINS_DIR` and registers routes dynamically.

Supported plugin files:

- `.ts`
- `.js`

Ignored plugin files:

- `*.test.ts`
- `*.spec.ts`
- `*.test.js`
- `*.spec.js`
- `*.d.ts`

Route path generation:

- Plugin basename is converted to lowercase kebab-case.
- Dynamic routes are always namespaced under `/plugins`.
- Example: `check_debian_eol.ts` -> `/plugins/check-debian-eol`
- Filenames must remain unique after normalization (for example, `check_test.ts` and `check-test.ts` would conflict).

### TypeScript plugin handling

- `.ts` plugins are transpiled at runtime.
- Transpiled output is cached at `PLUGINS_DIR/plugin-cache/`.
- Cache reuse is based on source and cache mtime.

### JavaScript plugin handling

- `.js` plugins are loaded directly.
- If both `foo.ts` and `foo.js` exist, `foo.ts` takes precedence.

### Plugin contract

A plugin function should return:

```ts
{
  message: string;
  code: 0 | 1 | 2 | 3;
  performanceData?: PerformanceData | PerformanceData[];
}
```

### Optional plugin metadata

Plugins may export `meta.usage`:

```ts
export const meta = {
	usage: {
		http: '/plugins/check-test?nagiosReturnMessage=<string>&nagiosReturnValue=<0|1|2|3>&performanceData=<true|false>',
		shell:
			'./check_nest.sh check-test nagiosReturnMessage=<string> nagiosReturnValue=<0|1|2|3> performanceData=<true|false>',
	},
};
```

### Example plugin

Create `plugins/check_custom.ts`:

```ts
export const meta = {
	usage: {
		http: '/plugins/check-custom?value=<number>',
		shell: './check_nest.sh check-custom value=<number>',
	},
};

export const checkCustom = async (params: {value?: string}) => {
	const value = Number(params.value ?? '0');

	if (Number.isNaN(value)) {
		return {message: 'value must be a number', code: 3};
	}

	if (value > 90) {
		return {message: `value=${value} is critical`, code: 2};
	}

	return {message: `value=${value} is ok`, code: 0};
};
```

Call it with:

```bash
curl -k "https://localhost:5000/plugins/check-custom?value=42"
```

## Testing and Quality

### Core checks

```bash
npm run lint:check
npx tsc --noEmit
npm run test:coverage
```

### Useful scripts

| Script                  | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `npm run test:ci`       | Jest in CI mode (`--runInBand`)             |
| `npm run test:shell`    | Shell script tests                          |
| `npm run test:e2e:nmap` | Honeypot nmap matrix E2E                    |
| `npm run validate`      | Lint, format check, type check, build, test |

### Nagios shell check script

```bash
./script/check_nest.sh check-test nagiosReturnMessage=test nagiosReturnValue=0 performanceData=true
```

Environment variables for `check_nest.sh`:

- `NEST_SCHEME` (default: `https`)
- `NEST_HOST` (default: `localhost`)
- `NEST_PORT` (default: `5000`)
- `NEST_TLS_INSECURE` (default: `true`)
- `NEST_CA_CERT` (optional path to CA cert)

Notes:

- Canonical parameter is `nagiosReturnValue`.
- The legacy typo `nagiosRetunValue` is not supported.
- Script requires `jq`.

## Nmap Honeypot E2E

```bash
npm run test:e2e:nmap
```

The suite runs a matrix of 8 nmap scan types and reports DETECTED, UNDETECTED, and SKIPPED.

Expected detection model:

- Detected at app layer: `-sT`, `-sV`
- Typically not detected at app layer: `-sS`, `-sA`, `-sF`, `-sX`, `-sN`, `-sU`

Reason: raw-socket and kernel-level scans can avoid full TCP accept/HTTP parsing, so Node.js TLS/client error hooks do not always fire.

Run with elevated privileges (for raw-socket scans):

```bash
sudo env PATH="$PATH" NEST_E2E_STRICT=false npm run test:e2e:nmap
```

Alternative (one-time capability grant):

```bash
sudo setcap cap_net_raw+ep $(which nmap)
npm run test:e2e:nmap
sudo setcap -r $(which nmap)
```

E2E environment variables:

- `NEST_E2E_PORT` (default `55443`)
- `NEST_E2E_STRICT` (default `true`; set `false` for report-only)

## Release Process (.deb)

Release is triggered manually via GitHub Actions workflow dispatch.

Input:

- `tag` (required, semantic format like `v1.2.3`)

Workflow behavior:

- Builds `.deb` artifact.
- Generates release body from commit messages.
- Also enables GitHub generated release notes.
- Uploads `build_deb/nest-deb.deb` as release asset.

## Troubleshooting

- Plugin not visible:
  - Verify extension is `.ts` or `.js`.
  - Ensure filename does not match ignored test/spec patterns.
  - Restart service after adding plugin.
- TS plugin not loading:
  - Check startup logs for transpilation warnings.
  - Verify write access to plugin cache directory.
- Route mismatch:
  - Confirm expected route is basename-to-kebab-case conversion.
- E2E permissions after running as root:
  - If local artifacts become root-owned, fix with `sudo chown -R "$USER":"$USER" dist`.

## Support

- Open an issue in the repository issue tracker.
- For operational incidents, include:
  - route called
  - full Nagios payload returned
  - relevant server log excerpt

## Security

- Do not expose this service publicly without a reverse proxy, access control, and TLS trust strategy.
- Honeypot and protocol-error detection is application-layer telemetry. It does not replace host/network IDS.
- Report security issues privately to repository maintainers before opening a public issue.

## Contributing

Contributions are welcome. For a clean change:

1. Create a branch.
2. Run `npm run validate` locally.
3. Add or update tests for behavior changes.
4. Open a pull request with a concise summary and risk notes.

## License

MIT
