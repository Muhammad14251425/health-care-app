#!/usr/bin/env bash
# Build front-end assets for all apps.
#
# Why this was needed: the original `bench init` aborted at the yarn step (Yarn 4
# rejected `--check-files`). After fixing yarn, `yarn install` was completed manually
# but `bench build` was never run for frappe -- so frappe/public/dist/ was missing and
# assets.json had no frappe entries. The login page then requested unresolved paths
# (/login.bundle.css, /frappe-web.bundle.js) and rendered with no CSS or JS.
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
cd "$BENCH" || exit 1
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

echo "=== yarn deps present for each app? ==="
for app in frappe erpnext healthcare; do
  if [ -d "apps/$app/node_modules" ]; then
    echo "  $app: node_modules OK"
  else
    echo "  $app: node_modules MISSING -> installing"
    (cd "apps/$app" && yarn install --check-files) || echo "    yarn install failed for $app"
  fi
done

echo
echo "=== bench build (production bundles, all apps) ==="
bench build --production 2>&1 | tail -30
echo "build exit: $?"

echo
echo "=== clearing caches ==="
bench --site clinic.localhost clear-cache
bench --site clinic.localhost clear-website-cache

echo
echo "=== result: frappe dist ==="
ls "$BENCH/apps/frappe/frappe/public/dist/css/" 2>/dev/null | head -8
ls "$BENCH/apps/frappe/frappe/public/dist/js/" 2>/dev/null | head -8

echo
echo "=== assets.json now contains frappe entries? ==="
grep -c 'assets/frappe' "$BENCH/sites/assets/assets.json" 2>/dev/null \
  && echo "(count of frappe asset entries above)"
