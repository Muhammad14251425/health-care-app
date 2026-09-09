#!/usr/bin/env bash
# Sync clinic_core then run the seeder via `bench execute` (NOT bench console).
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

bash "$HOME/scripts/sync_clinic_core.sh"

cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

echo
echo "=== bench execute clinic_core.seed.run ==="
bench --site clinic.localhost execute clinic_core.seed.run
