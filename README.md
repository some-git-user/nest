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

| Variable                     | Default               | Description                                |
| ---------------------------- | --------------------- | ------------------------------------------ |
| `NODE_ENV`                   | `development`         | `development` or `production`              |
| `HOST`                       | `localhost`           | Network interface to bind                  |
| `PORT`                       | `5000`                | HTTPS server port                          |
| `TLS_CERT_PATH`              | `certs/nest-cert.pem` | TLS certificate file                       |
| `TLS_KEY_PATH`               | `certs/nest-key.pem`  | TLS private key file                       |
| `PLUGINS_DIR`                | `plugins`             | Plugin directory                           |
| `LOG_FILE_PATH`              | `logs/nest.log`       | Log file path                              |
| `MAX_LOG_FILE_SIZE_BYTES`    | `1048576`             | Log rotation size (1MB)                    |
| `API_KEY_HEADER`             | `x-api-key`           | API key header name                        |
| `API_KEY`                    | (empty)               | API key for authentication                 |
| `ALLOWED_IPS`                | `127.0.0.1, ::1`      | Comma-separated allowed IPs or `*` for all |
| `TRUST_PROXY`                | `false`               | Honour `X-Forwarded-For` (see note below)  |
| `RATE_LIMIT_WINDOW_MS`       | `60000`               | Rate limit window (ms)                     |
| `RATE_LIMIT_MAX`             | `120`                 | Max requests per window                    |
| `ADMIN_UI_PASSWORD`          | (empty)               | Password for the `/admin` config editor    |
| `ADMIN_SESSION_TTL_SECONDS`  | `900`                 | Admin session cookie lifetime (s)          |
| `ADMIN_LOGIN_RATE_LIMIT_MAX` | `5`                   | Max admin login attempts per window        |

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
test_perfdata=check-test nagiosReturnMessage=Test+message nagiosReturnValue=0 performanceData=true
debian_eol_warning=check-debian-eol warningEolRemainingDays=90 criticalEolRemainingDays=30
```

See `plugins/configs/local-presets.conf.example` for setup instructions and security considerations.

### Admin UI (Local Config Editor)

`/admin` is a web editor for `plugins/configs/local-presets.conf`. It is always
mounted, and protected by `ADMIN_UI_PASSWORD` in addition to the global API key:
holding the monitoring key alone can never rewrite the config file. Without a
password every admin route renders a "not configured" help page and startup
prints a warning.

Saving never touches `plugins/plugin-whitelist.txt`. The presets in memory stay
the whitelist-approved ones, the edited file waits on disk, and a persistent
drift banner shows the exact `configs/local-presets.conf <sha256>` line to add
to the whitelist plus a restart. "Revert to approved" restores the bytes
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

### Plugin whitelist

Nest maintains plugin integrity via `<PLUGINS_DIR>/plugin-whitelist.txt`:

```text
check_test.ts 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

On startup, missing or changed plugins are skipped until whitelisted. The whitelist file is auto-created with secure permissions (`0600`).

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
```

## Shell Script Usage

```bash
./scripts/check_nest.sh check-test nagiosReturnMessage=test nagiosReturnValue=0
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

## License

MIT
