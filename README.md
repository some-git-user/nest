# Nest - Nagios REST Server

![logo](favicon.ico)

Nest is a Node.js/Express HTTPS server that exposes Nagios-compatible checks with dynamic plugin support.

## Why This Exists

Unlike traditional Nagios setups built on Bash/Python/Ruby scripts, Nest uses TypeScript plugins so teams can leverage modern tooling, shared libraries, strong typing, and Jest tests in a single ecosystem.

## Quick Start

```bash
npm install
npm run dev
```

Default: `https://localhost:5000`

## Build

```bash
npm run build        # Compile TypeScript
npm run build:release  # Standalone executable (standalone/)
npm run build:deb    # Debian packages (build_deb/)
```

## Configuration

Create `.env` from `.env.example`:

| Variable                          | Default               | Description                                                  |
| --------------------------------- | --------------------- | ------------------------------------------------------------ |
| `NODE_ENV`                        | `development`         | `development` or `production`                                |
| `HOST`                            | `localhost`           | Network interface to bind                                    |
| `PORT`                            | `5000`                | HTTPS server port                                            |
| `TLS_CERT_PATH`                   | `certs/nest-cert.pem` | TLS certificate file                                         |
| `TLS_KEY_PATH`                    | `certs/nest-key.pem`  | TLS private key file                                         |
| `PLUGINS_DIR`                     | `plugins`             | Plugin directory                                             |
| `LOG_FILE_PATH`                   | `logs/nest.log`       | Log file path                                                |
| `MAX_LOG_FILE_SIZE_BYTES`         | `1048576`             | Log rotation size (1MB)                                      |
| `API_KEY_HEADER`                  | `x-api-key`           | API key header name                                          |
| `API_KEY`                         | (empty)               | API key for authentication                                   |
| `ALLOWED_IPS`                     | `127.0.0.1, ::1`      | Comma-separated allowed IPs or `*` for all                   |
| `TRUST_PROXY`                     | `false`               | Honour `X-Forwarded-For` (see note below)                    |
| `RATE_LIMIT_WINDOW_MS`            | `60000`               | Rate limit window (ms)                                       |
| `RATE_LIMIT_MAX`                  | `120`                 | Max requests per window                                      |
| `ADMIN_UI_PASSWORD`               | (empty)               | Password for the `/admin` config editor                      |
| `ADMIN_SESSION_TTL_SECONDS`       | `900`                 | Admin session cookie lifetime (s)                            |
| `ADMIN_LOGIN_RATE_LIMIT_MAX`      | `5`                   | Max admin login attempts per window                          |
| `ADMIN_TEST_RATE_LIMIT_MAX`       | `20`                  | Max admin plugin test runs per window                        |
| `UNIFIED_TIMEOUT_MS`              | `15000`               | Per-preset timeout for the `/unified` aggregate check (ms)   |
| `HONEYPOT_IGNORE_LOOPBACK_PROBES` | `true`                | Drop TLS/HTTP protocol errors from loopback (see note below) |

TLS certificates are auto-generated if missing.

Config loading order: `--configPath` > `NEST_CONFIG_FILE` > `/etc/nest/nest.conf` (production) > `.env` (development).

## HTTP API

### Routes

| Method | Path                | Purpose             |
| ------ | ------------------- | ------------------- |
| `GET`  | `/`                 | Route overview      |
| `GET`  | `/nagios`           | App metrics check   |
| `GET`  | `/nagios/honey-pot` | Honeypot status     |
| `GET`  | `/plugins/<name>`   | Plugin check        |
| `POST` | `/local-config`     | Local config preset |
| `GET`  | `/unified`          | Aggregate check     |
| `GET`  | `/admin`            | Admin config editor |

Add `?help` to any route for documentation. Unknown routes return 404 (Nagios code=3).

### Local Config Presets

The `/local-config` endpoint allows executing pre-configured plugin presets stored on the Nest server. This is useful for Nagios servers that want to use server-side config presets instead of passing all parameters in the request.

**Request:**

```bash
curl -X POST https://localhost:5000/local-config \
  -H "Content-Type: application/json" \
  -H "x-api-key: $NEST_API_KEY" \
  -d '{"localConfig": "test_perfdata"}'
```

When `API_KEY` is configured, a `POST` without a valid key header returns `401`. When `API_KEY` is empty (the default), no key is required and access is restricted to `ALLOWED_IPS` instead.

**Response:**

```json
{
	"message": "Test message",
	"code": 0,
	"performanceData": "cpu=50%%"
}
```

**Config File Format:**
Config presets are stored in `plugins/configs/local-presets.conf`:

