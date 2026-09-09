#!/usr/bin/env bash
# Create the development site and install frappe + erpnext + healthcare into it.
# DEVELOPMENT CREDENTIALS ONLY -- never reuse these anywhere real.
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
SITE="clinic.localhost"
DB_ROOT_PW="devroot123"
ADMIN_PW="admin123"

cd "$BENCH"

if [ -d "sites/$SITE" ]; then
  echo "--- site $SITE already exists, skipping creation ---"
else
  echo "=== creating site $SITE ==="
  bench new-site "$SITE" \
    --db-root-password "$DB_ROOT_PW" \
    --admin-password "$ADMIN_PW" \
    --no-mariadb-socket
fi

echo "=== installing apps into $SITE ==="
for app in erpnext healthcare; do
  if bench --site "$SITE" list-apps | grep -qx "$app"; then
    echo "--- $app already installed on site ---"
  else
    echo "--- installing $app ---"
    bench --site "$SITE" install-app "$app"
  fi
done

echo "=== enabling developer mode ==="
bench --site "$SITE" set-config developer_mode 1
bench --site "$SITE" set-config server_script_enabled 1

echo "=== set as default site ==="
bench use "$SITE"

echo "=== installed apps ==="
bench --site "$SITE" list-apps

echo "=== done ==="
