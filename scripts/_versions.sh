#!/usr/bin/env bash
# Collect exact installed versions for the final report.
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null 2>&1
export PATH="$HOME/.local/bin:$PATH"
BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"
cd "$BENCH"

echo "OS:        $(. /etc/os-release; echo "$PRETTY_NAME")"
echo "Kernel:    $(uname -r)"
echo "Python:    $(./env/bin/python --version 2>&1)"
echo "Node:      $(node --version)"
echo "npm:       $(npm --version)"
echo "Yarn:      $(yarn --version)"
echo "MariaDB:   $(mariadbd --version | sed 's/.*Ver //;s/ for.*//')"
echo "Redis:     $(redis-server --version | sed 's/.*v=//;s/ .*//')"
echo "bench:     $(bench --version)"
echo "wkhtmltopdf: $(wkhtmltopdf --version 2>/dev/null)"
echo "uv:        $(uv --version)"
echo
echo "--- apps (branch @ commit, tag) ---"
for a in apps/*/; do
  a="${a%/}"; n="$(basename "$a")"
  printf '%-12s %-12s %-10s %s\n' "$n" \
    "$(git -C "$a" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '-')" \
    "$(git -C "$a" rev-parse --short HEAD 2>/dev/null || echo '-')" \
    "$(git -C "$a" describe --tags 2>/dev/null || echo '-')"
done
echo
echo "--- site apps ---"
bench --site clinic.localhost list-apps
echo
echo "--- disk ---"
df -h / | tail -1
du -sh "$BENCH" 2>/dev/null
echo
echo "--- marley cleanliness ---"
git -C apps/healthcare status --porcelain --untracked-files=no | head -5
[ -z "$(git -C apps/healthcare status --porcelain --untracked-files=no)" ] \
  && echo "MARLEY CLEAN (no tracked modifications)" || echo "MARLEY MODIFIED"
echo
echo "--- clinic_core commits ---"
git -C apps/clinic_core log --oneline | head -5
