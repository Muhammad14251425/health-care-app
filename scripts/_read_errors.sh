#!/usr/bin/env bash
# Read the Error Log entries our envelope wrote, so we see the real tracebacks
# that were (correctly) withheld from the API client.
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

bench --site clinic.localhost execute clinic_core.api.errors.dump
