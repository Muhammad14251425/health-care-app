#!/usr/bin/env bash
# Install the Frappe bench CLI into an isolated pipx-style venv owned by the dev user.
# Bench itself only needs python>=3.10; the *bench python* used for apps must be 3.14.
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# pipx keeps bench off the system python and out of apt's way (PEP 668 / externally-managed).
if ! command -v pipx >/dev/null 2>&1; then
  echo "--- installing pipx ---"
  sudo apt-get install -y -qq pipx
fi

pipx ensurepath >/dev/null 2>&1 || true
export PATH="$HOME/.local/bin:$PATH"

if command -v bench >/dev/null 2>&1; then
  echo "--- bench already installed ---"
else
  echo "--- installing frappe-bench via pipx ---"
  pipx install frappe-bench
fi

echo "=== VERSIONS ==="
bench --version
python3.14 --version
node --version
yarn --version
