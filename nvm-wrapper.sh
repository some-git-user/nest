#!/bin/bash
# Wrapper script to ensure the Node.js version pinned in .nvmrc is used.
#
# npm hooks (prepare) and the Debian build run in a non-interactive shell that
# does not inherit the nvm setup from ~/.bashrc, so nvm has to be sourced here.
# A missing nvm or an uninstalled pinned version fails loudly instead of
# silently building with whatever Node.js happens to be on PATH.
set -o pipefail

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [[ ! -f "${NVM_DIR}/nvm.sh" ]]; then
	echo "nvm-wrapper: nvm not found at ${NVM_DIR}/nvm.sh" >&2
	echo "nvm-wrapper: install nvm (https://github.com/nvm-sh/nvm) or set NVM_DIR" >&2
	exit 127
fi

# shellcheck source=/dev/null
source "${NVM_DIR}/nvm.sh"

if ! nvm use; then
	echo "nvm-wrapper: 'nvm use' failed - is the version in .nvmrc installed?" >&2
	exit 1
fi

exec "$@"
