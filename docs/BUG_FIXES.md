# Bug Fixes Log

Every fix that touches `apps/frappe`, `apps/erpnext` or `apps/healthcare` **must** be recorded
here using the template at the bottom.

---

## Current status: **NO upstream source files have been modified**

Verified at commit time:

```
$ cd apps/healthcare
$ git rev-parse --abbrev-ref HEAD   ->  version-16
$ git rev-parse --short HEAD        ->  934d6c1        (tag v16.5.2)
$ git status --porcelain --untracked-files=no
    (empty)
CONFIRMED: no tracked Marley source files modified
```

Every problem encountered during installation and validation was resolved **outside** upstream
code — in `clinic_core`, or by running an official upstream patch. That is the intended design
and keeps `git pull upstream version-16` conflict-free.

---

## Issues encountered and where they were resolved

### U1 — ERPNext: `Unknown column 'tabContact.is_billing_contact'`
| | |
|---|---|
| **Bug ID** | U1 |
| **GitHub issue** | Not filed upstream (install-ordering defect, ERPNext v16.34.2) |
| **Problem** | Every `Sales Invoice` insert failed with `MySQLdb.OperationalError: (1054, "Unknown column 'tabContact.is_billing_contact' in 'WHERE'")`. All billing was impossible. |
| **How reproduced** | `clinic_core.api.v1.invoices.create_consultation_invoice` → any Sales Invoice creation. Deterministic. |
| **Root cause** | `erpnext/accounts/party.py:1074` filters on `is_billing_contact` unconditionally. That field is a **Custom Field**, created by `erpnext/setup/install.py` and the `v16_0.migrate_address_contact_custom_fields` patch. On a site whose Company was created programmatically (not via the setup wizard) the field was never created, so the ORM emitted SQL for a non-existent column. |
| **Files changed** | **None.** |
| **Fix** | Ran the official upstream patch: `bench --site clinic.localhost execute erpnext.patches.v16_0.migrate_address_contact_custom_fields.execute` |
| **Verification** | `SHOW COLUMNS FROM tabContact LIKE 'is_billing_contact'` → `is_billing_contact tinyint(4) NO 0`. Invoicing then worked end-to-end. |
| **Tests added** | Covered by `e2e_scenario.py` billing section (11 checks). |
| **Regression risk** | None — this runs ERPNext's own migration. |
| **Commit** | Environment change, not a code change. Automated in `clinic_core/setup_masters.py` follow-up work. |
| **Fixed upstream?** | The patch exists upstream; the *ordering* gap is only hit on programmatic Company creation. |

