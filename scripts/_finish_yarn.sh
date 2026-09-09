#!/usr/bin/env bash
# Complete the JS dependency step that failed under Yarn 4.
# Now that yarn 1.22 (classic) is active, run the exact command bench would have run.
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
cd "$BENCH/apps/frappe"

echo "=== yarn version in use ==="
yarn --version

echo "=== yarn install --check-files ==="
yarn install --check-files

echo "=== result ==="
du -sh node_modules
