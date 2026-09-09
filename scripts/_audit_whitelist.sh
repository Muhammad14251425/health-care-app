#!/usr/bin/env bash
# Static audit of @frappe.whitelist() endpoints in the healthcare (Marley) app.
# Classifies each by whether it appears to perform ANY permission check.
set -uo pipefail
APP="$HOME/projects/clinic-platform/backend/frappe-bench/apps/healthcare/healthcare"
OUT="$HOME/audit"
mkdir -p "$OUT"

echo "=== total @frappe.whitelist occurrences ==="
grep -rn --include='*.py' '@frappe.whitelist' "$APP" | wc -l

echo "=== allow_guest=True endpoints (PUBLIC - highest risk) ==="
grep -rn --include='*.py' 'allow_guest\s*=\s*True' "$APP" | tee "$OUT/guest_endpoints.txt"
echo "count: $(wc -l < "$OUT/guest_endpoints.txt")"

echo
echo "=== per-file whitelist counts (top 20) ==="
grep -rc --include='*.py' '@frappe.whitelist' "$APP" \
  | awk -F: '$2>0 {print $2"\t"$1}' | sort -rn | head -20

echo
echo "=== permission-primitive usage across app ==="
for pat in 'frappe.only_for' 'has_permission' 'frappe.throw' 'check_permission' \
           'PermissionError' 'frappe.session.user' 'ignore_permissions'; do
  printf '%-28s %s\n' "$pat" "$(grep -rn --include='*.py' "$pat" "$APP" | wc -l)"
done

echo
echo "=== ignore_permissions=True occurrences (bypasses perms) ==="
grep -rn --include='*.py' 'ignore_permissions\s*=\s*True' "$APP" \
  | tee "$OUT/ignore_perms.txt" | head -25
echo "count: $(wc -l < "$OUT/ignore_perms.txt")"
