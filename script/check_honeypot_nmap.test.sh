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

cleanup() {
	if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
		kill "$SERVER_PID" 2>/dev/null || true
		wait "$SERVER_PID" 2>/dev/null || true
	fi
	rm -rf "$TMP_DIR"
}

trap cleanup EXIT

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

# If running as root via sudo, return ownership of dist/ to the original user
# so subsequent non-root runs can clean and rebuild without permission errors.
if [[ "$(id -u)" == "0" && -n "${SUDO_USER:-}" ]]; then
	chown -R "$SUDO_USER:" dist/
fi

start_server() {
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

	for _ in $(seq 1 60); do
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

	echo ""
	echo "=== Scan case: ${name} ==="
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
	nmap $args -p "$PORT" "$HOST" >"$nmap_out" 2>&1
	local nmap_status=$?
	set -e

	if [[ $nmap_status -ne 0 ]]; then
		if grep -Eqi 'requires root|operation not permitted|socket type not supported|failed to determine route|is not permitted' "$nmap_out"; then
			echo "SKIP: ${name} (unsupported in current environment)"
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
		echo "DETECTED: ${name} -> code=${after_code}, port_scan_ips=${port_scan_ips}, protocol_errors=${protocol_errors}"
		DETECTED_SCANS+=("$name")
	else
		echo "UNDETECTED: ${name} -> code=${after_code}, port_scan_ips=${port_scan_ips}, protocol_errors=${protocol_errors}"
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
