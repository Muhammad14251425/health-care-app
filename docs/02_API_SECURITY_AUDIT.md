# 02 — API Security Audit

**Date:** 2026-09-09
**Scope:** `healthcare` (Marley) v16.5.2, `erpnext` v16.34.2, `frappe` v16.33.1, on `clinic.localhost`
**Method:** static analysis of the actual checked-out source + executable adversarial tests.
No finding below is speculative; each was verified by reading our source tree or by running code.

---

## 1. Executive summary

> **Do not treat Marley's `@frappe.whitelist()` endpoints as authorization-checked.**
> They are, as a rule, *authentication*-checked only (Frappe requires a session), and the
> per-document/per-role decision is frequently absent.

Measured across the `healthcare` app source:

| Signal | Count | Interpretation |
|---|---:|---|
| `@frappe.whitelist()` endpoints | **160** | Public HTTP attack surface |
| `allow_guest=True` endpoints | **0** | ✅ Good — nothing is unauthenticated |
| `frappe.only_for(...)` calls | **0** | ❌ The idiomatic Frappe role guard is used **nowhere** |
| `has_permission(...)` calls | **4** | ❌ ~2.5% of endpoints do an explicit permission check |
| `frappe.throw(...)` | 174 | Mostly *business* validation, not authorization |
| `ignore_permissions=True` | **125** | Explicit permission-layer bypasses |
| `frappe.session.user` references | 19 | The few places ownership is actually considered |

**Conclusion:** authorization in Marley is largely delegated to Frappe's DocType-level role
permissions. That is adequate for the *desk* UI, where users act on documents through the
standard ORM. It is **not** adequate for endpoints that (a) take a `doctype` or record name
straight from the client, or (b) use `frappe.db.*` helpers, which bypass the ORM permission
layer entirely.

This is consistent with, and independently confirms, upstream issue
**#943 — "Security: Systemic missing permission enforcement on @frappe.whitelist() API
endpoints (~85+ functions)"** (open since 2026-03-03).

---

## 2. P0 — Confirmed exploitable: arbitrary record mutation

