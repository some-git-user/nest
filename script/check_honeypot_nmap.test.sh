#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PORT="${NEST_E2E_PORT:-55443}"
HOST="127.0.0.1"
BASE_URL="https://${HOST}:${PORT}"
TMP_DIR=$(mktemp -d)
SERVER_LOG="$TMP_DIR/server.log"
SERVER_PID=""
STRICT_MODE="${NEST_E2E_STRICT:-true}"
NMAP_TIMEOUT_SECONDS="${NEST_E2E_NMAP_TIMEOUT_SECONDS:-600}" # 10 minutes, based on empirical nmap runtime observations with -sV --version-intensity 9

SCAN_CASES=(
	"tcp-connect|-sT -Pn -T4"
	"service-version|-sV --version-intensity 9 -Pn -T4"
	"syn-scan|-sS -Pn -T4"
	"ack-scan|-sA -Pn -T4"
	"fin-scan|-sF -Pn -T4"
	"xmas-scan|-sX -Pn -T4"
	"null-scan|-sN -Pn -T4"
	"udp-scan|-sU -Pn --max-retries 1 --host-timeout 15s"
)

declare -a DETECTED_SCANS=()
declare -a UNDETECTED_SCANS=()
declare -a SKIPPED_SCANS=()

print_runtime_expectations() {
	local scan_count="${#SCAN_CASES[@]}"
	local max_scan_seconds=$((scan_count * NMAP_TIMEOUT_SECONDS))
	local max_scan_minutes=$(((max_scan_seconds + 59) / 60))

	echo "INFO: nmap E2E can be long-running; this is expected."
	echo "INFO: service-version uses '-sV --version-intensity 9' and may take up to ${NMAP_TIMEOUT_SECONDS}s before timeout/skip."
	echo "INFO: scan phase worst-case budget is about ${max_scan_seconds}s (~${max_scan_minutes} min), plus server start/wait overhead."

	if ! command -v timeout >/dev/null 2>&1; then
		echo "WARN: 'timeout' command not found; long scans are unbounded and can take several additional minutes."
	fi
}

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

if ! command -v nmap >/dev/null 2>&1; then
	echo "SKIP: nmap is not installed"
	exit 0
fi

cd "$ROOT_DIR"

echo "Building app for E2E test..."
npm run build >/dev/null
print_runtime_expectations

# If running as root via sudo, return ownership of dist/ to the original user
# so subsequent non-root runs can clean and rebuild without permission errors.
if [[ "$(id -u)" == "0" && -n "${SUDO_USER:-}" ]]; then
	chown -R "$SUDO_USER:" dist/
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
	if [[ "$PORT" != "$requested_port" ]]; then
		echo "Requested port ${requested_port} is busy; using free port ${PORT}."
	fi

	: >"$SERVER_LOG"
	echo "Starting server for scan run..."
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

extract_counter_from_message() {
	local message="$1"
	local key="$2"
	echo "$message" | sed -n "s/.*${key}=\([0-9][0-9]*\).*/\1/p"
}

