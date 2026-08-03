#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TARGET_SCRIPT="$SCRIPT_DIR/check_nest.sh"
TMP_DIR=$(mktemp -d)
FAKE_BIN="$TMP_DIR/bin"

mkdir -p "$FAKE_BIN"

cleanup() {
    rm -rf "$TMP_DIR"
}

trap cleanup EXIT

cat > "$FAKE_BIN/jq" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

input=$(cat)

if [[ "${1:-}" == "-r" ]]; then
    payload="${input#VALID_JSON:}"

    if [[ "$payload" == "$input" ]]; then
        exit 1
    fi

    message="${payload%%|*}"
    rest="${payload#*|}"
    code="${rest%%|*}"
    performance_data="${rest#*|}"

    printf '%s\t%s\t%s\n' "$message" "$code" "$performance_data"
    exit 0
fi

exit 1
EOF

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash

set -euo pipefail

printf '%s\n' "$@" > "$CURL_ARGS_FILE"

if [[ "${MOCK_CURL_MODE:-success}" == "fail" ]]; then
    exit 7
fi

printf '%s\n' "${MOCK_RESPONSE:-VALID_JSON:test|0|load=1;;;;}"
EOF

chmod +x "$FAKE_BIN/jq" "$FAKE_BIN/curl"

assert_equals() {
    local expected="$1"
    local actual="$2"
    local message="$3"

    if [[ "$expected" != "$actual" ]]; then
        printf 'FAIL: %s\nExpected: %s\nActual:   %s\n' "$message" "$expected" "$actual" >&2
        exit 1
    fi
}

assert_contains() {
    local needle="$1"
    local haystack_file="$2"
    local message="$3"

    if ! grep -Fqx -- "$needle" "$haystack_file"; then
        printf 'FAIL: %s\nMissing: %s\n' "$message" "$needle" >&2
        printf 'Captured lines:\n' >&2
        cat "$haystack_file" >&2
        exit 1
    fi
}

assert_not_contains() {
    local needle="$1"
    local haystack_file="$2"
    local message="$3"

    if grep -Fqx -- "$needle" "$haystack_file"; then
        printf 'FAIL: %s\nUnexpected: %s\n' "$message" "$needle" >&2
        printf 'Captured lines:\n' >&2
        cat "$haystack_file" >&2
        exit 1
    fi
}

assert_output_contains() {
    local needle="$1"
    local output="$2"
    local message="$3"

    if ! grep -Fq -- "$needle" <(printf '%s\n' "$output"); then
        printf 'FAIL: %s\nMissing substring: %s\n' "$message" "$needle" >&2
        printf 'Captured output:\n%s\n' "$output" >&2
        exit 1
    fi
}

run_check() {
    local output
    set +e
    output=$(PATH="$FAKE_BIN:$PATH" CURL_ARGS_FILE="$TMP_DIR/curl_args" "$@" 2>&1)
    status=$?
    set -e
    RUN_OUTPUT="$output"
    RUN_STATUS="$status"
}

run_check "$TARGET_SCRIPT"
assert_output_contains "Usage:" "$RUN_OUTPUT" "prints usage when no args are provided"
assert_output_contains "Environment variables:" "$RUN_OUTPUT" "includes environment variable help section"
assert_equals "1" "$RUN_STATUS" "returns error status when no command is provided"

run_check "$TARGET_SCRIPT" --help
assert_output_contains "Examples:" "$RUN_OUTPUT" "prints examples in help output"
assert_equals "1" "$RUN_STATUS" "returns status 1 for explicit help"

run_check env MOCK_RESPONSE="VALID_JSON:test|0|load=1;;;;" "$TARGET_SCRIPT" check-test nagiosReturnMessage=test nagiosReturnValue=0 performanceData=true code=3
assert_equals "test | code=0 load=1;;;;" "$RUN_OUTPUT" "formats Nagios output with perfdata"
assert_equals "0" "$RUN_STATUS" "exits with the plugin code"
assert_contains "nagiosReturnValue=0" "$TMP_DIR/curl_args" "passes canonical nagiosReturnValue"
assert_contains "--insecure" "$TMP_DIR/curl_args" "uses insecure TLS mode by default"
assert_contains "https://localhost:5000/plugins/check-test" "$TMP_DIR/curl_args" "uses HTTPS endpoint by default"

run_check env MOCK_RESPONSE="VALID_JSON:warning|2|" "$TARGET_SCRIPT" check-test nagiosReturnMessage=warning nagiosReturnValue=2
assert_equals "warning | code=2" "$RUN_OUTPUT" "omits perfdata when absent"
assert_equals "2" "$RUN_STATUS" "returns non-zero Nagios status"

