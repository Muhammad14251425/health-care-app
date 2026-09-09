#!/usr/bin/env bash
# Inspect Marley's appointment slot + overlap logic so clinic_core REUSES it
# instead of duplicating healthcare business rules.
set -uo pipefail
APP="$HOME/projects/clinic-platform/backend/frappe-bench/apps/healthcare/healthcare"
PA="$APP/healthcare/doctype/patient_appointment/patient_appointment.py"

echo "=== whitelisted functions in patient_appointment.py ==="
grep -n -A2 '@frappe.whitelist' "$PA" | grep -E 'def ' | sed 's/-/ /' | awk '{print "  "$0}'

echo
echo "=== slot / availability functions ==="
grep -n -E '^def |^\s*def ' "$PA" | grep -iE 'slot|avail|check|overlap|conflict|validate' | head -30

echo
echo "=== does Marley guard against double-booking? ==="
grep -n -iE 'overlap|already booked|conflict|double|existing appointment' "$PA" | head -20

echo
echo "=== validate() body ==="
sed -n "$(grep -n 'def validate' "$PA" | head -1 | cut -d: -f1),+30p" "$PA"
