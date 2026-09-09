#!/usr/bin/env bash
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

bash "$HOME/scripts/sync_clinic_core.sh"
cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

# Frappe refuses to run tests unless the site opts in.
bench --site clinic.localhost set-config allow_tests true >/dev/null 2>&1

echo
echo "=== security tests vs pristine Marley ==="
bench --site clinic.localhost run-tests \
  --app clinic_core \
  --module clinic_core.tests.test_security_marley 2>&1 | tail -60
