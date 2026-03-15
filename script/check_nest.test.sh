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

run_check() {
    local output
    set +e
    output=$(PATH="$FAKE_BIN:$PATH" CURL_ARGS_FILE="$TMP_DIR/curl_args" "$@" 2>&1)
    status=$?
    set -e
    RUN_OUTPUT="$output"
    RUN_STATUS="$status"
}

run_check env MOCK_RESPONSE="VALID_JSON:test|0|load=1;;;;" "$TARGET_SCRIPT" check-test nagiosReturnMessage=test nagiosRetunValue=0 performanceData=true code=3
assert_equals "test | code=0 load=1;;;;" "$RUN_OUTPUT" "formats Nagios output with perfdata"
assert_equals "0" "$RUN_STATUS" "exits with the plugin code"
assert_contains "nagiosReturnValue=0" "$TMP_DIR/curl_args" "normalizes nagiosRetunValue alias"

run_check env MOCK_RESPONSE="VALID_JSON:warning|2|" "$TARGET_SCRIPT" check-test nagiosReturnMessage=warning nagiosReturnValue=2
assert_equals "warning | code=2" "$RUN_OUTPUT" "omits perfdata when absent"
assert_equals "2" "$RUN_STATUS" "returns non-zero Nagios status"

run_check env MOCK_RESPONSE="not-json" "$TARGET_SCRIPT" check-test nagiosReturnMessage=test nagiosReturnValue=0
assert_equals "Error: Received invalid JSON response." "$RUN_OUTPUT" "reports invalid JSON"
assert_equals "3" "$RUN_STATUS" "maps invalid JSON to UNKNOWN"

run_check env MOCK_CURL_MODE=fail "$TARGET_SCRIPT" check-test nagiosReturnMessage=test nagiosReturnValue=0
assert_equals "Error: curl command failed. Response: ''" "$RUN_OUTPUT" "reports curl failures"
assert_equals "1" "$RUN_STATUS" "maps curl failures to a plugin error"

printf 'check_nest.sh tests passed\n'