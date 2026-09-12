# Patient Account — Security & Workflow Test Results

All results below are from **real runs against the live backend**
(`clinic.localhost`, frappe 16.33.1 / erpnext 16.34.2 / healthcare 16.5.2) on
2026-09-11. Nothing here is mocked, and no result is asserted from reading code.

| suite | where | result |
|---|---|---|
| Backend, in-process (incl. 22 patient-portal tests) | `clinic_core/tests/` | **131 passed, 0 failed** |
| HTTP: OTP + account resolution + IDOR | `test_otp_http.py` | **30 passed, 0 failed** |
| HTTP: booking, records, billing, logout | `test_flow_http.py`, `test_records_http.py` | **24 passed, 0 failed** |
| Mobile unit + API shape | `npx jest` | **81 passed, 0 failed** |
| Typecheck | `npx tsc --noEmit` | **clean** |

---

## Test accounts

| | patient | number as stored | what it proves |
|---|---|---|---|
| A | `QA Patient A` | `03451110001` (national) | Case A linking from legacy free-text data |
| B | `QA Patient B` | `+923451110002` (E.164) | the other stored shape |

The two formats are deliberate: real data holds both, and matching must not care.

---

## The 15 required workflow tests

| # | test | result |
|---|---|---|
| 1 | Patient A enters phone | **PASS** — accepted in national format |
| 2 | OTP sent | **PASS** — row stored against the *normalised* number, hash 64 hex chars |
| 3 | Correct OTP logs in | **PASS** — session issued, `persona: patient`, linked to the existing record, **no duplicate Patient** |
| 4 | Home shows A's data | **PASS** — `patient.me` / `patient.home` return A only |
| 5 | A books an appointment | **PASS** — `HLC-APP-2026-00072`, booked without sending any patient id |
| 6 | Admin sees it | **PASS** — real Marley `Patient Appointment`, `patient=QA Patient A` |
| 7 | Doctor sees it | **PASS** — same record, on the practitioner's calendar |
| 8 | A opens Visit History | **PASS** — 1 visit returned, A's own |
| 9 | Doctor writes a visible record | **PASS** — submitted encounter with symptoms + diagnosis |
| 10 | A refreshes Records | **PASS** — diagnosis and symptoms appear; notes do not (see below). Prescriptions/lab sections returned empty: this site has 0 `Drug Prescription` and 0 `Lab Test` rows |
| 11 | Invoice created for A | **PASS** — `ACC-SINV-2026-00013`, Rs 3,000 |
| 12 | A sees the invoice | **PASS** — summary: billed 3000, paid 0, outstanding 3000, 1 unpaid |
| 13 | A tries B's invoice | **PASS — denied** |
| 14 | A logs out | **PASS** — session dead on the next request |
| 15 | B logs in | **PASS** — zero A data present |

---

## Cross-patient (IDOR) results

Every attempt below was made with a **valid Patient A session** against a real,
existing Patient B record — the attacker knows the id.

| attack | result |
|---|---|
| `patient.me?patient=B` | ignored — A's own record returned |
| `patient.me?patient_id=B` | ignored |
| `patient.home?patient=B` | ignored |
| `patient_records.visits?patient=B` | ignored |
| `patient_billing.summary?patient=B` | ignored |
| `patient_appointments.list_appointments?patient=B` | ignored |
| `patient_appointments.create` with `patient: B` in the payload | **rejected**, `VALIDATION_ERROR` |
| `patient_appointments.get_appointment(B's id)` | **404** |
| `patient_appointments.cancel(B's id)` | **refused** — B's appointment still `Scheduled` |
| `patient_records.visit(B's encounter)` | **404**, no B content in the body |
| `patient_billing.invoice(A's invoice)` as **B** | **denied** |
| A's invoice in B's list | absent |

### No enumeration oracle

A real-but-not-mine id and a nonexistent id return **byte-identical** errors:

```
patient_records.visit(B's encounter)  as A  →  404 {"code":"NOT_FOUND","message":"Record not found."}
patient_records.visit("HLC-ENC-9999-99999") as A  →  404 {"code":"NOT_FOUND","message":"Record not found."}
```

If these differed, an attacker could walk the (sequential, guessable) id space
and learn exactly which records exist — a membership oracle over medical data.
Asserted by `test_forbidden_is_indistinguishable_from_missing`.

---

## Clinical privacy

An encounter was created for B containing both patient-safe and internal content,
then fetched **by B, its rightful owner**:

```json
{"success": true, "data": {
  "encounter_date": "2026-09-10",
  "practitioner_name": "Dr Second Doctor",
  "medical_department": "General Medicine",
  "symptoms":  ["QA Persistent cough"],
  "diagnosis": ["QA Acute bronchitis"],
  "prescriptions": [], "lab_requests": []
}}
```

