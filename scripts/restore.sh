#!/usr/bin/env bash
# Restore a DEVELOPMENT backup. DESTRUCTIVE: replaces the current database.
#
#   wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/restore.sh <path-to-sql.gz>
#
# Requires explicit confirmation, because it destroys the current site data.
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
SITE="clinic.localhost"
DB_ROOT_PW="devroot123"

BACKUP="${1:-}"
if [ -z "$BACKUP" ]; then
  echo "usage: restore.sh <path-to-database.sql.gz>"
  echo
  echo "available backups:"
  ls -lh "$BENCH/sites/$SITE/private/backups/"*.sql.gz 2>/dev/null || echo "  none"
  exit 1
fi
if [ ! -f "$BACKUP" ]; then
  echo "FATAL: no such file: $BACKUP"; exit 1
fi

cd "$BENCH" || exit 1
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

echo "############################################################"
echo "# DESTRUCTIVE: this REPLACES the database of $SITE"
echo "# with: $BACKUP"
echo "############################################################"
read -r -p "Type 'yes' to continue: " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "aborted"; exit 1; }

echo "=== taking a safety backup of the CURRENT state first ==="
bench --site "$SITE" backup || echo "  (safety backup failed -- continuing anyway)"

echo "=== restoring ==="
bench --site "$SITE" restore "$BACKUP" --db-root-password "$DB_ROOT_PW" \
  || { echo "RESTORE FAILED"; exit 1; }

echo "=== migrating ==="
bench --site "$SITE" migrate

echo "=== restored. apps on site: ==="
bench --site "$SITE" list-apps
