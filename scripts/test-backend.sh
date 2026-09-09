#!/usr/bin/env bash
# Run the full backend test suite: unit/security tests + the end-to-end HTTP scenario.
#
#   wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/test-backend.sh
#
# Exit code 0 only if EVERYTHING passes. Errors are not hidden.
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
SITE="clinic.localhost"
RC=0

cd "$BENCH" || { echo "FATAL: bench not found"; exit 1; }

echo "############################################################"
echo "# [1/4] sync clinic_core + syntax check"
echo "############################################################"
bash "$HOME/scripts/sync_clinic_core.sh" || RC=1

echo
echo "############################################################"
echo "# [2/4] API surface: importable + whitelisted"
echo "############################################################"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1
bench --site "$SITE" set-config allow_tests true >/dev/null 2>&1
bench --site "$SITE" execute clinic_core.api.selftest.run 2>&1 | tail -5 || RC=1

echo
echo "############################################################"
echo "# [3/4] security unit tests (adversarial)"
echo "############################################################"
bench --site "$SITE" run-tests \
  --app clinic_core \
  --module clinic_core.tests.test_security_marley 2>&1 | tail -25
# shellcheck disable=SC2181
[ "${PIPESTATUS[0]}" -ne 0 ] && RC=1

echo
echo "############################################################"
echo "# [4/4] end-to-end HTTP scenario (41 checks)"
echo "############################################################"
if ! curl -s -o /dev/null --max-time 3 http://localhost:8000/api/method/ping; then
  echo "server not running -- starting it"
  setsid nohup bench serve --port 8000 > /tmp/bench_serve.log 2>&1 < /dev/null &
  for _ in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 http://localhost:8000/api/method/ping && break
    sleep 1
  done
fi
python3 "$HOME/scripts/e2e_scenario.py" http://localhost:8000 || RC=1

echo
echo "############################################################"
if [ "$RC" -eq 0 ]; then
  echo "# RESULT: ALL SUITES PASSED"
else
  echo "# RESULT: FAILURES PRESENT (see above)"
fi
echo "############################################################"
exit "$RC"