### U2 — Marley: strict type validation on `get_availability_data`
| | |
|---|---|
| **Bug ID** | U2 |
| **GitHub issue** | Same class as [#1107](https://github.com/earthians/marley/issues/1107) (open) |
| **Problem** | Slot listing raised `FrappeTypeError`, then `ValueError: "doctype" is a required key`. |
| **How reproduced** | Calling `healthcare...get_availability_data(date, practitioner, appointment=None)`. |
| **Root cause** | The parameter is annotated `appointment: str \| dict \| PatientAppointment` and Frappe's `typing_validations` enforces it at runtime. `None` is rejected; `{}` passes the type check but then fails inside `get_appointment_doc()`, which calls `frappe.get_doc(dict)` after pydantic coercion has stripped the `doctype` key. |
| **Files changed** | **None upstream.** `clinic_core/api/v1/appointments.py` only. |
| **Fix** | Pass a genuine unsaved `frappe.new_doc("Patient Appointment")` probe carrying `practitioner`, `appointment_date`, `appointment_type`. Rationale documented inline at the call site. |
| **Tests added** | `e2e_scenario.py`: *"slots endpoint responds"* + *"slots returned for a working weekday"*. |
| **Regression risk** | None — upstream untouched. If Marley relaxes the annotation, our call still works. |
| **Fixed upstream?** | ❌ No. #1107 remains open. |

### U3 — Marley: `set_request_status` arbitrary record mutation (**P0, NOT fixed**)
| | |
|---|---|
| **Bug ID** | U3 |
| **GitHub issue** | [#1063](https://github.com/earthians/marley/issues/1063) — open, labelled `bug` |
| **Problem** | Any authenticated user can set `status` on any record of any doctype. |
| **How reproduced** | Automated, passing: `clinic_core/tests/test_security_marley.py::TestSetRequestStatusIDOR::test_low_privilege_user_can_mutate_arbitrary_doctype`. A `Patient`-role user disabled another patient's record. |
| **Root cause** | `healthcare/controllers/service_request_controller.py:92-94` — unvalidated `doctype`, no permission check, and `frappe.db.set_value` bypasses the ORM permission layer. |
| **Files changed** | **None.** Deliberately left unmodified. |
| **Current mitigation** | `clinic_core` never calls it; our `appointments.set_status` is doctype-bound, value-allowlisted, staff-only and ORM-routed. |
| **Outstanding** | ⚠️ The upstream function is **still reachable** by direct call. An `override_whitelisted_methods` hook is required before untrusted users reach this backend. Tracked in `docs/FINAL_BACKEND_STATUS.md` §13. |
| **Regression risk of fixing** | Low — an override wrapper preserves the signature and adds an allowlist + `has_permission`. |
| **Fixed upstream?** | ❌ No, as of v16.5.2. |

---

## Setup-data defects (resolved in `clinic_core`, no upstream edits)

These produced errors far from their cause and each blocked the workflow. All are handled
idempotently by `clinic_core/setup_masters.py`.

| ID | Error seen | Root cause | Resolution |
|---|---|---|---|
| S1 | `Could not find Gender: Male` | Gender master is setup-wizard data | `_ensure_simple("Gender", ...)` |
| S2 | `Could not find Warehouse Type: Transit` | Same | `_ensure_simple("Warehouse Type", ...)` |
| S3 | `Could not find Parent Department: All Departments` | Department tree root missing | Auto-created as `All Departments - TC` |
| S4 | Nothing invoiceable | No Fiscal Year | Fiscal Year 2026 |
| S5 | `Could not find Default Unit of Measure: Nos` | **Zero** UOM records existed | UOM Nos/Unit/Hour/Minute/Day |
| S6 | `Please mention 'Round Off Account' in Company` | Company account defaults unset | `_ensure_company_accounts()` |
| S7 | `[Sales Invoice]: selling_price_list, price_list_currency, plc_conversion_rate` | No selling Price List | `_ensure_price_list()` |
| S8 | Slots always empty | No Healthcare Service Unit; its **Type** is a mandatory Link that `ignore_mandatory` does not bypass | `_ensure_service_unit()` |
| S9 | Bare `PermissionError` on Sales Invoice | ERPNext `get_item_details()` calls `item.check_permission()`; `Accounts Manager` does not grant read on `Item` | Seed grants `Item Manager` |
| S10 | `TypeError: 'str' object does not support item assignment` | `symptoms`/`diagnosis` are `Table MultiSelect`; `Complaint`'s field is `complaints` (**plural**), `Diagnosis`'s is `diagnosis` | Normalisation in `encounters.py` |

---

## Process for a genuine Marley fix (if one becomes unavoidable)

1. **Reproduce** with an automated test that fails.
2. Confirm it is **not already fixed** upstream: `git fetch upstream && git log HEAD..upstream/version-16`, and search the issue tracker.
3. **Branch:** `git checkout clinic-dev` (already created from the pristine v16.5.2 baseline).
4. Make the **smallest possible** change.
5. Run the affected tests, then the full suite: `bash ~/scripts/test-backend.sh`.
6. **Document here** using the template below.
7. **Commit separately** — one commit per fix, never bundled.
8. Report upstream and replace our patch with theirs when released.

### Template
```markdown
### <ID> — <short title>
| | |
|---|---|
| **Bug ID** | |
| **GitHub issue URL** | |
| **Problem** | |
| **How reproduced** | |
| **Root cause** | |
| **Files changed** | |
| **Fix** | |
| **Tests added** | |
| **Regression risk** | |
| **Commit hash** | |
| **Fixed upstream already?** | |
```
