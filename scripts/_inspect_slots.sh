#!/usr/bin/env bash
set -uo pipefail
APP="$HOME/projects/clinic-platform/backend/frappe-bench/apps/healthcare/healthcare"
PA="$APP/healthcare/doctype/patient_appointment/patient_appointment.py"

echo "=== get_appointment_doc (line ~600) ==="
sed -n '596,615p' "$PA"

echo
echo "=== get_availability_data (line ~711) ==="
sed -n '711,760p' "$PA"

echo
echo "############ ERPNext Contact.is_billing_contact ############"
EAPP="$HOME/projects/clinic-platform/backend/frappe-bench/apps/erpnext"
FAPP="$HOME/projects/clinic-platform/backend/frappe-bench/apps/frappe"
echo "--- where is is_billing_contact referenced? ---"
grep -rn --include='*.py' --include='*.json' 'is_billing_contact' "$EAPP" "$FAPP" | head -20
