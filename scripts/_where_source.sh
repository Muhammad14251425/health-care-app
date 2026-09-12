#!/usr/bin/env bash
# Show exactly where each app's source code lives, and how big it is.
set -uo pipefail
B="$HOME/projects/clinic-platform/backend/frappe-bench"

echo "=== BENCH ROOT ==="
echo "$B"
echo
echo "=== APPS (source checkouts) ==="
for a in "$B"/apps/*/; do
  a="${a%/}"; n="$(basename "$a")"
  printf '%-12s %s\n' "$n" "$a"
  printf '%-12s   branch=%s  commit=%s  tag=%s  size=%s\n' "" \
    "$(git -C "$a" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '-')" \
    "$(git -C "$a" rev-parse --short HEAD 2>/dev/null || echo '-')" \
    "$(git -C "$a" describe --tags 2>/dev/null || echo '-')" \
    "$(du -sh "$a" 2>/dev/null | cut -f1)"
  printf '%-12s   python pkg: %s\n' "" "$(ls -d "$a"/*/__init__.py 2>/dev/null | head -1 | xargs dirname 2>/dev/null || echo '-')"
  echo
done

echo "=== WINDOWS-ACCESSIBLE PATH (UNC) ==="
echo '\\wsl$\Ubuntu-24.04\home\fawwad\projects\clinic-platform\backend\frappe-bench'
echo "or, newer syntax:"
echo '\\wsl.localhost\Ubuntu-24.04\home\fawwad\projects\clinic-platform\backend\frappe-bench'
echo
echo "=== KEY MARLEY SOURCE FILES (the ones referenced in the audit) ==="
for f in \
  "healthcare/controllers/service_request_controller.py" \
  "healthcare/healthcare/api/patient_portal.py" \
  "healthcare/healthcare/doctype/patient_appointment/patient_appointment.py" \
  "healthcare/healthcare/doctype/patient/patient.py" \
  "healthcare/hooks.py" ; do
  p="$B/apps/healthcare/$f"
  [ -f "$p" ] && printf '  %6s lines  %s\n' "$(wc -l < "$p")" "$f" || echo "  MISSING $f"
done
echo
echo "=== OUR APP ==="
find "$B/apps/clinic_core/clinic_core" -name '*.py' -not -path '*/node_modules/*' \
  | sed "s|$B/apps/clinic_core/||" | sort
