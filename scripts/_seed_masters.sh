#!/usr/bin/env bash
# Install baseline master records that the ERPNext setup wizard would normally create.
# Missing Gender caused: LinkValidationError: Could not find Gender: Male
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

bench --site clinic.localhost console <<'PY'
import frappe
frappe.set_user("Administrator")

print("=== BEFORE ===")
for dt in ("Gender", "Salutation", "Patient Relation", "Blood Group"):
    if frappe.db.exists("DocType", dt):
        print(f"  {dt:20s} {frappe.db.count(dt)}")

for g in ("Male", "Female", "Other", "Transgender", "Prefer not to say"):
    if not frappe.db.exists("Gender", g):
        frappe.get_doc({"doctype": "Gender", "gender": g}).insert(ignore_permissions=True)
        print("created Gender:", g)

for s in ("Mr", "Ms", "Mrs", "Dr", "Prof"):
    if frappe.db.exists("DocType", "Salutation") and not frappe.db.exists("Salutation", s):
        frappe.get_doc({"doctype": "Salutation", "salutation": s}).insert(ignore_permissions=True)
        print("created Salutation:", s)

frappe.db.commit()

print("=== AFTER ===")
print("  genders:", frappe.get_all("Gender", pluck="name"))
if frappe.db.exists("DocType", "Salutation"):
    print("  salutations:", frappe.get_all("Salutation", pluck="name"))
PY
