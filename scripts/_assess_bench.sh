#!/usr/bin/env bash
BENCH=/home/fawwad/projects/clinic-platform/backend/frappe-bench
cd "$BENCH" || { echo "no bench"; exit 1; }

echo "=== apps dir ==="
ls -la apps/
echo "=== frappe branch / tag ==="
git -C apps/frappe rev-parse --abbrev-ref HEAD 2>/dev/null || echo "frappe not a git repo"
git -C apps/frappe describe --tags 2>/dev/null || true
echo "=== bench python version ==="
./env/bin/python --version 2>/dev/null || echo "no venv python"
echo "=== is frappe importable / installed in venv? ==="
./env/bin/python -c "import frappe; print('frappe', frappe.__version__)" 2>&1 | tail -3
echo "=== node_modules present in apps/frappe? ==="
[ -d apps/frappe/node_modules ] && du -sh apps/frappe/node_modules || echo "NO node_modules (yarn step incomplete)"
echo "=== sites dir ==="
ls -la sites/
echo "=== apps.txt ==="
cat sites/apps.txt 2>/dev/null || echo "no apps.txt"
echo "=== disk ==="
df -h / | tail -1
du -sh "$BENCH"
