#!/usr/bin/env bash
# Create the root "All Departments" group node. ERPNext's Department is a tree
# (nested set); Company.on_update tries to create per-company departments under
# this root, which the setup wizard would normally have created.
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
COMPANY = "Test Clinic"

if not frappe.db.exists("Department", "All Departments"):
    d = frappe.get_doc({
        "doctype": "Department",
        "department_name": "All Departments",
        "is_group": 1,
    })
    d.flags.ignore_mandatory = True
    d.insert(ignore_permissions=True)
    frappe.db.commit()
    print("created root Department:", d.name)
else:
    print("root Department already exists")

try:
    comp = frappe.get_doc("Company", COMPANY)
    comp.save(ignore_permissions=True)
    frappe.db.commit()
    print("company re-saved cleanly")
except Exception as e:
    print("company save:", type(e).__name__, e)

print("=== departments ===", [d.name for d in frappe.get_all("Department", limit=15)])
print("=== accounting readiness ===")
print("  default_receivable:", frappe.db.get_value("Company", COMPANY, "default_receivable_account"))
print("  default_income:", frappe.db.get_value("Company", COMPANY, "default_income_account"))
print("  default_cash:", frappe.db.get_value("Company", COMPANY, "default_cash_account"))
print("  cost_center:", frappe.db.get_value("Company", COMPANY, "cost_center"))
PY
