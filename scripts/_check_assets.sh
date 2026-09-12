#!/usr/bin/env bash
# Diagnose why the login page renders unstyled: are the JS/CSS bundles built?
set -uo pipefail
B="$HOME/projects/clinic-platform/backend/frappe-bench"

echo "=== sites/assets/css ==="
ls -la "$B/sites/assets/css/" 2>&1 | head -10
echo
echo "=== sites/assets/js ==="
ls -la "$B/sites/assets/js/" 2>&1 | head -10
echo
echo "=== frappe/public/dist (esbuild output) ==="
ls -la "$B/apps/frappe/frappe/public/dist/" 2>&1 | head -10
echo
echo "=== assets.json (maps logical -> hashed bundle) ==="
cat "$B/sites/assets/assets.json" 2>&1
echo
echo
echo "=== does the login page reference a bundle that exists? ==="
curl -s http://localhost:8000/login | grep -oE '(href|src)="[^"]*\.(css|js)[^"]*"' | sort -u | head -20
