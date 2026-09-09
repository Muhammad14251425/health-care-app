#!/usr/bin/env bash
# ERPNext v16 queries Contact.is_billing_contact in accounts/party.py, but that
# field is a CUSTOM FIELD created by erpnext/setup/install.py. On this site it was
# never created, so any Sales Invoice that resolves a party contact fails with:
#     MySQLdb.OperationalError: (1054, "Unknown column 'tabContact.is_billing_contact'")
#
# Correct fix: run ERPNext's own custom-field installer rather than hand-adding it.
set -uo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"; nvm use default >/dev/null
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/projects/clinic-platform/backend/frappe-bench"
bash "$HOME/scripts/_start_redis.sh" >/dev/null 2>&1

echo "=== BEFORE: does the custom field exist? ==="
bench --site clinic.localhost execute frappe.client.get_count \
  --kwargs '{"doctype":"Custom Field","filters":{"dt":"Contact","fieldname":"is_billing_contact"}}' 2>/dev/null

echo
echo "=== running ERPNext's address/contact custom field installer ==="
bench --site clinic.localhost execute erpnext.setup.install.add_custom_fields 2>&1 | tail -10 \
  || echo "add_custom_fields not directly callable; trying the v16 patch"

echo
echo "=== running the v16 migration patch ==="
bench --site clinic.localhost execute \
  erpnext.patches.v16_0.migrate_address_contact_custom_fields.execute 2>&1 | tail -10 \
  || echo "patch execute failed"

echo
echo "=== AFTER: verify column exists in the DB ==="
bench --site clinic.localhost mariadb -e \
  "SHOW COLUMNS FROM tabContact LIKE 'is_billing_contact';" 2>/dev/null \
  || mysql --version
