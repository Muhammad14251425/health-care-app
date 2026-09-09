#!/usr/bin/env bash
# Commit the clinic_core work. Marley stays untouched -- verify that too.
set -uo pipefail
BENCH="$HOME/projects/clinic-platform/backend/frappe-bench"

echo "############ MARLEY must be UNMODIFIED ############"
cd "$BENCH/apps/healthcare"
echo "branch: $(git rev-parse --abbrev-ref HEAD)   head: $(git rev-parse --short HEAD)"
echo "--- tracked-file changes (must be empty) ---"
git status --porcelain --untracked-files=no
if [ -z "$(git status --porcelain --untracked-files=no)" ]; then
  echo "CONFIRMED: no tracked Marley source files modified"
else
  echo "!!! Marley source HAS been modified -- review before continuing"
fi

echo
echo "############ CLINIC_CORE ############"
cd "$BENCH/apps/clinic_core"
git add -A
git status --short
echo "--- committing ---"
git commit -q -m "feat: clinic_core API layer, hardening, seeds and tests

Adds the versioned API surface consumed by the mobile/web clients, plus the
setup and test scaffolding needed to run the clinic workflow end to end.

API (clinic_core/api/v1/, 32 endpoints, all verified whitelisted):
  auth, patients, practitioners, appointments, encounters, invoices, payments

Security (clinic_core/api/response.py):
  * consistent {success,data,message} / {success,data,error} envelope
  * @clinic_api decorator: explicit per-endpoint role declaration, since
    Marley uses frappe.only_for ZERO times across 160 whitelisted endpoints
  * assert_patient_access(): horizontal-access guard (patient may only reach
    their own record) -- the check whose absence causes IDOR upstream
  * pick(): inbound field allowlisting, so clients cannot set arbitrary fields
  * tracebacks/SQL never returned to clients; logged server-side instead
  * clinical notes gated: reception gets scheduling/billing data, not diagnoses

Setup (clinic_core/setup_masters.py):
  Installs master data the ERPNext setup wizard would normally create and whose
  absence produces misleading errors far from the cause: Gender, Salutation,
  UOM, Warehouse Type, Fiscal Year, Item Group, Mode of Payment, Price List,
  Healthcare Service Unit (+Type), and the Company account defaults.

Seeds (clinic_core/seed.py):
  Synthetic-only test users/practitioners/patients. Note Marley ships NO
  'Healthcare Receptionist' role; reception is modelled as Nursing User, and
  billing users additionally need Item Manager because ERPNext's
  get_item_details() calls item.check_permission().

Tests (clinic_core/tests/test_security_marley.py):
  9 adversarial tests, incl. a reproduction of upstream issue #1063
  (set_request_status lets any authenticated user mutate any doctype)."
echo "--- log ---"
git log --oneline -3
git rev-parse HEAD
