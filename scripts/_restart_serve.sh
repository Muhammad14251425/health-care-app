#!/usr/bin/env bash
# Restart the dev web server. Needed after installing a new app, because the
# running process caches sys.path / the app list from startup.
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
cd "$BENCH"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

echo "--- stopping existing dev server ---"
pkill -f "bench serve" 2>/dev/null || true
pkill -f "frappe serve" 2>/dev/null || true
sleep 2

echo "--- confirming clinic_core is importable by the bench env ---"
./env/bin/python -c "import clinic_core; print('clinic_core at', clinic_core.__file__)"

echo "--- starting dev server ---"
setsid nohup bench serve --port 8000 > /tmp/bench_serve.log 2>&1 < /dev/null &

for _ in $(seq 1 60); do
  curl -s -o /dev/null --max-time 2 http://localhost:8000/api/method/ping && break
  sleep 1
done
echo -n "ping: "; curl -s --max-time 5 http://localhost:8000/api/method/ping; echo

echo "--- verifying clinic_core endpoint is reachable over HTTP ---"
curl -s -o /dev/null -w 'auth.me (unauth) -> HTTP %{http_code}\n' --max-time 15 \
  -X POST http://localhost:8000/api/method/clinic_core.api.v1.auth.me
