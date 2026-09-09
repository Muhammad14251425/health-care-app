# 01 — Marley GitHub Issue Audit

**Date:** 2026-09-09
**Repository:** https://github.com/earthians/marley
**Installed version:** `version-16` @ `934d6c1` (tag **v16.5.2**)
**Open issues at audit time:** **69**

Issues were fetched live from the GitHub API rather than assumed, and each one relevant to our
clinic scope was checked **against our actual checked-out source**, not just the issue text.

Priority key — **P0** security/data exposure · **P1** core clinic workflow broken ·
**P2** important, workaround exists · **P3** optional.

---

## Summary table

| Issue | Title (abbrev.) | Status | Affected version | Affects us? | Can reproduce? | Fixed upstream? | Needs local fix? | Priority |
|---|---|---|---|---|---|---|---|---|
| [#1063](https://github.com/earthians/marley/issues/1063) | Arbitrary Record Modification via unsanitized `doctype` in `set_request_status` | Open (`bug`) | v16 incl. 16.5.2 | **YES** | ✅ **YES — automated test** | ❌ No | ✅ **Yes (override)** | **P0** |
| [#943](https://github.com/earthians/marley/issues/943) | Systemic missing permission enforcement on `@frappe.whitelist()` (~85+ functions) | Open | v15 + v16 | **YES** | ✅ Yes (statically: 160 endpoints, 0 `only_for`, 4 `has_permission`) | ❌ No | ✅ Yes (gateway policy) | **P0** |
| [#1186](https://github.com/earthians/marley/issues/1186) | Cannot invoice Medication Requests without `order_group` / unsubmitted Encounter | Open (`bug`) | v16 | ⚠️ Partially | Not tested | ❌ No | ❌ Not yet | P2 |
| [#1107](https://github.com/earthians/marley/issues/1107) | `FrappeTypeError` in `get_healthcare_services_to_invoice` (strict type validation on `link_customer`) | Open (`bug`) | v16 | ⚠️ Same *class* hit | ✅ Analogous case reproduced | ❌ No | ✅ Worked around | **P1** |
| [#1137](https://github.com/earthians/marley/issues/1137) | Non-English install fails: Code System created with translated name | Open | v16 | ❌ No (English site) | n/a | ❌ No | ❌ No | P3 |
| [#916](https://github.com/earthians/marley/issues/916) | Healthcare install fails on non-English ERPNext | Open (`bug`) | v16 | ❌ No | n/a | ❌ No | ❌ No | P3 |
| [#927](https://github.com/earthians/marley/issues/927) | Unable to restore database due to Healthcare app issues | Open (`bug`) | v16 | ⚠️ Future risk | Not tested | ❌ No | ❌ Not yet | P2 |
| [#1019](https://github.com/earthians/marley/issues/1019) | Medication force-disables linked Items when `is_billable` unchecked | Open (`feature-request`) | v16 | ❌ No (no medication billing yet) | n/a | ❌ No | ❌ No | P3 |
| [#961](https://github.com/earthians/marley/issues/961) | Separate Imaging/Laboratory Diagnostic Report generation | Open (`feature-request`) | v16 | ❌ No | n/a | n/a | ❌ No | P3 |

---

## Detailed findings

### #1063 — Arbitrary record modification — **P0, reproduced**

Our checkout, `healthcare/controllers/service_request_controller.py:92-94`, verbatim:

```python
@frappe.whitelist()
def set_request_status(doctype, request, status):
	frappe.db.set_value(doctype, request, "status", status)
```

Attacker-controlled `doctype` **and** record name, no permission check, and
`frappe.db.set_value` bypasses the ORM permission layer. Any authenticated user — including
`Patient`, the lowest-trust role — can set `status` on any record of any doctype.

**Reproduced by an automated test that passes today:** a Patient-role user set another
patient's record to `Disabled`. A companion test proves the same write *through the ORM* is
correctly refused, isolating `frappe.db.set_value` as the cause.
Full detail: `docs/02_API_SECURITY_AUDIT.md` §2.

**Not fixed upstream** as of v16.5.2 (issue open; code present in our checkout).

**Action:** `clinic_core` never calls it, and our own `appointments.set_status` is
doctype-bound, value-allowlisted, staff-only and ORM-routed. An
`override_whitelisted_methods` hook to neutralise the upstream function is the recommended
next step (see `docs/FINAL_BACKEND_STATUS.md` §13) — **not yet implemented**.

---

### #943 — Systemic missing permission enforcement — **P0, confirmed statically**

Independently measured on our source tree:

| Metric | Value |
|---|---:|
| `@frappe.whitelist()` endpoints in `healthcare` | **160** |
| `frappe.only_for(...)` (idiomatic role guard) | **0** |
| `has_permission(...)` | **4** |
| `ignore_permissions=True` | **125** |
| `allow_guest=True` | **0** ✅ |

The issue claims ~85+ affected functions; our count of 160 whitelisted endpoints against 4
permission checks is consistent with that magnitude. Authorization is effectively delegated to
DocType role permissions — sufficient for the desk UI, insufficient for endpoints that accept
client-supplied doctype/record identifiers or use `frappe.db.*`.

**Action:** all client traffic goes through `clinic_core.api.v1.*`, which declares roles
explicitly and re-verifies ownership. Raw `healthcare.*` endpoints must not be exposed
through the public gateway.

---

### #1107 — Strict type validation — **P1, same class hit and worked around**

The reported bug is a `FrappeTypeError` from Frappe's `typing_validations` against Marley's
annotated signatures. **We hit the identical class of failure** in
`get_availability_data(date, practitioner, appointment)`, annotated
`appointment: str | dict | PatientAppointment`:

- passing `None` → `FrappeTypeError` (rejects `NoneType`);
- passing `{}` → `ValueError: "doctype" is a required key`, because `get_appointment_doc()`
  feeds the dict to `frappe.get_doc()` after coercion strips it.

**Our fix (in `clinic_core`, not in Marley):** pass a genuine unsaved
`frappe.new_doc("Patient Appointment")` probe carrying `practitioner`, `appointment_date` and
`appointment_type`. Documented inline in `clinic_core/api/v1/appointments.py`.
Slot listing now works — verified end-to-end.

---

### #1186 / #927 / #1019 / #961 / #1137 / #916 — deferred

None block the initial clinic scope (patients, appointments, availability, encounters, simple
consultation billing, roles). Per the brief, effort was **not** spent on inpatient, insurance,
laboratory, therapy or non-English installs. #927 (backup/restore) is flagged as a **future
risk** to re-test before any production migration.

---

## Bugs found by us that are *not* in the upstream tracker

These were discovered during installation and validation. They are **environment/setup**
defects rather than Marley logic errors, but they break the clinic workflow outright and are
recorded here because they cost real time to diagnose.

| # | Symptom | Root cause | Fixed in |
|---|---|---|---|
| L1 | `MySQLdb.OperationalError: Unknown column 'tabContact.is_billing_contact'` on **every** Sales Invoice | ERPNext v16 `accounts/party.py:1074` queries a **Custom Field** created by `setup/install.py`; the field was never created on a programmatically-built site | Ran `erpnext.patches.v16_0.migrate_address_contact_custom_fields` — column verified present |
| L2 | `LinkValidationError: Could not find Gender: Male` — no patient can be created | Gender/Salutation masters are setup-wizard data | `clinic_core.setup_masters` |
| L3 | `LinkValidationError: Could not find Warehouse Type: Transit` during Company insert | Same class | `clinic_core.setup_masters` |
| L4 | No Fiscal Year → nothing can be invoiced | Same class | `clinic_core.setup_masters` |
| L5 | `Could not find Default Unit of Measure: Nos` — **zero** UOM records existed | Same class | `clinic_core.setup_masters` |
| L6 | `Please mention 'Round Off Account' in Company` | Company account defaults unset when Company is created in code | `clinic_core.setup_masters._ensure_company_accounts` |
| L7 | `[Sales Invoice]: selling_price_list, price_list_currency, plc_conversion_rate` | No Selling Price List existed | `clinic_core.setup_masters._ensure_price_list` |
| L8 | Slots always empty: *"does not have a Service Unit set against the Practitioner Schedule"* | No Healthcare Service Unit; and its **Type** is a mandatory Link that `ignore_mandatory` does not bypass | `clinic_core.setup_masters._ensure_service_unit` |
| L9 | Bare `PermissionError` creating a Sales Invoice as a billing user | ERPNext `get_item_details()` calls `item.check_permission()`; `Accounts Manager` does **not** grant read on `Item` | Seed grants `Item Manager` |
| L10 | `TypeError: 'str' object does not support item assignment` creating an encounter | `symptoms`/`diagnosis` are `Table MultiSelect` child tables, not text. Also `Complaint`'s field is `complaints` (**plural**) while `Diagnosis`'s is `diagnosis` | `clinic_core/api/v1/encounters.py` normalisation |

> None of L1–L10 required editing `frappe`, `erpnext` or `healthcare` source.
> **Marley remains byte-identical to upstream** (`git status` on tracked files: clean).
