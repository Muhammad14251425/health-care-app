#!/usr/bin/env bash
# The Company was created directly (not via the ERPNext setup wizard), so some
# global master data that the wizard normally installs is missing:
#   - Warehouse Type "Transit"  (caused LinkValidationError during Company insert)
#   - Fiscal Year               (required by every Sales Invoice / GL entry)
# This installs the missing masters idempotently and verifies the result.
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

bench --site clinic.localhost console <<'PY'
import frappe
from frappe.utils import getdate
frappe.set_user("Administrator")

COMPANY = "Test Clinic"

# --- 1. Warehouse Types (Transit is referenced by Company on_update) ---
for wt in ("Transit", "Stores", "Work In Progress", "Finished Goods"):
    if not frappe.db.exists("Warehouse Type", wt):
        frappe.get_doc({"doctype": "Warehouse Type", "name": wt}).insert(ignore_permissions=True)
        print("created Warehouse Type:", wt)
frappe.db.commit()

# --- 2. Fiscal Year ---
if not frappe.db.count("Fiscal Year"):
    fy = frappe.get_doc({
        "doctype": "Fiscal Year",
        "year": "2026",
        "year_start_date": "2026-01-01",
        "year_end_date": "2026-12-31",
    })
    fy.insert(ignore_permissions=True)
    frappe.db.commit()
    print("created Fiscal Year:", fy.name)
else:
    print("fiscal year(s) already present")

# --- 3. Re-save Company so the on_update hooks that failed can complete ---
try:
    comp = frappe.get_doc("Company", COMPANY)
    comp.save(ignore_permissions=True)
    frappe.db.commit()
    print("company re-saved OK")
except Exception as e:
    print("company re-save issue:", type(e).__name__, e)

# --- 4. Verify ---
print("=== VERIFY ===")
print("fiscal years:", frappe.get_all("Fiscal Year", fields=["name","year_start_date","year_end_date"]))
print("warehouse types:", [d.name for d in frappe.get_all("Warehouse Type")])
print("accounts:", frappe.db.count("Account", {"company": COMPANY}))
print("warehouses:", [d.name for d in frappe.get_all("Warehouse", filters={"company": COMPANY})])
print("cost centers:", [d.name for d in frappe.get_all("Cost Center", filters={"company": COMPANY})])
print("currency PKR enabled:", frappe.db.get_value("Currency", "PKR", "enabled"))
PY
