#!/usr/bin/env bash
# Frappe's bench invokes `yarn install --check-files`, which is Yarn 1 (classic) syntax.
# Yarn 4 (Berry, installed by corepack) removed --check-files and errors out.
# Fix: pin Yarn 1.22.x (classic) globally, which is what Frappe v16 expects.
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null

echo "=== BEFORE ==="
yarn --version 2>/dev/null || echo "no yarn"
command -v yarn || true

# Disable corepack's yarn shim so it stops forcing Berry.
corepack disable yarn 2>/dev/null || true

# Remove any corepack/berry shims left in the node bin dir.
NODEBIN="$(dirname "$(command -v node)")"
rm -f "$NODEBIN/yarn" "$NODEBIN/yarnpkg" 2>/dev/null || true

echo "=== installing yarn 1.22.22 (classic) via npm ==="
npm install -g yarn@1.22.22

hash -r
echo "=== AFTER ==="
yarn --version
command -v yarn
echo "=== flag support check (must NOT error) ==="
yarn install --help 2>&1 | grep -i -- '--check-files' && echo "--check-files SUPPORTED" || echo "note: help grep inconclusive"