**Upstream issue:** [#1063] *Arbitrary Record Modification via Unsanitized `doctype` Parameter
in `set_request_status`* (open, labelled `bug`, filed 2026-06-26)

**File:** `healthcare/controllers/service_request_controller.py:92-94`

The function, in its entirety, as it exists in our checkout:

```python
@frappe.whitelist()
def set_request_status(doctype, request, status):
	frappe.db.set_value(doctype, request, "status", status)
```

### Why this is critical

1. `doctype` is attacker-controlled and **not validated against any allowlist**.
2. `request` (the record name) is attacker-controlled and **ownership is never checked**.
3. `frappe.db.set_value()` writes **directly to the database**, bypassing the ORM — so
   DocType permissions, `has_permission` hooks, field-level permlevels and document
   validation are all skipped.
4. The endpoint carries a bare `@frappe.whitelist()`, so **any authenticated user** may call
   it — including the lowest-trust role in the system, `Patient`.

**Impact:** any logged-in user can set the `status` field of **any record of any doctype**
that has one. That includes disabling other patients, force-closing appointments, and
altering the status of clinical and financial documents.

### Reproduction (automated, passing)

`clinic_core/tests/test_security_marley.py::TestSetRequestStatusIDOR`

```python
def test_low_privilege_user_can_mutate_arbitrary_doctype(self):
    from healthcare.controllers.service_request_controller import set_request_status
    frappe.set_user(PATIENT_A_USER)              # lowest-trust authenticated role
    set_request_status("Patient", self.patient_b, "Disabled")
    self.assertEqual(frappe.db.get_value("Patient", self.patient_b, "status"), "Disabled")
```
**Result: PASSES** — i.e. the attack succeeds. Patient A disabled Patient B's record.

The companion control test proves the ORM path *is* protected, isolating the cause to
`frappe.db.set_value`:

```python
def test_patient_cannot_disable_another_patient_via_orm(self):
    frappe.set_user(PATIENT_A_USER)
    with self.assertRaises(frappe.PermissionError):
        doc = frappe.get_doc("Patient", self.patient_b)
        doc.status = "Disabled"
        doc.save()
```
**Result: PASSES** — the ORM correctly refuses.

### Our position

- `clinic_core` **never calls** `set_request_status`.
- Our equivalent, `clinic_core.api.v1.appointments.set_status`, is hardened by construction:
  it is bound to a single doctype, allowlists the permitted status values, requires staff
  roles, and goes through the ORM (`doc.save()`), so permissions are enforced.
- The upstream function remains reachable for anyone who calls it directly. **Mitigation is
  required before this backend is exposed to untrusted users** — see §6.

---

## 3. What Marley does *correctly*

Fairness matters for prioritisation; not everything is broken.

### 3.1 Patient Portal scopes by session user ✅
`healthcare/healthcare/api/patient_portal.py:242-250`
```python
def get_patients_with_relations():
	filters = {"status": "Active"}
	if frappe.session.user != "Administrator":
		filters["user_id"] = frappe.session.user
	patients = frappe.db.get_all("Patient", filters=filters, pluck="name")
	relation = frappe.db.get_all("Patient Relation", filters={"parent": ["in", patients]}, pluck="patient")
	return patients + relation
```
This is a genuine ownership filter, applied consistently by `get_appointments()`,
`get_patients()` and `get_orders()`. **Verified by test**
(`test_portal_patient_list_is_scoped_to_caller`, passing): Patient A does not see Patient B.

### 3.2 Print format is doctype-allowlisted ✅
`patient_portal.py:221-224`
```python
allowed_doctypes = ["Sales Invoice", "Patient Encounter", "Diagnostic Report"]
if doctype not in allowed_doctypes:
	frappe.throw(_("Not allowed to print this document."), frappe.PermissionError)
```
This is exactly the pattern `set_request_status` should have used.

### 3.3 No guest-exposed endpoints ✅
`allow_guest=True` appears **0 times** in the app. Every endpoint requires a session.

### 3.4 Appointment overlap protection is real ✅
`patient_appointment.py:148-234` implements `validate_overlaps()` with a dedicated
`OverlapError`, handling service-unit capacity and same-day-per-patient rules.
**Verified end-to-end over HTTP:** booking the same practitioner/date/time twice is rejected.
`clinic_core` surfaces this as HTTP **409 CONFLICT** rather than reimplementing the rule.

---

## 4. Frappe's own permission layer — verified working

Nine adversarial tests confirm the platform beneath Marley behaves:

| Test | Result |
|---|---|
| Patient A cannot read Patient B's document | ✅ PermissionError |
| Portal helper scopes patient list to caller | ✅ B not visible to A |
| Guest cannot read a Patient document | ✅ PermissionError |
| Guest cannot list Patients | ✅ PermissionError |
| Receptionist cannot write System Settings | ✅ PermissionError |
| Doctor cannot write System Settings | ✅ PermissionError |
| Doctor can read patients | ✅ allowed |
| Patient cannot disable another patient via ORM | ✅ PermissionError |
| `set_request_status` bypasses all of the above | ⚠️ **exploit reproduces** |

The pattern is unambiguous: **the ORM path is safe; the `frappe.db.*` shortcut path is not.**

---

## 5. `clinic_core` hardening (what we built)

Because Marley cannot be relied upon for authorization, every `clinic_core` endpoint declares
its own. Implementation: `clinic_core/api/response.py`.

### 5.1 Explicit role declaration
```python
@frappe.whitelist()
@clinic_api(roles=["Healthcare Administrator", "Physician"])
def create_encounter(payload=None): ...
```
`roles=None` still means "authenticated, not guest". Administrator/System Manager always pass.

### 5.2 Horizontal-access guard
`assert_patient_access(patient)` is called by **every** endpoint that addresses a patient:
- staff roles may address any patient;
- a `Patient`-role caller may address **only** their own linked record;
- for non-staff, "record does not exist" and "not yours" return the **same** 403, so the API
  cannot be used to enumerate valid patient ids.

### 5.3 Inbound field allowlisting
`pick(payload, ALLOWED_FIELDS)` — client dicts are never splatted into `frappe.get_doc()`.
`update_patient` permits only `mobile/email/phone/blood_group`; `user_id`, `status` and
`customer` are unreachable from the API, so a client cannot re-link a patient to another
user or escalate.

### 5.4 Clinical-notes policy (deliberate decision)
Diagnoses, symptoms and prescriptions are returned only to:
Administrator / System Manager / Healthcare Administrator / Physician, **or the patient
themselves**. Reception (`Nursing User`) receives scheduling and billing context with
`clinical_access: false` and the clinical keys **omitted from the payload entirely** —
not merely hidden in the UI. Accounts roles count as staff for *billing* reach but are
excluded from `_may_see_clinical`.
**Verified over HTTP:** `Receptionist sees encounter WITHOUT clinical detail` — passing.

### 5.5 No information leakage in errors
The `@clinic_api` wrapper catches every exception. Stack traces, SQL and internal messages go
to the Error Log; the client receives `{"code": "INTERNAL_ERROR", "message": "An unexpected
error occurred."}`. This was observed working during development: a raw
`MySQLdb.OperationalError` about a missing column was correctly withheld from the API
response and only visible in the server-side log.

### 5.6 Status transitions are allowlisted
`appointments.set_status` accepts only
`{Scheduled, Open, Closed, Cancelled, No Show, Checked In}`, is staff-only, is bound to
`Patient Appointment`, and saves through the ORM — the deliberate inverse of `set_request_status`.

---

## 6. Recommended mitigations (not yet applied)

| # | Action | Priority | Rationale |
|---|---|---|---|
| M1 | Block/override `healthcare...set_request_status` before any untrusted user reaches this backend | **P0** | Confirmed exploitable; trivially reachable |
| M2 | Keep all client traffic on `clinic_core.api.v1.*`; do not expose raw Marley endpoints through the gateway | **P0** | 160 endpoints with ~4 permission checks is not a defensible surface |
| M3 | Add an allowlist/deny layer for `/api/method/healthcare.*` at the reverse proxy | P1 | Defence in depth for M2 |
| M4 | Re-run this audit after every Marley upgrade | P1 | New endpoints arrive without permission checks |
| M5 | Report/track #1063 upstream and adopt the fix when released | P2 | Prefer upstream over a local fork |

**On M1:** the clean implementation is a `override_whitelisted_methods` hook in
`clinic_core/hooks.py` pointing `set_request_status` at a guarded wrapper that allowlists the
doctype and enforces `frappe.has_permission`. This has **not** been implemented yet — it is
the single highest-value next task, recorded in `docs/FINAL_BACKEND_STATUS.md` §13.

---

## 7. Reproducing this audit

```bash
# static counts
bash ~/scripts/_audit_whitelist.sh

# the adversarial suite (9 tests)
bash ~/scripts/_run_sec_tests.sh

# full role/permission scenario over real HTTP (41 checks)
python3 ~/scripts/e2e_scenario.py http://localhost:8000
```