```
test_perfdata=check-test nagiosReturnMessage="Test message" nagiosReturnValue=0 performanceData=true
debian_eol_warning=check-debian-eol warningEolRemainingDays=90 criticalEolRemainingDays=30
```

A value containing a space is wrapped in double quotes; inside quotes `\"` is a
literal double quote and `\\` a literal backslash. Values without a space are
written bare, so an unchanged preset round-trips byte for byte. A value may not
contain a newline or `#`.

See `plugins/configs/local-presets.conf.example` for setup instructions and security considerations.

### Unified Check

The `/unified` endpoint runs a **set** of checks in one request and returns the
worst status, so many Nagios services collapse into a single check. The built-in
routes `/nagios` (process and host health) and `/nagios/honey-pot` (intrusion
signals) are **always** included; they need no opt-in. Plugin presets join them
when you opt each one in by adding the reserved parameter `nestUnified=true` to
its line (or tick **Include in unified check** in the admin editor):

```
disk_root=check-disk warn=80% crit=90% nestUnified=true
cert_expiry=check-cert-expiry nestUnified=true
```

`nestUnified` is a directive for the aggregator, not a plugin input: it is
stripped before the preset is dialled back into its plugin route, so a plugin
never receives a parameter it did not declare.

**Request:**

```bash
curl -k https://localhost:5000/unified -H "x-api-key: $NEST_API_KEY"
```

**Response** (worst code wins; every non-OK check is listed, OK checks are
counted and still contribute performance data — here the two built-ins and
`cert_expiry` are OK, so only `disk_root` is listed out of four checks):

```json
{
	"message": "NEST UNIFIED: CRITICAL - 1 problem(s) of 4; disk_root: CRITICAL - / at 95%",
	"code": 2,
	"performanceData": "'disk_root'=95%;80;90 'cert_expiry'=42"
}
```

Severity order is `CRITICAL > UNKNOWN > WARNING > OK`. Checks run in parallel,
each capped at `UNIFIED_TIMEOUT_MS` (default 15 s); a check that errors or
exceeds the timeout is reported as `UNKNOWN` rather than stalling the aggregate.

### Admin UI (Local Config Editor)

`/admin` is a web editor for `plugins/configs/local-presets.conf`. It is always
mounted, and protected by `ADMIN_UI_PASSWORD` in addition to the global API key:
holding the monitoring key alone can never rewrite the config file. Without a
password every admin route renders a "not configured" help page and startup
prints a warning.

Saving never changes the approved hash. The presets in memory stay the
approved ones, the edited file waits on disk, and a persistent drift banner
shows the exact `LOCAL_CONFIG_HASH=<sha256>` line to set in the nest config
file plus a restart. "Revert to approved" restores the bytes
captured at startup if the edit was accidental.

## Plugin Development

Plugins are auto-discovered from `PLUGINS_DIR` (`plugins/` by default).

### Supported files

- `.ts` (transpiled at runtime, executed in-memory via vm module)
- `.js` (loaded directly)

Ignored: `*.test.*`, `*.spec.*`, `*.d.ts`

### Route naming

Plugin filename → kebab-case route: `check_debian_eol.ts` → `/plugins/check-debian-eol`

### Plugin contract

