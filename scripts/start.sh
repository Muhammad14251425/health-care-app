#!/usr/bin/env bash
# Start the clinic backend (redis + web server).
#
#   wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/start.sh
#
# Errors are NOT hidden. If something fails you will see it.
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
SITE="clinic.localhost"
PORT="${PORT:-8000}"

cd "$BENCH" || { echo "FATAL: bench not found at $BENCH"; exit 1; }

echo "=== [1/4] system services ==="
for svc in mariadb redis-server; do
  if systemctl is-active --quiet "$svc"; then
    echo "  $svc: active"
  else
    echo "  $svc: starting..."
    sudo systemctl start "$svc" || { echo "  FAILED to start $svc"; exit 1; }
  fi
done

echo "=== [2/4] bench redis (cache + queue) ==="
bash "$HOME/scripts/_start_redis.sh"

echo "=== [3/4] web server on :$PORT ==="
if curl -s -o /dev/null --max-time 3 "http://localhost:$PORT/api/method/ping"; then
  echo "  already running"
else
  pkill -f "bench serve" 2>/dev/null || true
  sleep 1
  setsid nohup bench serve --port "$PORT" > /tmp/bench_serve.log 2>&1 < /dev/null &
  echo -n "  waiting"
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/api/method/ping"; then
      echo " up"; break
    fi
    echo -n "."; sleep 1
  done
fi

echo "=== [4/4] verify ==="
if curl -s --max-time 5 "http://localhost:$PORT/api/method/ping" | grep -q pong; then
  echo "  ping: OK"
  echo
  echo "  Backend ready:  http://localhost:$PORT"
  echo "  Login:          Administrator / admin123"
  echo "  Logs:           tail -f /tmp/bench_serve.log"
else
  echo "  ping: FAILED -- last 30 log lines:"
  tail -30 /tmp/bench_serve.log
  exit 1
fi
