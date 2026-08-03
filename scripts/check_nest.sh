#!/bin/bash

# Script to check the status of the Nest Nagios REST API
# This script must be run from the Nagios server. It must be added to the Nagios server as a command.
# Check your Nagios installation for the correct plugin directory.
 
# Usage: ./check_nest.sh <command> [parameters]
# Example: ./check_nest.sh check-test nagiosReturnMessage=Test nagiosReturnValue=1 performanceData=true

NEST_SCHEME="${NEST_SCHEME:-https}"
NEST_HOST="${NEST_HOST:-localhost}"
NEST_PORT="${NEST_PORT:-5000}"
NEST_TLS_INSECURE="${NEST_TLS_INSECURE:-true}"
NEST_CA_CERT="${NEST_CA_CERT:-}"
NEST_API_KEY="${NEST_API_KEY:-}"
NEST_API_KEY_HEADER="${NEST_API_KEY_HEADER:-x-api-key}"

print_help() {
        cat <<EOF
Usage:
    $0 <command> [param1=value1 param2=value2 ...]

Description:
        Calls a Nest endpoint and prints Nagios-compatible output.
        Route resolution:
            - check-test        -> /plugins/check-test
            - nagios/honey-pot  -> /nagios/honey-pot
            - /nagios           -> /nagios

Examples:
    $0 check-test nagiosReturnMessage=Test nagiosReturnValue=1 performanceData=true
    NEST_HOST=192.168.1.10 NEST_API_KEY=topsecret $0 check-debian-eol warningEolRemainingDays=90 criticalEolRemainingDays=30
    NEST_HOST=192.168.1.10 NEST_API_KEY=topsecret $0 nagios/honey-pot
    NEST_HOST=192.168.1.10 NEST_API_KEY=topsecret $0 /nagios

Environment variables:
    NEST_SCHEME           Request scheme (default: https)
    NEST_HOST             Nest host to call (default: localhost)
    NEST_PORT             Nest port to call (default: 5000)
    NEST_TLS_INSECURE     If true and scheme=https, use curl --insecure (default: true)
    NEST_CA_CERT          Optional CA certificate path used by curl --cacert
    NEST_API_KEY          Optional API key value sent as request header
    NEST_API_KEY_HEADER   API key header name (default: x-api-key)

Notes:
        - You can set env vars before the script command:
            NEST_HOST=192.168.1.10 NEST_API_KEY=topsecret $0 check-debian-eol
        - You can also pass supported NEST_* assignments as leading arguments:
            $0 NEST_HOST=192.168.1.10 NEST_API_KEY=topsecret check-debian-eol
    - Command routing rules:
      - Starts with /: used as exact route path
      - Contains / but no leading /: treated as route path (a leading / is added)
      - No /: treated as plugin command under /plugins/
    - Parameters must be passed as key=value.
    - Duplicate parameter keys keep the last value.
    - Use --help or -h to print this help.
EOF
}

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "jq is required but not installed. Please install it and try again."
    exit 1
fi

# Function to build parameters for curl
# Builds parameters for curl from the given arguments
# Example: ./check_nest.sh check-test nagiosReturnMessage=Test nagiosReturnValue=1 performanceData=true
# Will generate curl query arguments for nagiosReturnMessage, nagiosReturnValue, and performanceData.
build_parameters() {
    local -A normalized_values=()
    local -a parameter_order=()
    local raw_param=""
    local key=""
    local value=""

    parameters=()

    for raw_param in "$@"; do
        key="${raw_param%%=*}"
        value="${raw_param#*=}"

        if [ "$key" = "$raw_param" ]; then
            continue
        fi

        if [ -z "${normalized_values[$key]+x}" ]; then
            parameter_order+=("$key")
        fi

        normalized_values[$key]="$value"
    done

    for key in "${parameter_order[@]}"; do
        parameters+=(--data-urlencode "$key=${normalized_values[$key]}")
    done
}