```ts
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

Return type: `{message: string, code: 0|1|2|3, performanceData?: object}`

### Optional metadata

```ts
export const meta = {
	usage: {
		http: '/plugins/check-custom?value=<number>',
		shell: './check_nest.sh check-custom value=<number>',
	},
	help: `<h1>check-custom</h1><p>Extended help...</p>`,
};
```

### Plugin trust (sidecar manifests)

Each plugin is trusted by a sidecar manifest sitting next to it:
`check_test.ts` is approved by `check_test.manifest.json`.

```json
{
	"name": "check_test",
	"version": "1.0.0",
	"entry": "check_test.ts",
	"hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

On startup, a plugin with no manifest is refused (fail-secure), and a plugin
whose file no longer matches its manifest `hash` is skipped. When a manifest
declares no `hash`, the plugin still loads but a warning is recorded — the
filesystem ownership/permission checks remain the security boundary there.

Run `nest plugins hash` to (re)compute each plugin's SHA-256 into its manifest
and to refresh the `LOCAL_CONFIG_HASH` line in the nest config file. Because
trust is per-plugin, a third party can drop their own plugin + manifest into
`PLUGINS_DIR` without editing a file the package manager owns.

### Example

Create `plugins/check_custom.ts`:

```ts
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

Call it:

```bash
curl -k -H "x-api-key: your-secret-key" "https://localhost:5000/plugins/check-custom?value=42"
# {"message":"value=42 is ok","code":0}
```

Or with API key in environment:

```bash
export NEST_API_KEY=your-secret-key
curl -k -H "x-api-key: $NEST_API_KEY" "https://localhost:5000/plugins/check-custom?value=42"
```

## Testing

```bash
npm run validate     # Lint, type check, build, test
npm run test:ci      # CI mode
npm run test:shell   # Shell script tests
npm run test:ui      # Playwright browser tests (see below)
```

### Browser (Playwright) UI tests

`npm run test:ui` drives the real Web UI in headless Chromium against a
spawned `dist/server.js`. Run `npm run build` first — the suite deliberately
does not build, so a stale bundle is never tested silently.

This suite is **not a CI job**. It runs as a husky **pre-push** gate
(`.husky/pre-push`), after `npm run validate`: if the browser suite is not
green, the push is aborted and nothing reaches GitHub. Skip it once in a
while with `git push --no-verify` if you know what you are doing.

The suite needs **no root and no host binaries** (`smartctl`, `dmesg`,
`docker`, `nvidia-smi`). It points the server at inert fixture plugins in
`tests/ui/fixtures/plugins/` instead of the real `plugins/` tree, so the
admin "Test" button — which executes a plugin with the server's own API key —
can only ever reach code that cannot touch the host.

What it covers, and why it exists: the three client scripts
(`PLUGIN_EXAMPLE_FORM_SCRIPT`, `ADMIN_CONFIG_SCRIPT`, `THEME_TOGGLE_SCRIPT`)
are template literals that Jest can only match as strings, never execute.
These tests click them for real — the plugin run forms' empty-field filtering,
the admin editor's add/copy/validate/save/revert flow, live duplicate-key
warnings, secret masking, and the theme toggle's cookie persistence.

```bash
npm run test:ui            # headless
npm run test:ui:headed     # watch it run
npm run test:ui:report     # open the HTML report
NEST_UI_E2E_PORT=5700 npm run test:ui   # if 5599 is taken
npx playwright install --with-deps chromium   # once, if system libs are missing
```

The suite runs with a single worker: the admin editor writes one shared config
file on disk, so parallel workers would fight over it.

## Shell Script Usage

```bash
./scripts/check_nest.sh check-test nagiosReturnMessage=test nagiosReturnValue=0
```

Run the aggregate check (built-in routes plus every opted-in preset):

```bash
./scripts/check_nest.sh --unified
```

Environment: `NEST_SCHEME`, `NEST_HOST`, `NEST_PORT`, `NEST_TLS_INSECURE`, `NEST_CA_CERT`, `NEST_API_KEY`, `NEST_API_KEY_HEADER`

## Security

- Helmet headers, IP allowlist, rate limiting
- CSRF guard on state-changing requests: a browser `Origin` that is not this
  server, or `Sec-Fetch-Site: cross-site`, is rejected. curl/Nagios send neither
  header and are unaffected.
- Plugin/config file ownership/permission validation in production
- CSP headers and HTML sanitization on help pages
- Default `ALLOWED_IPS` restricted to loopback only
- `X-Forwarded-For` is ignored by default: the IP allowlist always matches the
  real socket address, so a client cannot spoof its way past `ALLOWED_IPS`.
  Only set `TRUST_PROXY` when Nest runs behind a reverse proxy you control —
  `true` trusts every peer, a number sets the number of proxy hops, or a
  comma-separated list of IPs/CIDRs restricts which peers may supply the header.
- Plugins never build shell command strings. Every child process is started with
  an argv array (`execFile`/`spawn`), and the custom `no-shell-exec` ESLint rule
  bans `exec`/`execSync` and `shell: true` across `src/` and `plugins/`, so the
  rule cannot silently regress.
- The admin UI's "Test" button runs an _approved_ (manifest-trusted) plugin as the
  service user, gated by an admin session, the `x-nest-admin: 1` header, and the
  CSRF guard. Command injection is closed off; per-plugin input validation and
  privilege amplification remain the operator's concern.
- Honeypot protocol errors (`clientError`/`tlsClientError`) from a loopback peer
  are dropped by default (`HONEYPOT_IGNORE_LOOPBACK_PROBES=true`). A browser on
  the same host tears down speculative TLS sockets, and Node reports that the same
  way it reports a scanner, so browsing the admin UI locally would otherwise raise
  false port-scan alerts attributed to the host itself. Set the flag to `false`
  when Nest sits behind a same-host reverse proxy — every external probe then
  arrives from loopback and must still be recorded.

## License

MIT
