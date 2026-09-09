#!/usr/bin/env bash
# Install Node.js 24 (frappe v16 package.json requires engines.node >= 24) via nvm,
# plus yarn. Runs as the unprivileged dev user.
set -euo pipefail

export NVM_DIR="$HOME/.nvm"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "--- installing nvm ---"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
else
  echo "--- nvm already present ---"
fi

# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

echo "--- installing node 24 ---"
nvm install 24
nvm alias default 24
nvm use default

echo "--- enabling yarn via corepack ---"
corepack enable || true
corepack prepare yarn@stable --activate || npm install -g yarn

echo "=== VERSIONS ==="
node --version
npm --version
yarn --version
