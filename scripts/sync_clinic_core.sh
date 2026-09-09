#!/usr/bin/env bash
# Sync clinic_core source authored on the Windows side into the bench app in the
# Linux filesystem. The bench copy is authoritative for running; the Windows copy
# exists so the files are editable/reviewable from VS Code on the host.
#
# Usage: bash ~/scripts/sync_clinic_core.sh
set -euo pipefail

WIN_SRC="/mnt/c/Users/Muhammad Fawwad/Downloads/medical/clinic-platform/backend/clinic_core"
APP_DST="$HOME/projects/clinic-platform/backend/frappe-bench/apps/clinic_core/clinic_core"

if [ ! -d "$WIN_SRC" ]; then
  echo "!!! source not found: $WIN_SRC"; exit 1
fi
if [ ! -d "$APP_DST" ]; then
  echo "!!! app not found: $APP_DST"; exit 1
fi

echo "=== syncing clinic_core ==="
# Copy .py files preserving subdirectory layout. --no-perms because drvfs cannot
# represent unix permissions; -c compares by checksum not mtime (drvfs mtimes are unreliable).
rsync -rc --no-perms --no-owner --no-group \
  --include='*/' --include='*.py' --include='*.json' --include='*.md' --exclude='*' \
  "$WIN_SRC/" "$APP_DST/"

echo "=== synced files ==="
find "$APP_DST" -name '*.py' -newermt '-2 minutes' -printf '  %P\n' 2>/dev/null | head -30

echo "=== python syntax check ==="
cd "$HOME/projects/clinic-platform/backend/frappe-bench"
find "$APP_DST" -name '*.py' -print0 | xargs -0 ./env/bin/python -m py_compile \
  && echo "  all files compile OK"
