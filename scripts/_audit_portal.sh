#!/usr/bin/env bash
# Focused audit of the Patient Portal API -- the most exposed surface, since patients
# are low-trust authenticated users hitting it directly from the browser/mobile.
set -uo pipefail
APP="$HOME/projects/clinic-platform/backend/frappe-bench/apps/healthcare/healthcare"
PORTAL="$APP/healthcare/api/patient_portal.py"

echo "=== total whitelisted endpoints in healthcare app ==="
grep -rn --include='*.py' '@frappe.whitelist' "$APP" | wc -l

echo "=== patient_portal.py: whitelisted functions ==="
grep -n -A3 '@frappe.whitelist' "$PORTAL" | grep -E '^\s*[0-9]+[:-]\s*def ' | sed 's/[:-]/ /' | awk '{print "  line "$1": "$3}'

echo
echo "=== patient_portal.py: how is the caller's patient identity resolved? ==="
grep -n -E 'session\.user|get_patient|patient\s*=|user_id' "$PORTAL" | head -40

echo
echo "=== does the portal validate that requested patient == caller's patient? ==="
grep -n -E 'frappe\.throw|PermissionError|has_permission|only_for' "$PORTAL" | head -30