| assertion | result |
|---|---|
| diagnosis present | **PASS** |
| symptoms present (`*_in_print` honoured) | **PASS** |
| `SECRET-B-CLINICAL-NOTE` absent | **PASS** |
| `SECRET-B-COMMENT` absent | **PASS** |
| no `clinical_notes` key at all | **PASS** |
| no `encounter_comment` key at all | **PASS** |
| B's own **draft** encounter unreadable | **PASS** |
| draft absent from the visit list | **PASS** |

The restricted text is not hidden client-side — it is never serialised, so it
never crosses the wire.

---

## OTP edge cases

| case | result |
|---|---|
| wrong OTP | rejected |
| expired OTP (expiry backdated in the DB) | rejected |
| already-used OTP (replay) | rejected |
| 6th attempt with the **correct** code after 5 misses | rejected — the attempt cap kills the code |
| unknown phone | rejected, **same message as a wrong code** |
| invalid phone (`not-a-phone`) | rejected as a validation error |
| phone with spaces (`0345 111 0001`) | accepted |
| `0345…` / `+92345…` / `92345…` / `00923…` | all resolve to **one** account |
| resend before cooldown | returns success with the remaining `resend_in`, issues nothing |
| issuance over 5/hour for one number | `RATE_LIMITED` |
| every rate-limit refusal | identical wording (no per-number vs per-IP hint) |
| OTP at rest | `sha256(salt+code)`, 64 hex chars, per-row salt — no plaintext column |

### Account-existence oracle

`request_otp` for a known number and for an unknown one returned the same
`success`, the same message and the same key set. Asserted by
`test_request_otp_never_reveals_whether_the_number_is_known`.

---

## Staff-endpoint refusal

With a Patient A session:

| endpoint | result |
|---|---|
| `patients.list_patients` | does not expose other patients |
| `appointments.list_appointments` (staff scope) | does not expose other patients |
| `invoices.list_invoices` | does not expose other patients |

Underpinned by a structural fact verified on this install: Marley's `Patient`
role has **zero DocPerms** on Patient, Patient Appointment, Patient Encounter,
Sales Invoice, Lab Test, Medication Request, Diagnostic Report, Observation and
Patient Medical Record. A patient session cannot read those doctypes through the
ORM at all.

---

## Cache isolation (TEST 14/15 in detail)

1. Sign in as A; open profile, visits, appointments, billing.
2. Sign out → `patient_auth.logout` **and** `queryClient.clear()`.
3. Confirm the session is dead: the next `patient.me` with A's sid is refused.
4. Sign in as B.
5. `patient.me` returns **`QA Patient B`**, and the response contains no
   occurrence of `QA Patient A`.

`queryClient.clear()` runs on every sign-out *and* every sign-in
(`src/stores/auth.tsx`), because a different person may be next on the same
handset.

The client layer is separately guarded by
`src/api/__tests__/patientApiShape.test.ts`, which walks every outgoing request
payload and fails if `patient`, `patient_id`, `patientId` or `patient_name`
appears anywhere — including nested in `payload`.

---

## Two real defects this testing surfaced

Recorded because both were fixed in production code, not worked around:

1. **`symptoms` / `diagnosis` read as scalars.** They are `Table MultiSelect`
   child tables on this install, so the original projection returned nothing for
   them. Fixed in `patient_records._narrative`, which now collects the child rows
   and honours each field's `*_in_print` flag.

2. **The OTP rate limiter could not be cleared.** It was built on
   `frappe.cache().incr()`, which writes a bare integer that Frappe's
   pickle-based `get_value`/`delete_value` can neither read nor delete — so a
   patient who exhausted their hourly quota could only be unblocked by flushing
   the entire site cache. Rebuilt on `get_value`/`set_value(expires_in_sec=…)`
   and given an operator escape hatch,
   `patient_auth.clear_rate_limit(phone_number=…)`.

A third issue was environmental and is documented rather than fixed:
`bench run-tests` cannot run on this site because importing healthcare's test
modules pulls in `erpnext.tests.utils`, which builds master data at import time
and fails with `Could not find Parent Department: All Departments`. The suites
are run by loading the modules into `unittest` directly, which exercises exactly
the same code against the same database.

---

## Reproducing

```bash
# backend, all modules (131 tests)
bench --site clinic.localhost console <<'EOF'
exec(open('/home/fawwad/scripts/run_all_backend.py').read())
EOF

# HTTP suites (need the site served on :8000)
./env/bin/python /home/fawwad/scripts/test_otp_http.py
./env/bin/python /home/fawwad/scripts/test_records_http.py

# mobile
cd mobile && npx tsc --noEmit && npx jest
```

If a suite reports `RATE_LIMITED`, clear the counters first — the limits are
real and a previous run may have consumed them:

```bash
bench --site clinic.localhost execute \
  clinic_core.api.v1.patient_auth.clear_rate_limit \
  --kwargs "{'phone_number': '03451110001'}"
```
