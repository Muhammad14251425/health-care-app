#!/usr/bin/env bash
# Fetch ERPNext and Marley (healthcare) at version-16 into the bench.
# NOTE: `bench get-app` only downloads + installs into the bench venv; it does NOT
# install into a site. Site installation happens separately after the site exists.
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
cd "$BENCH"

get_app_if_missing () {
  local name="$1" url="$2" branch="$3"
  if [ -d "apps/$name" ]; then
    echo "--- apps/$name already present, skipping download ---"
  else
    echo "=== bench get-app $name ($branch) ==="
    bench get-app "$url" --branch "$branch" --resolve-deps
  fi
}

get_app_if_missing erpnext    https://github.com/frappe/erpnext    version-16
get_app_if_missing healthcare https://github.com/earthians/marley  version-16

echo
echo "=== INSTALLED APP SOURCES ==="
for a in apps/*/; do
  a="${a%/}"; n="$(basename "$a")"
  printf '%-12s branch=%-14s tag=%s\n' \
    "$n" \
    "$(git -C "$a" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')" \
    "$(git -C "$a" describe --tags 2>/dev/null || echo '-')"
done

echo
echo "=== VERSIONS IN BENCH VENV ==="
./env/bin/python - <<'PY'
import importlib
for m in ("frappe", "erpnext", "healthcare"):
    try:
        mod = importlib.import_module(m)
        print(f"{m:12s} {getattr(mod, '__version__', 'n/a')}")
    except Exception as e:
        print(f"{m:12s} IMPORT FAILED: {e}")
PY

echo "=== disk ==="
df -h / | tail -1
