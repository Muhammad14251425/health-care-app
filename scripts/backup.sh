#!/usr/bin/env bash
# Create a development backup (database + private/public files).
#
#   wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/backup.sh
#
# Backups land in sites/clinic.localhost/private/backups/.
# NOTE: disk headroom on the Windows host is limited (~32 GB at install time) --
# prune old backups rather than accumulating them.
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
SITE="clinic.localhost"
cd "$BENCH" || { echo "FATAL: bench not found"; exit 1; }
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

echo "=== disk before ==="
df -h / | tail -1

echo "=== backing up $SITE (with files) ==="
bench --site "$SITE" backup --with-files || { echo "BACKUP FAILED"; exit 1; }

echo
echo "=== backups on disk ==="
ls -lh "sites/$SITE/private/backups/" | tail -12

echo
echo "=== disk after ==="
df -h / | tail -1

echo
echo "To restore:  bash ~/scripts/restore.sh <path-to-sql.gz>"
