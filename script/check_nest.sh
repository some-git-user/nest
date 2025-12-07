#!/bin/bash

# Script to check the status of the Nest Nagios REST API
# This script must be run from the Nagios server. It must be added to the Nagios server as a command.
# Check your Nagios installation for the correct plugin directory.
 
# Usage: ./check_nest.sh <command> [parameters]
# Example: ./check_nest.sh check-test nagiosReturnMessage=Test nagiosReturnValue=1 performanceData=true

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "jq is required but not installed. Please install it and try again."
    exit 1
fi

# Function to build parameters for curl
# Builds parameters for curl from the given arguments
# Example: ./check_nest.sh check-test nagiosReturnMessage=Test nagiosReturnValue=1 performanceData=true
# Will generate: -d "nagiosReturnMessage=Test" -d "nagiosReturnValue=1" -d "performanceData=true"
# Parameters will be passed to curl as query parameters.
build_parameters() {
    local params=""
    for param in "${@:2}"; do
        params+=" -d \"$param\""
    done
    echo "$params"
}

# Function to build the URL
# Build the URL for the curl request
# $1 is the command to call on the Nest API
# Example: build_url "check-test"
# Will generate: http://localhost:5000/check-test
build_url() {
    echo "http://localhost:5000/$1"
}

# Function to parse JSON response
# Parse the JSON response from the Nest API
# 
# $1 is the JSON response from the Nest API
# 
# This function parses the JSON response and formats it according to Nagios standards.
# 
# The function will output the following format:
# 
# message | code=code;performanceData
# 
# Where:
#   - message is the message returned by the Nest API
#   - code is the code returned by the Nest API
#   - performanceData is the performance data returned by the Nest API, if any
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