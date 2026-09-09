#!/usr/bin/env bash
# Verify GitHub issue #1063: "Arbitrary Record Modification via Unsanitized
# `doctype` Parameter in set_request_status". Read the actual source in OUR checkout.
set -uo pipefail
APP="$HOME/projects/clinic-platform/backend/frappe-bench/apps/healthcare/healthcare"

echo "############ set_request_status ############"
grep -rn --include='*.py' -B4 -A20 'def set_request_status' "$APP"

echo
echo "############ get_patients_with_relations (ownership filter) ############"
sed -n '240,258p' "$APP/healthcare/api/patient_portal.py"

echo
echo "############ get_print_format (has a PermissionError) ############"
sed -n '218,255p' "$APP/healthcare/api/patient_portal.py"
