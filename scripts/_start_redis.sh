#!/usr/bin/env bash
# Bench runs its OWN redis instances from config/redis_*.conf. These normally come up
# under `bench start` (honcho); one-off CLI commands (`bench new-site`, `bench migrate`,
# `bench run-tests`) need them already running.
#
# NOTE: bench's port assignment for this bench is:
#     redis_cache.conf   -> :13000   (also used for socketio)
#     redis_queue.conf   -> :11000
# Ports are read from the conf files themselves rather than hardcoded, so this stays
# correct even if bench regenerates them differently.
set -uo pipefail

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
cd "$BENCH"

start_redis () {
  local conf="$1" label="$2" port
  if [ ! -f "$conf" ]; then
    echo "!!! missing config $conf"
    return 1
  fi
  port="$(awk '/^port /{print $2}' "$conf")"

  if redis-cli -p "$port" ping >/dev/null 2>&1; then
    echo "--- redis $label already up on :$port ---"
    return 0
  fi

  echo "--- starting redis $label on :$port ---"
  redis-server "$conf" --daemonize yes
  for _ in $(seq 1 20); do
    redis-cli -p "$port" ping >/dev/null 2>&1 && break
    sleep 0.3
  done
  if redis-cli -p "$port" ping >/dev/null 2>&1; then
    echo "    OK $label :$port"
  else
    echo "    FAILED $label :$port"
    return 1
  fi
}

start_redis config/redis_cache.conf cache
start_redis config/redis_queue.conf queue

echo "=== status ==="
for p in 6379 11000 13000; do
  printf 'redis :%-6s ' "$p"
  redis-cli -p "$p" ping 2>/dev/null || echo "DOWN"
done
