#!/usr/bin/env bash
# Ensure the dev server is up, then run the end-to-end HTTP scenario.
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/sync_clinic_core.sh" >/dev/null
cd "$BENCH"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

if ! curl -s -o /dev/null --max-time 3 http://localhost:8000/api/method/ping; then
  echo "--- server not up, starting ---"
  setsid nohup bench serve --port 8000 > /tmp/bench_serve.log 2>&1 < /dev/null &
  for _ in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 http://localhost:8000/api/method/ping && break
    sleep 1
  done
fi
curl -s --max-time 5 http://localhost:8000/api/method/ping && echo " <- server up"

echo
python3 "$HOME/scripts/e2e_scenario.py" http://localhost:8000
