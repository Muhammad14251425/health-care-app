#!/usr/bin/env bash
# Start the dev web server in the background and prove the site actually serves HTTP.
# Uses `bench serve` (the supported entrypoint) which handles CWD/sites resolution itself.
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
cd "$BENCH"

bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

pkill -f "frappe serve" 2>/dev/null || true
sleep 1

echo "=== starting bench serve (background) ==="
setsid nohup bench serve --port 8000 > /tmp/bench_serve.log 2>&1 < /dev/null &
echo "launched"

echo "=== waiting for port 8000 ==="
UP=0
for i in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 "http://clinic.localhost:8000/api/method/ping" 2>/dev/null; then
    echo "port up after ${i}s"; UP=1; break
  fi
  sleep 1
done
[ "$UP" = 0 ] && echo "!!! port never came up"

echo
echo "=== GET /api/method/ping ==="
curl -s --max-time 15 "http://clinic.localhost:8000/api/method/ping"; echo

echo "=== GET /login (status) ==="
curl -s -o /dev/null -w 'HTTP %{http_code}  bytes=%{size_download}\n' --max-time 20 \
  "http://clinic.localhost:8000/login"

echo "=== GET / (status) ==="
curl -s -o /dev/null -w 'HTTP %{http_code}  bytes=%{size_download}\n' --max-time 20 \
  "http://clinic.localhost:8000/"

echo
echo "=== serve log (last 20) ==="
tail -20 /tmp/bench_serve.log
