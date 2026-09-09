#!/usr/bin/env bash
# Prove the healthcare/ERPNext doctypes really exist in the site database,
# and that key Marley doctypes are queryable.
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

bench --site clinic.localhost console <<'PY'
import frappe

print("=== SITE ===", frappe.local.site)
print("=== INSTALLED APPS ===", frappe.get_installed_apps())

key_dts = [
    "Patient", "Healthcare Practitioner", "Patient Appointment",
    "Patient Encounter", "Medical Department", "Practitioner Schedule",
    "Healthcare Service Unit", "Clinical Procedure", "Lab Test",
    "Sales Invoice", "Payment Entry", "Customer", "Company",
]
print("=== KEY DOCTYPES ===")
for dt in key_dts:
    exists = frappe.db.exists("DocType", dt)
    n = frappe.db.count(dt) if exists else "-"
    print(f"  {'OK ' if exists else 'MISSING'} {dt:32s} rows={n}")

print("=== healthcare doctype count ===")
print(frappe.db.count("DocType", {"module": ["like", "%Healthcare%"]}))

print("=== company ===")
print(frappe.get_all("Company", fields=["name", "default_currency", "country"]))

print("=== developer_mode ===", frappe.conf.get("developer_mode"))
PY