parse_invocation() {
    local -a raw_args=("$@")
    local idx=0
    local assignment=""
    local assignment_key=""
    local assignment_value=""

    while [[ $idx -lt ${#raw_args[@]} && "${raw_args[$idx]}" == NEST_*=* ]]; do
        assignment="${raw_args[$idx]}"
        assignment_key="${assignment%%=*}"
        assignment_value="${assignment#*=}"

        case "$assignment_key" in
            NEST_SCHEME|NEST_HOST|NEST_PORT|NEST_TLS_INSECURE|NEST_CA_CERT|NEST_API_KEY|NEST_API_KEY_HEADER)
                printf -v "$assignment_key" '%s' "$assignment_value"
                ;;
            *)
                echo "Error: Unsupported inline variable '$assignment_key'."
                exit 1
                ;;
        esac

        idx=$((idx + 1))
    done

    if [[ $idx -ge ${#raw_args[@]} ]]; then
        print_help
        exit 1
    fi

    command_name="${raw_args[$idx]}"
    command_parameters=("${raw_args[@]:$((idx + 1))}")
}

# Function to build the URL
# Build the URL for the curl request
# $1 is the command/path to call on the Nest API
# Examples:
#   build_url "check-test" -> https://localhost:5000/plugins/check-test
#   build_url "nagios/honey-pot" -> https://localhost:5000/nagios/honey-pot
#   build_url "/nagios" -> https://localhost:5000/nagios
build_url() {
    local command="$1"
    local command_path=""

    if [[ "$command" == /* ]]; then
        command_path="$command"
    else
        if [[ "$command" == */* ]]; then
            command_path="/${command#/}"
        else
            command_path="/plugins/$command"
        fi
    fi

    echo "${NEST_SCHEME}://${NEST_HOST}:${NEST_PORT}${command_path}"
}

# Function to parse JSON response
# Parse the JSON response from the Nest API
# 
# $1 is the JSON response from the Nest API
# 
# This function parses the JSON response once and formats it according to Nagios standards.
# 
# The function will output the following format:
# 
# message | code=code performanceData
# 
# Where:
#   - message is the message returned by the Nest API
#   - code is the code returned by the Nest API
#   - performanceData is the performance data returned by the Nest API, if any
parse_json() {
    local response="$1"
    local parsed_fields

    if ! parsed_fields=$(jq -r '[.message, (.code // 3 | tostring), (.performanceData // "")] | @tsv' <<< "$response"); then
        return 1
    fi

    IFS=$'\t' read -r parsed_message parsed_code parsed_performance_data <<< "$parsed_fields"

    # Formatting to Nagios output
    if [ -z "$parsed_performance_data" ]; then
        nagios_output="$parsed_message | code=$parsed_code"
    else
        nagios_output="$parsed_message | code=$parsed_code $parsed_performance_data"
    fi
}

# Main script execution starts here
if [ "$#" -lt 1 ]; then
    print_help
    exit 1
fi

parse_invocation "$@"

if [[ "$command_name" == "--help" || "$command_name" == "-h" || "$command_name" == "help" ]]; then
    print_help
    exit 1
fi

# Build URL
url=$(build_url "$command_name")

# Build parameters for curl
build_parameters "${command_parameters[@]}"

# Make GET request and store response in variable
curl_args=(-sS -G)

if [[ "$NEST_SCHEME" == "https" ]]; then
    if [[ -n "$NEST_CA_CERT" ]]; then
        curl_args+=(--cacert "$NEST_CA_CERT")
    elif [[ "$NEST_TLS_INSECURE" == "true" ]]; then
        curl_args+=(--insecure)
    fi
fi

if [[ -n "$NEST_API_KEY" ]]; then
    curl_args+=(-H "$NEST_API_KEY_HEADER: $NEST_API_KEY")
fi

curl_stderr_file=$(mktemp)
response=$(curl "${curl_args[@]}" "${parameters[@]}" "$url" 2>"$curl_stderr_file")
curl_status=$?
curl_stderr=$(tr '\n' ' ' < "$curl_stderr_file" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')
rm -f "$curl_stderr_file"

# Stop early if curl failed
if [[ $curl_status -ne 0 ]]; then
    if [[ -n "$curl_stderr" ]]; then
        echo "Error: curl command failed (exit $curl_status): $curl_stderr"
    else
        echo "Error: curl command failed (exit $curl_status). Response: '$response'"
    fi
    exit 1
fi

# Parse the JSON response and stop if it is invalid
if parse_json "$response"; then
    echo "$nagios_output"

    if [[ "$parsed_code" =~ ^[0-3]$ ]]; then
        exit "$parsed_code"
    fi

    exit 3
else
    echo "Error: Received invalid JSON response."
    exit 3
fi