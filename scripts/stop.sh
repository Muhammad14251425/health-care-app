#!/usr/bin/env bash
# Stop the clinic backend web server.
# Leaves MariaDB/Redis running (they are cheap and other tooling may use them);
# pass --all to stop those too.
set -uo pipefail

echo "=== stopping web server ==="
if pkill -f "bench serve"; then echo "  bench serve stopped"; else echo "  not running"; fi
pkill -f "frappe serve" 2>/dev/null || true
sleep 1

if [ "${1:-}" = "--all" ]; then
  echo "=== stopping bench redis ==="
  for port in 11000 13000; do
    if redis-cli -p "$port" ping >/dev/null 2>&1; then
      redis-cli -p "$port" shutdown nosave 2>/dev/null || true
      echo "  redis :$port stopped"
    fi
  done
  echo "=== stopping system services ==="
  sudo systemctl stop mariadb redis-server && echo "  mariadb + redis stopped"
fi

echo "=== status ==="
if curl -s -o /dev/null --max-time 2 http://localhost:8000/api/method/ping; then
  echo "  WARNING: something is still serving on :8000"
else
  echo "  port 8000 clear"
fi
