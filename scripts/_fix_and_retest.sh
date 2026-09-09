#!/usr/bin/env bash
# Sync fixes, install missing masters, restart the server, re-run E2E.
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

bash "$HOME/scripts/sync_clinic_core.sh" | tail -3
cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

echo
echo "=== installing missing ERPNext masters ==="
bench --site clinic.localhost execute clinic_core.setup_masters.run 2>&1 | tail -20

echo
echo "=== restarting dev server ==="
pkill -f "bench serve" 2>/dev/null || true
sleep 2
setsid nohup bench serve --port 8000 > /tmp/bench_serve.log 2>&1 < /dev/null &
for _ in $(seq 1 60); do
  curl -s -o /dev/null --max-time 2 http://localhost:8000/api/method/ping && break
  sleep 1
done
echo -n "ping: "; curl -s --max-time 5 http://localhost:8000/api/method/ping; echo

echo
python3 "$HOME/scripts/e2e_scenario.py" http://localhost:8000
