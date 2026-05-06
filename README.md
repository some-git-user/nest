# Nagios REST Server

![logo](favicon.ico)

Nest is a Node.js/Express HTTPS server that exposes Nagios-compatible checks and dynamically loads plugin-based checks at startup.

<p align=center>
	<img width="1071" height="1373" alt="image" src="https://github.com/user-attachments/assets/9116cd6d-2426-45f7-aa2e-8fc08434b211" />
</p>

## Why This Exists

Unlike many traditional Nagios setups centered on Bash/Python/Ruby scripts, this project is built around TypeScript/JavaScript plugins so teams can use modern tooling, shared libraries, typing, and test workflows in one ecosystem.

Nest gives you a TypeScript-first monitoring runtime where checks are HTTP-addressable plugins with a strict Nagios output contract.

## Table of Contents

- [Features](#features)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Quick Start](#quick-start)
- [Build Targets](#build-targets)
- [Configuration](#configuration)
- [HTTP API](#http-api)
- [Plugin Development](#plugin-development)
- [Testing and Quality](#testing-and-quality)
- [Nmap Honeypot E2E](#nmap-honeypot-e2e)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [Security](#security)
- [License](#license)

## Features

- HTTPS-only server with automatic self-signed certificate generation when missing.
- Root overview page (`/`) with built-in routes, plugin routes, and help links.
- Nagios-compatible payloads: `message`, `code`, optional `performanceData`.
- Dynamic plugin loading from a filesystem directory.
- Runtime TypeScript plugin transpilation and cache reuse.
- Unified language stack for service logic and checks (TypeScript/JavaScript end to end).
- Built-in and plugin help pages via `?help`.
- External-link warning guard on help pages before leaving app origin.
- Shell-friendly checks via `script/check_nest.sh`.

## Why TypeScript for Nagios Checks

- Strong typing helps prevent fragile monitoring logic and parameter mistakes.
- Reuse existing Node.js libraries instead of reimplementing logic in shell scripts.
- Better testing ergonomics (Jest), linting, formatting, and CI integration.
- Keeps plugin implementation and application runtime in a single ecosystem.

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
- `ENABLE_SECURITY_MIDDLEWARE` (default: `true`)
- `API_KEY_HEADER` (default: `x-api-key`)
- `API_KEY` (default: empty, disabled)
- `ALLOWED_IPS` (default: `127.0.0.1, ::1`; comma-separated exact IPs)
- `PLUGIN_WHITELIST_PATH` (default: empty; when unset, Nest uses `<PLUGINS_DIR>/plugin-whitelist.txt`)
- `RATE_LIMIT_WINDOW_MS` (default: `60000`)
- `RATE_LIMIT_MAX` (default: `120`)

## HTTP API

### Built-in routes

| Method | Path                           | Purpose                                                            |
| ------ | ------------------------------ | ------------------------------------------------------------------ |
| `GET`  | `/`                            | Root overview page (routes + help links)                           |
| `GET`  | `/nagios`                      | Built-in app metrics check                                         |
| `GET`  | `/nagios/honey-pot`            | Honeypot/probe status in Nagios format                             |
| `GET`  | `/favicon.ico`                 | Returns `204 No Content` to suppress default browser favicon noise |
| `GET`  | `/help/external-link-guard.js` | Script used by help pages to warn before opening external links    |
| `GET`  | `/help/startup-warnings/<id>`  | Dedicated help page for a specific startup warning topic           |

### Dynamic routes

| Method | Path                      | Purpose                            |
| ------ | ------------------------- | ---------------------------------- |
| `GET`  | `/plugins/<plugin-route>` | Executes a discovered plugin check |

### Help pages and docs UX

- Root overview page: `GET /`
  - Lists built-in routes and plugin routes.
  - Includes direct `help` links.
- Built-in help pages:
  - `GET /nagios?help`
  - `GET /nagios/honey-pot?help`
- Plugin help pages:
  - `GET /plugins/<plugin-route>?help`

All help pages include an external-link warning. When a user clicks a link to a different origin, the UI asks for confirmation before navigating away.

### Fallback behavior

- Unknown routes return HTTP 404 with Nagios UNKNOWN payload (`code=3`).
- Unknown-route hits are recorded as honeypot signals.

## Plugin Development

At startup, the server scans `PLUGINS_DIR` and registers routes dynamically.

Supported plugin files:

- `.ts`
- `.js`

Production safety checks:

- In `NODE_ENV=production`, plugin files are loaded only when file owner uid matches the service process uid.
- Plugin files must not be writable by group or others.
- Insecure plugin files are skipped and logged.
- In `NODE_ENV=production`, the config file is validated with the same ownership and permission rules at startup. A bad config file causes a hard start failure.
- On every startup, Nest hashes each effective plugin file and compares it with the trusted hash recorded in the plugin whitelist file. New or changed plugins are not registered until they are explicitly whitelisted.

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

Plugins may also export `meta.help` with extended HTML documentation:

```ts
export const meta = {
	usage: {
		http: '/plugins/check-custom?value=<number>',
		shell: './check_nest.sh check-custom value=<number>',
	},
	help: `<h1>check-custom</h1><p>Extended setup guide...</p>`,
};
```

Notes on `meta.help`:

- If `meta.help` is a full HTML document (`<!DOCTYPE ...>` / `<html ...>`), it is sandboxed inside an `<iframe srcdoc>` with `sandbox="allow-popups"` to isolate scripts and forms.
- If it is an HTML fragment, it is sanitized with `sanitize-html` (event-handler attributes and unsafe URI schemes removed) and rendered in a minimal help-page shell.
- If `meta.help` is missing, Nest generates a fallback help page from `meta.usage`.
- All help pages set a strict Content Security Policy and include the external-link warning guard.

### Plugin whitelist file

By default, Nest reads the plugin trust allowlist from `<PLUGINS_DIR>/plugin-whitelist.txt`.

Each non-comment line must contain a filename and a SHA-256 hash, in either of these forms:

```text
check_test.ts 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef check_test.ts
```

Startup behavior:

- If the whitelist file is missing, Nest creates it automatically with restrictive permissions (`0600`).
- New plugins that are missing from the whitelist are skipped.
- Existing plugins whose contents changed since the last approved hash are skipped.
- The whitelist file itself is validated with the same Unix ownership/permission gate (`validateUnixFileSecurity`): it must be owned by the service uid and must not be group/other writable.
- Each skipped plugin produces a startup warning in the logs and on the route overview page.
- In the route overview page, each warning includes a direct link to a dedicated warning help page with handling instructions.
- After review, add or update the plugin's hash in the whitelist file and restart the server.

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

The test suite includes security-focused tests that cover:

- XSS and event-handler injection in `meta.help` HTML fragments.
- HTML injection via plugin metadata fields (`pluginName`, `usageHttp`, `usageShell`).
- Access control bypass attempts (key prefix/substring, case, forwarded-for spoofing, IPv4-mapped IPv6).
- File ownership and permission edge cases for plugin and config file validation.
- Startup plugin whitelist enforcement for new and changed plugin hashes.
- Adversarial IP normalization inputs.

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
- `NEST_API_KEY` (optional API key sent as request header)
- `NEST_API_KEY_HEADER` (default: `x-api-key`)

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

- This service includes baseline application-layer protections, but public exposure still requires a reverse proxy, strong access control, trusted TLS, and network-level restrictions.
- Honeypot and protocol-error detection is application-layer telemetry. It does not replace host/network IDS.

Built-in application controls:

- Helmet security headers.
- Basic IP + API-key access control middleware.
- Request rate limiting.
- Production plugin file ownership/permission validation in the dynamic loader.
- Production config file ownership/permission validation at startup.
- Help-page Content Security Policy headers (`default-src 'none'`, locked `script-src`, `frame-ancestors 'none'`).
- Help-page HTML sanitization via `sanitize-html` (blocks XSS, event-handler attributes, unsafe URI schemes).
- Full-doc plugin help pages (`<!DOCTYPE>`/`<html>`) rendered in a sandboxed `<iframe>` with `allow-popups` only.
- External-link warning guard on all help pages before leaving app origin.

By default, `ALLOWED_IPS` is restricted to loopback addresses `127.0.0.1` and `::1`. Add your monitoring source addresses explicitly when the service must accept remote checks.

At startup in production, the app logs warnings when recommended security settings are missing or weak, including:

- `ENABLE_SECURITY_MIDDLEWARE=false`
- missing `API_KEY`
- empty `ALLOWED_IPS`
- non-positive rate-limit settings

## License

MIT
