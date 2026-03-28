# Nagios REST Server

![logo](favicon.ico)

Nest is a Node.js/Express-based Nagios REST server with a dynamic plugin system.

Core idea:

- Build and ship the server binary/package first.
- Add or update plugins later by dropping `.ts` or `.js` files into the plugin directory.
- Restart the service to load new plugins.

## What This Project Is Optimized For

- Dynamic plugin loading at runtime.
- User-provided plugins after deployment.
- Nagios-compatible response format (`message`, `code`, optional `performanceData`).
- Shell-friendly checks via `script/check_nest.sh`.

## Quick Start

### Development

```bash
npm install
npm run dev
```

### Production (compiled server)

```bash
npm install
npm run build
npm start
```

Default listen address is `https://localhost:5000` unless overridden in config.

The server is HTTPS-only. If TLS files do not exist at startup, a self-signed
certificate and key are generated automatically.

## Build Targets

### Standalone executable

```bash
npm install
npm run build:release
```

Output is produced in `standalone/`.

### Debian package

```bash
npm run build:deb
```

Package artifacts are generated under `build_deb/`.

## Configuration

Configuration is loaded in this order:

1. `--configPath <file>` CLI argument
2. `NEST_CONFIG_FILE` environment variable
3. `/etc/nest/nest.conf` when `NODE_ENV=production`
4. `.env` in the current working directory (development fallback)

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

## Dynamic Plugin Lifecycle

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

- Plugin file basename is converted to lowercase kebab-case.
- Example: `check_debian_eol.ts` -> `/check-debian-eol`

### TypeScript plugin handling

- `.ts` plugins are transpiled at runtime.
- Transpiled output is cached under `PLUGINS_DIR/plugin-cache/`.
- Example default cache path: `plugins/plugin-cache/`
- Cache reuse is based on source and cache `mtime`.

### JavaScript plugin handling

- `.js` plugins are loaded directly without transpilation.
- If both `foo.ts` and `foo.js` exist, `foo.ts` takes precedence and `foo.js` is skipped.

## Plugin Contract

A plugin must export a function that returns an object compatible with Nagios output semantics.

Expected return shape:

```ts
{
   message: string;
   code: 0 | 1 | 2 | 3;
   performanceData?: PerformanceData | PerformanceData[];
}
```

### Optional metadata (recommended)

Plugins may export `meta.usage` so startup logs can show usage guidance.

```ts
export const meta = {
	usage: {
		http: '/check-test?nagiosReturnMessage=<string>&nagiosReturnValue=<0 | 1 | 2 | 3>&performanceData=<true | false>',
		shell:
			'./check_nest.sh check-test nagiosReturnMessage=<string> nagiosReturnValue=<0 | 1 | 2 | 3> performanceData=<true | false>',
	},
};
```

## Example Plugin

Create `plugins/check_custom.ts`:

```ts
export const meta = {
	usage: {
		http: '/check-custom?value=<number>',
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

Restart the service, then call:

```bash
curl -k "https://localhost:5000/check-custom?value=42"
```

## Nagios Shell Check Script

Use `script/check_nest.sh` to execute checks from Nagios-compatible shell workflows.

```bash
./script/check_nest.sh check-test nagiosReturnMessage=test nagiosReturnValue=0 performanceData=true
```

TLS-related environment variables for `check_nest.sh`:

- `NEST_SCHEME` (default: `https`)
- `NEST_HOST` (default: `localhost`)
- `NEST_PORT` (default: `5000`)
- `NEST_TLS_INSECURE` (default: `true`)
- `NEST_CA_CERT` (optional path to CA cert; when set, `--cacert` is used)

If your goal is encryption only and issuer trust is not required, keep
`NEST_TLS_INSECURE=true` (default).

Notes:

- Canonical parameter is `nagiosReturnValue`.
- The legacy typo `nagiosRetunValue` is not supported.
- Script requires `jq`.

## HTTP Routes

- `GET /nagios` -> built-in app metrics check
- `GET /<plugin-route>` -> dynamic plugin route
- Unknown routes return Nagios UNKNOWN (`code=3`) payload with 404 status

## Testing and Quality Checks

```bash
npm run lint:check
npx tsc --noEmit
npm run test:coverage
```

### Nmap E2E Honeypot Test

```bash
npm run test:e2e:nmap
```

The script runs a matrix of 8 nmap scan types against the running app and reports which ones the application layer can and cannot detect:

| Scan            | nmap flag | Detected | Reason                                                     |
| --------------- | --------- | -------- | ---------------------------------------------------------- |
| tcp-connect     | `-sT`     | ✅ Yes   | Full TCP handshake completes — TLS error fires             |
| service-version | `-sV`     | ✅ Yes   | Many connections with banner probing — multiple TLS errors |
| syn-scan        | `-sS`     | ❌ No    | SYN→RST at kernel level, handshake never completes         |
| ack-scan        | `-sA`     | ❌ No    | ACK with no session → kernel RST, app not involved         |
| fin-scan        | `-sF`     | ❌ No    | Malformed flags handled by kernel, app never woken         |
| xmas-scan       | `-sX`     | ❌ No    | Same as FIN — kernel-level only                            |
| null-scan       | `-sN`     | ❌ No    | No TCP flags → kernel drops/RSTs silently                  |
| udp-scan        | `-sU`     | ❌ No    | UDP to a TCP port → ICMP reply from kernel, not app        |

The undetected scans operate below the TCP accept layer. Node.js `clientError`/`tlsClientError` events only fire after the three-way handshake completes. Detecting raw-socket scans requires a kernel-level tool (eBPF, nftables logging, Snort/Suricata).

What each test cycle does:

1. Builds the app (`dist/server.js`).
2. Starts the HTTPS server on a temporary port.
3. Verifies baseline `/nagios/honey-pot` status is OK.
4. Runs the nmap scan.
5. Re-checks `/nagios/honey-pot` and classifies as DETECTED / UNDETECTED / SKIPPED.

**Running with root privileges** (required for raw-socket scans: `-sS`, `-sA`, `-sF`, `-sX`, `-sN`, `-sU`):

```bash
sudo env PATH="$PATH" NEST_E2E_STRICT=false npm run test:e2e:nmap
```

`sudo` resets `PATH` by default, so `env PATH="$PATH"` is needed to keep `npm` and `node` accessible.

Alternatively, grant `nmap` the raw-socket capability once:

```bash
sudo setcap cap_net_raw+ep $(which nmap)
# then run normally without sudo:
npm run test:e2e:nmap
# to remove later:
sudo setcap -r $(which nmap)
```

Environment variables:

- `NEST_E2E_PORT` — override the test port (default `55443`).
- `NEST_E2E_STRICT` — set to `false` for report-only mode (default `true`, fails if any scan is undetected).

`npm run test:coverage` runs the Jest suite with coverage and then executes the
shell tests.

## Troubleshooting

- Plugin not visible:
  - Verify file extension is `.ts` or `.js`.
  - Ensure filename does not match ignored test/spec patterns.
  - Restart service after adding plugin.
- TS plugin not loading:
  - Check startup logs for transpilation warnings.
  - Verify write access to the plugin cache directory.
- Route mismatch:
  - Confirm expected route is basename converted to kebab-case.

## License

MIT
