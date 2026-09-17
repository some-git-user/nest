#!/usr/bin/env bash

# Lightweight honeypot E2E: proves the core goal — a wrong-URL HTTP request is
# recorded with the caller's REAL IP. No nmap, no scan matrix, runs in seconds.
# (The full nmap scan matrix lives in check_honeypot_nmap.test.sh and is an
# opt-in local/manual test via `npm run test:e2e:nmap`.)

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PORT="${NEST_E2E_PORT:-55443}"
HOST="127.0.0.1"
BASE_URL="https://${HOST}:${PORT}"
# The server enforces that config files live under the project root (or
# /etc/nest) and TLS material under a certs/ directory. A plain /tmp scratch
# dir is rejected by those validators, so the E2E workspace is created under
# the repo's certs/ tree, which satisfies both, and removed on exit.
# certs/ is gitignored and absent in clean checkouts (e.g. CI), and mktemp
# does not create parent directories, so ensure it exists first.
mkdir -p "${ROOT_DIR%/}/certs"
TMP_DIR=$(mktemp -d "${ROOT_DIR%/}/certs/e2e.XXXXXX")
SERVER_LOG="$TMP_DIR/server.log"
SERVER_PID=""

cleanup() {
	if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
		kill "$SERVER_PID" 2>/dev/null || true
		wait "$SERVER_PID" 2>/dev/null || true
	fi
	rm -rf "$TMP_DIR"
}

trap cleanup EXIT

pick_free_port() {
	local preferred_port="$1"
	node -e '
		const net = require("net");
		const preferred = Number(process.argv[1]);

		const printAndClose = (server) => {
			const address = server.address();
			if (!address || typeof address === "string") {
				process.exit(1);
			}
			console.log(String(address.port));
			server.close(() => process.exit(0));
		};

		const fallbackAnyPort = () => {
			const server = net.createServer();
			server.unref();
			server.on("error", () => process.exit(1));
			server.listen(0, "127.0.0.1", () => printAndClose(server));
		};

		const preferredServer = net.createServer();
		preferredServer.unref();
		preferredServer.on("error", (err) => {
			if (err && err.code === "EADDRINUSE") {
				fallbackAnyPort();
				return;
			}
			process.exit(1);
		});
		preferredServer.listen(preferred, "127.0.0.1", () => printAndClose(preferredServer));
	' "$preferred_port"
}

for cmd in curl jq node npm; do
	if ! command -v "$cmd" >/dev/null 2>&1; then
		echo "SKIP: required command '$cmd' is not installed"
		exit 0
	fi
done

cd "$ROOT_DIR"

if [[ ! -f dist/server.js ]]; then
	echo "Building app for E2E test..."
	npm run build >/dev/null
fi

start_server() {
	local requested_port="$PORT"
	local selected_port
	selected_port=$(pick_free_port "$requested_port")
	if [[ -z "$selected_port" ]]; then
		echo "FAIL: could not determine a free local port for E2E server"
		exit 1
	fi

	PORT="$selected_port"
	BASE_URL="https://${HOST}:${PORT}"

	: >"$SERVER_LOG"
	HOST="$HOST" \
	PORT="$PORT" \
	NODE_ENV=development \
	NEST_CONFIG_FILE="$TMP_DIR/nonexistent-e2e.conf" \
	PLUGINS_DIR="plugins" \
	LOG_FILE_PATH="$TMP_DIR/nest.log" \
	TLS_CERT_PATH="$TMP_DIR/nest-cert.pem" \
	TLS_KEY_PATH="$TMP_DIR/nest-key.pem" \
	node dist/server.js >"$SERVER_LOG" 2>&1 &
	SERVER_PID=$!

	# If the new server exits immediately (e.g., EADDRINUSE), fail fast
	# instead of accidentally probing a stale process already bound to the port.
	sleep 0.2
	if ! kill -0 "$SERVER_PID" 2>/dev/null; then
		echo "FAIL: test server process exited during startup (pid=$SERVER_PID)"
		echo "Hint: ensure test port ${PORT} is free before running E2E."
		echo "--- server log ---"
		cat "$SERVER_LOG"
		exit 1
	fi

	for _ in $(seq 1 60); do
		if ! kill -0 "$SERVER_PID" 2>/dev/null; then
			echo "FAIL: test server process exited before becoming ready (pid=$SERVER_PID)"
			echo "Hint: ensure test port ${PORT} is free before running E2E."
			echo "--- server log ---"
			cat "$SERVER_LOG"
			exit 1
		fi

		if curl -sk --max-time 2 "$BASE_URL/nagios/honey-pot" >/dev/null 2>&1; then
			break
		fi
		sleep 0.5
	done

	if ! curl -sk --max-time 2 "$BASE_URL/nagios/honey-pot" >/dev/null 2>&1; then
		echo "FAIL: server did not become ready"
		echo "--- server log ---"
		cat "$SERVER_LOG"
		exit 1
	fi
}

stop_server() {
	if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
		kill "$SERVER_PID" 2>/dev/null || true
		wait "$SERVER_PID" 2>/dev/null || true
	fi
	SERVER_PID=""
}

# Deterministic real-IP proof.
#
# Raw port scans can close the socket before Node reads the peer address, so
# their attribution is best-effort. A full HTTP request to an unknown path
# always completes the handshake, so the honeypot must record the caller's
# real address. This is the assertion that proves the "log the attacker by
# IP" goal actually works end to end.
echo "=== HTTP wrong-URL real-IP check ==="
start_server

local_before=$(curl -sk --max-time 5 "$BASE_URL/nagios/honey-pot")
before_code=$(echo "$local_before" | jq -r '.code')
if [[ "$before_code" != "0" ]]; then
	echo "FAIL: expected baseline honeypot code=0 before HTTP probe, got code=$before_code"
	echo "$local_before"
	stop_server
	exit 1
fi

# A request for a path that does not exist is recorded as an unknown-route
# honeypot signal carrying the caller IP.
curl -sk --max-time 5 "$BASE_URL/definitely-not-a-real-path-$$" >/dev/null 2>&1
sleep 1

after_message=$(curl -sk --max-time 5 "$BASE_URL/nagios/honey-pot" | jq -r '.message')
http_ip=$(echo "$after_message" | sed -n 's/.* ip=\([^ ]*\).*/\1/p')

echo "Honeypot message: $after_message"
if [[ "$http_ip" != "$HOST" ]]; then
	echo "FAIL: HTTP wrong-URL probe recorded ip=${http_ip:-empty}, expected the real caller ${HOST}"
	stop_server
	exit 1
fi
echo "PASS: HTTP wrong-URL probe attributed the caller to ${http_ip}"
stop_server
