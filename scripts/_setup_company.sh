#!/usr/bin/env bash
# Create the ERPNext Company + healthcare defaults required before any billing works.
# Idempotent: safe to re-run.
set -uo pipefail

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"

cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

bench --site clinic.localhost execute healthcare.setup.setup_healthcare 2>/dev/null || true

bench --site clinic.localhost console <<'PY'
import frappe
frappe.set_user("Administrator")

COMPANY = "Test Clinic"
ABBR = "TC"

if not frappe.db.exists("Company", COMPANY):
    print("creating company...")
    c = frappe.get_doc({
        "doctype": "Company",
        "company_name": COMPANY,
        "abbr": ABBR,
        "default_currency": "PKR",
        "country": "Pakistan",
        "chart_of_accounts": "Standard",
    })
    c.insert(ignore_permissions=True)
    frappe.db.commit()
    print("company created:", c.name)
else:
    print("company already exists")

# Global defaults so downstream docs don't need the field set explicitly.
gd = frappe.get_doc("Global Defaults")
gd.default_company = COMPANY
gd.save(ignore_permissions=True)
frappe.db.commit()

print("=== companies ===", frappe.get_all("Company", fields=["name", "abbr", "default_currency", "country"]))
print("=== accounts created ===", frappe.db.count("Account", {"company": COMPANY}))
print("=== fiscal years ===", frappe.get_all("Fiscal Year", fields=["name"], limit=5))
PY