run_scan_case() {
	local name="$1"
	local args="$2"
	local nmap_out="$TMP_DIR/nmap-${name}.out"
	local scan_started_at
	scan_started_at=$(date +%s)

	echo ""
	echo "=== Scan case: ${name} ==="
	echo "Started at: $(date -Iseconds)"
	start_server

	local before
	local before_code
	before=$(curl -sk --max-time 5 "$BASE_URL/nagios/honey-pot")
	before_code=$(echo "$before" | jq -r '.code')
	if [[ "$before_code" != "0" ]]; then
		echo "FAIL: expected baseline honeypot code=0 before '${name}', got code=$before_code"
		echo "$before"
		stop_server
		exit 1
	fi

	set +e
	echo "Running nmap (${name}): nmap ${args} -p ${PORT} ${HOST}"
	local nmap_status=0
	if command -v timeout >/dev/null 2>&1; then
		timeout "${NMAP_TIMEOUT_SECONDS}s" nmap $args -p "$PORT" "$HOST" >"$nmap_out" 2>&1
		nmap_status=$?
	else
		nmap $args -p "$PORT" "$HOST" >"$nmap_out" 2>&1
		nmap_status=$?
	fi
	set -e

	if [[ $nmap_status -ne 0 ]]; then
		if [[ $nmap_status -eq 124 ]]; then
			local scan_finished_at
			local scan_elapsed_seconds
			scan_finished_at=$(date +%s)
			scan_elapsed_seconds=$((scan_finished_at - scan_started_at))
			echo "SKIP: ${name} (nmap timed out after ${NMAP_TIMEOUT_SECONDS}s)"
			echo "Elapsed: ${scan_elapsed_seconds}s"
			SKIPPED_SCANS+=("$name")
			stop_server
			return
		fi

		if grep -Eqi 'requires root|operation not permitted|socket type not supported|failed to determine route|is not permitted' "$nmap_out"; then
			local scan_finished_at
			local scan_elapsed_seconds
			scan_finished_at=$(date +%s)
			scan_elapsed_seconds=$((scan_finished_at - scan_started_at))
			echo "SKIP: ${name} (unsupported in current environment)"
			echo "Elapsed: ${scan_elapsed_seconds}s"
			SKIPPED_SCANS+=("$name")
			stop_server
			return
		fi

		echo "FAIL: nmap case '${name}' failed unexpectedly"
		cat "$nmap_out"
		stop_server
		exit 1
	fi

	sleep 1

	local after
	local after_code
	local after_message
	after=$(curl -sk --max-time 5 "$BASE_URL/nagios/honey-pot")
	after_code=$(echo "$after" | jq -r '.code')
	after_message=$(echo "$after" | jq -r '.message')

	local port_scan_ips
	local protocol_errors
	port_scan_ips=$(extract_counter_from_message "$after_message" "port_scan_ips")
	protocol_errors=$(extract_counter_from_message "$after_message" "protocol_errors")

	port_scan_ips=${port_scan_ips:-0}
	protocol_errors=${protocol_errors:-0}

	if [[ "$after_code" != "0" && ( "$port_scan_ips" -gt 0 || "$protocol_errors" -gt 0 ) ]]; then
		local scan_finished_at
		local scan_elapsed_seconds
		scan_finished_at=$(date +%s)
		scan_elapsed_seconds=$((scan_finished_at - scan_started_at))
		echo "DETECTED: ${name} -> code=${after_code}, port_scan_ips=${port_scan_ips}, protocol_errors=${protocol_errors}"
		echo "Elapsed: ${scan_elapsed_seconds}s"
		DETECTED_SCANS+=("$name")
	else
		local scan_finished_at
		local scan_elapsed_seconds
		scan_finished_at=$(date +%s)
		scan_elapsed_seconds=$((scan_finished_at - scan_started_at))
		echo "UNDETECTED: ${name} -> code=${after_code}, port_scan_ips=${port_scan_ips}, protocol_errors=${protocol_errors}"
		echo "Elapsed: ${scan_elapsed_seconds}s"
		UNDETECTED_SCANS+=("$name")
	fi

	stop_server
}

for entry in "${SCAN_CASES[@]}"; do
	name=${entry%%|*}
	args=${entry#*|}
	run_scan_case "$name" "$args"
done

echo ""
echo "=== Nmap Honeypot E2E Summary ==="
echo "Detected scans (${#DETECTED_SCANS[@]}): ${DETECTED_SCANS[*]:-none}"
echo "Undetected scans (${#UNDETECTED_SCANS[@]}): ${UNDETECTED_SCANS[*]:-none}"
echo "Skipped scans (${#SKIPPED_SCANS[@]}): ${SKIPPED_SCANS[*]:-none}"

if [[ ${#UNDETECTED_SCANS[@]} -gt 0 && "$STRICT_MODE" == "true" ]]; then
	echo "FAIL: some scans were not detected. Set NEST_E2E_STRICT=false to report-only mode."
	exit 1
fi

echo "PASS: nmap matrix completed"
