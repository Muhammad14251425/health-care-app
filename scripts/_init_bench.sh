#!/usr/bin/env bash
# Initialise the frappe-bench on the version-16 branch using python3.14.
# Source lives in the LINUX filesystem (never /mnt/c) for performance + permissions.
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

PROJ="$HOME/projects/clinic-platform"
BACKEND="$PROJ/backend"
BENCH="$BACKEND/frappe-bench"
mkdir -p "$BACKEND"
cd "$BACKEND"

# Guard: only auto-remove an EMPTY/partial skeleton left by a failed init.
# A real bench has apps/frappe AND env/ -- never delete that automatically.
if [ -d "$BENCH" ]; then
  if [ -d "$BENCH/apps/frappe" ] || [ -d "$BENCH/env" ]; then
    echo "!!! A REAL bench already exists at $BENCH -- refusing to touch it."
    exit 0
  fi
  echo "--- removing empty/partial bench skeleton from previous failed init ---"
  du -sh "$BENCH"
  rm -rf "$BENCH"
fi

echo "=== bench init: frappe version-16, python3.14, node $(node --version), uv $(uv --version) ==="
bench init frappe-bench \
  --frappe-branch version-16 \
  --python /usr/bin/python3.14 \
  --verbose

echo "=== INIT COMPLETE ==="
cd frappe-bench
echo "--- frappe branch ---"
git -C apps/frappe rev-parse --abbrev-ref HEAD
git -C apps/frappe describe --tags 2>/dev/null || true
echo "--- bench python ---"
./env/bin/python --version
