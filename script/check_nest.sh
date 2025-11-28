#!/bin/bash

# Usage: ./check_nest.sh check-test nagiosReturnMessage=Test nagiosReturnValue=1 performanceData=true

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "jq is required but not installed. Please install it and try again."
    exit 1
fi

# Function to build parameters for curl
build_parameters() {
    local params=""
    for param in "${@:2}"; do
        params+=" -d \"$param\""
    done
    echo "$params"
}

# Function to build the URL
build_url() {
    echo "http://localhost:5000/$1"
}

# Function to parse JSON response
parse_json() {
    local response="$1"
    message=$(echo "$response" | jq -r '.message')
    code=$(echo "$response" | jq -r '.code')
    performanceData=$(echo "$response" | jq -r '.performanceData')
    # Formatting to Nagios output
    echo "$message | code=$code;$performanceData"
}

# Main script execution starts here
if [ "$#" -lt 1 ]; then
    echo "Usage: $0 param1=value1 [param2=value2 ...]"
    exit 1
fi

# Build URL
url=$(build_url "$@")

# Build parameters for curl
parameters=$(build_parameters "$@")

# Make GET request and store response in variable
# Use `eval` to properly expand quoted parameters
response=$(eval "curl -s -G $parameters \"$url\"")

# Output response for debugging
if [[ $? -ne 0 ]]; then
    echo "Error: curl command failed."
    exit 1
fi

# Check if response is valid JSON
if echo "$response" | jq . >/dev/null 2>&1; then
    # Parse the JSON response
    nagios_output=$(parse_json "$response")
    # TODO exit code is not correct
    echo "$nagios_output"
else
    echo "Error: Received invalid JSON response."
    exit 3
fi