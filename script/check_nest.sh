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

    for raw_param in "${@:2}"; do
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

# Function to build the URL
# Build the URL for the curl request
# $1 is the command to call on the Nest API
# Example: build_url "check-test"
# Will generate: http://localhost:5000/check-test
build_url() {
    echo "${NEST_SCHEME}://${NEST_HOST}:${NEST_PORT}/$1"
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
    echo "Usage: $0 <command> [param1=value1 param2=value2 ...]"
    exit 1
fi

# Build URL
url=$(build_url "$@")

# Build parameters for curl
build_parameters "$@"

# Make GET request and store response in variable
curl_args=(-s -G)

if [[ "$NEST_SCHEME" == "https" ]]; then
    if [[ -n "$NEST_CA_CERT" ]]; then
        curl_args+=(--cacert "$NEST_CA_CERT")
    elif [[ "$NEST_TLS_INSECURE" == "true" ]]; then
        curl_args+=(--insecure)
    fi
fi

response=$(curl "${curl_args[@]}" "${parameters[@]}" "$url")
curl_status=$?

# Stop early if curl failed
if [[ $curl_status -ne 0 ]]; then
    echo "Error: curl command failed. Response: '$response'"
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