run_check env MOCK_RESPONSE="VALID_JSON:nagios|0|" "$TARGET_SCRIPT" nagios
assert_equals "nagios | code=0" "$RUN_OUTPUT" "supports plugin command route"
assert_equals "0" "$RUN_STATUS" "returns success for plugin command route"
assert_contains "https://localhost:5000/plugins/nagios" "$TMP_DIR/curl_args" "maps bare command names to /plugins/<command>"

run_check env MOCK_RESPONSE="VALID_JSON:honey-pot|0|" "$TARGET_SCRIPT" /nagios/honey-pot
assert_equals "honey-pot | code=0" "$RUN_OUTPUT" "supports explicit absolute route paths"
assert_equals "0" "$RUN_STATUS" "returns success for explicit absolute route paths"
assert_contains "https://localhost:5000/nagios/honey-pot" "$TMP_DIR/curl_args" "keeps explicit absolute route path without plugin prefix"

run_check env MOCK_RESPONSE="VALID_JSON:honey-pot-rel|0|" "$TARGET_SCRIPT" nagios/honey-pot
assert_equals "honey-pot-rel | code=0" "$RUN_OUTPUT" "supports relative route paths containing slash"
assert_equals "0" "$RUN_STATUS" "returns success for relative route paths containing slash"
assert_contains "https://localhost:5000/nagios/honey-pot" "$TMP_DIR/curl_args" "maps slash-containing command names to route paths"
run_check env NEST_SCHEME=http MOCK_RESPONSE="VALID_JSON:ok|0|" "$TARGET_SCRIPT" check-test nagiosReturnMessage=ok nagiosReturnValue=0
assert_equals "ok | code=0" "$RUN_OUTPUT" "supports plain HTTP when explicitly configured"
assert_equals "0" "$RUN_STATUS" "returns success status for http override"
assert_not_contains "--insecure" "$TMP_DIR/curl_args" "does not set insecure flag for HTTP"
assert_contains "http://localhost:5000/plugins/check-test" "$TMP_DIR/curl_args" "uses configured scheme endpoint when overridden"

run_check env NEST_API_KEY="secret-token" NEST_API_KEY_HEADER="x-custom-key" MOCK_RESPONSE="VALID_JSON:secured|0|" "$TARGET_SCRIPT" check-test nagiosReturnMessage=secured nagiosReturnValue=0
assert_equals "secured | code=0" "$RUN_OUTPUT" "supports API key secured checks"
assert_equals "0" "$RUN_STATUS" "returns success for API key secured checks"
assert_contains "-H" "$TMP_DIR/curl_args" "adds curl header flag when API key is configured"
assert_contains "x-custom-key: secret-token" "$TMP_DIR/curl_args" "uses configured API key header and value"

run_check env MOCK_RESPONSE="VALID_JSON:inline|0|" "$TARGET_SCRIPT" NEST_HOST=192.168.111.40 NEST_API_KEY=inline-secret check-test nagiosReturnMessage=inline nagiosReturnValue=0
assert_equals "inline | code=0" "$RUN_OUTPUT" "supports inline leading NEST_* assignments"
assert_equals "0" "$RUN_STATUS" "returns success for inline leading NEST_* assignments"
assert_contains "https://192.168.111.40:5000/plugins/check-test" "$TMP_DIR/curl_args" "uses inline NEST_HOST value"
assert_contains "x-api-key: inline-secret" "$TMP_DIR/curl_args" "uses inline NEST_API_KEY value"

run_check "$TARGET_SCRIPT" NEST_UNKNOWN=value check-test nagiosReturnMessage=test nagiosReturnValue=0
assert_equals "Error: Unsupported inline variable 'NEST_UNKNOWN'." "$RUN_OUTPUT" "rejects unsupported inline variable names"
assert_equals "1" "$RUN_STATUS" "returns error for unsupported inline variable names"

run_check env MOCK_RESPONSE="VALID_JSON:no-key|0|" "$TARGET_SCRIPT" check-test nagiosReturnMessage=no-key nagiosReturnValue=0
assert_not_contains "x-api-key:" "$TMP_DIR/curl_args" "does not send API key header by default"

run_check env MOCK_RESPONSE="not-json" "$TARGET_SCRIPT" check-test nagiosReturnMessage=test nagiosReturnValue=0
assert_equals "Error: Received invalid JSON response." "$RUN_OUTPUT" "reports invalid JSON"
assert_equals "3" "$RUN_STATUS" "maps invalid JSON to UNKNOWN"

run_check env MOCK_CURL_MODE=fail "$TARGET_SCRIPT" check-test nagiosReturnMessage=test nagiosReturnValue=0
assert_equals "Error: curl command failed (exit 7). Response: ''" "$RUN_OUTPUT" "reports curl failures"
assert_equals "1" "$RUN_STATUS" "maps curl failures to a plugin error"

printf 'check_nest.sh tests passed\n'