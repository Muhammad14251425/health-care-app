#!/usr/bin/env bash
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

bench --site clinic.localhost console <<'PY'
import frappe
print("=== HEALTHCARE-RELATED ROLES ===")
for r in frappe.get_all("Role", filters={"name": ["like", "%Health%"]}, pluck="name"):
    print("  ", r)
print("=== OTHER CANDIDATE ROLES ===")
for want in ("Physician", "Nursing User", "Patient", "Laboratory User",
             "Accounts Manager", "Accounts User", "System Manager"):
    print(f"   {want:22s} exists={bool(frappe.db.exists('Role', want))}")
print("=== Patient doctype: has user_id field? ===")
meta = frappe.get_meta("Patient")
print("  user_id:", bool(meta.get_field("user_id")))
print("  email:", bool(meta.get_field("email")))
print("  mobile:", bool(meta.get_field("mobile")))
print("  mandatory fields:", [f.fieldname for f in meta.fields if f.reqd])
print("=== Healthcare Practitioner mandatory ===")
hp = frappe.get_meta("Healthcare Practitioner")
print("  mandatory:", [f.fieldname for f in hp.fields if f.reqd])
print("=== Patient Appointment mandatory ===")
pa = frappe.get_meta("Patient Appointment")
print("  mandatory:", [f.fieldname for f in pa.fields if f.reqd])
PY
