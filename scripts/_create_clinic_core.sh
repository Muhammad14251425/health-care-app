#!/usr/bin/env bash
# Create our own Frappe app `clinic_core` and install it on the site.
# ALL custom logic lives here -- frappe/erpnext/healthcare stay pristine.
#
# `bench new-app` takes its metadata interactively, so answers are piped in.
# Prompt order (frappe v16): title, description, publisher, email, icon, color, license, branch.
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
cd "$BENCH"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

if [ -d apps/clinic_core ]; then
  echo "--- apps/clinic_core already exists, skipping scaffold ---"
else
  echo "=== bench new-app clinic_core ==="
  bench new-app clinic_core <<'ANSWERS'
Clinic Core
Clinic platform custom logic: API layer, permission hardening, integrations
Clinic Platform
dev@clinic.local


mit
develop
ANSWERS
fi

echo "=== scaffold check ==="
ls -la apps/clinic_core/

if bench --site clinic.localhost list-apps | grep -qx clinic_core; then
  echo "--- clinic_core already installed on site ---"
else
  echo "=== installing clinic_core on clinic.localhost ==="
  bench --site clinic.localhost install-app clinic_core
fi

echo "=== apps on site ==="
bench --site clinic.localhost list-apps
