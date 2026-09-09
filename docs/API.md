# API Reference — `clinic_core` v1

**Base URL (dev):** `http://localhost:8000`
**Path prefix:** `/api/method/clinic_core.api.v1.<module>.<function>`
**Transport:** HTTP POST with a JSON body (Frappe also accepts GET with query params).
**Auth:** session cookie (`sid`) or `Authorization: token <api_key>:<api_secret>` — see
`docs/03_AUTH_ARCHITECTURE.md`.

All 32 endpoints below are verified importable and whitelisted
(`bench --site clinic.localhost execute clinic_core.api.selftest.run` → 32/32).

---

## Response envelope

Frappe wraps whitelisted return values in a `message` key, so the wire format is:

**Success**
```json
{ "message": { "success": true, "data": { ... }, "message": null } }
```
**Error**
```json
{ "message": { "success": false, "data": null,
               "error": { "code": "FORBIDDEN",
                          "message": "You are not allowed to perform this action." } } }
```

### Error codes → HTTP status

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No valid session/token |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | Record does not exist (staff only — non-staff get 403 to prevent id enumeration) |
| `VALIDATION_ERROR` | 400 | Bad/missing input |
| `CONFLICT` | 409 | Slot already booked, invoice already paid, submitted doc immutable |
| `INTERNAL_ERROR` | 500 | Unexpected — traceback logged server-side, never returned |

**Never returned to clients:** stack traces, SQL, database credentials, internal field names
outside the documented response shape.

---

## Roles

| Persona | Frappe roles | Notes |
|---|---|---|
| Admin | `Healthcare Administrator`, `System Manager`, `Accounts Manager`, `Item Manager`, `Stock User` | `Item Manager` is **required** for billing — ERPNext's `get_item_details()` calls `item.check_permission()` |
| Reception | `Nursing User`, `Accounts User`, `Item Manager` | Marley ships **no** "Healthcare Receptionist" role |
| Doctor | `Physician` | |
| Patient | `Patient` | Lowest trust |

`STAFF` below = `Healthcare Administrator`, `Physician`, `Nursing User`
(+ `Accounts Manager`/`Accounts User` count as staff for patient *reach*, but **not** for
clinical content).

---

# AUTH

### `auth.login`
| | |
|---|---|
| **Path** | `/api/method/clinic_core.api.v1.auth.login` |
| **Auth** | none (guest allowed) |
| **Roles** | — |

**Request** `{ "usr": "doctor@test.local", "pwd": "TestPass123!" }`

**Response**
```json
{ "success": true,
  "data": { "user": "doctor@test.local", "full_name": "Test Doctor",
            "roles": ["Physician", "All", ...], "persona": "practitioner",
            "patient": null, "practitioner": "Dr Test Doctor", "sid": "..." },
  "message": "Logged in." }
```
**Validation:** both fields required.
**Errors:** `VALIDATION_ERROR` (missing field) · `UNAUTHENTICATED` (bad credentials — the
message is intentionally generic so accounts cannot be enumerated) · `FORBIDDEN` (login blocked).

```bash
curl -s -X POST http://localhost:8000/api/method/clinic_core.api.v1.auth.login \
  -H 'Content-Type: application/json' \
  -d '{"usr":"doctor@test.local","pwd":"TestPass123!"}'
```

### `auth.me`
Current user, roles, resolved `persona`, and linked `patient`/`practitioner` ids.
**Auth:** required. **Roles:** any. **Errors:** `UNAUTHENTICATED`.

> `persona`/`roles` are UI hints. Authorization is enforced per-endpoint server-side.

### `auth.logout`
Clears the server session. Mobile clients **must also** delete the stored token.

### `auth.session_valid`
`{ "valid": true, "user": "..." }` — cheap probe for app resume.

---

# PATIENTS

### `patients.list_patients`
| | |
|---|---|
| **Auth / Roles** | required / **STAFF** |

**Request** `{ "search": "Test", "limit": 20, "start": 0 }` (all optional; `limit` capped at 100)
**Response** `{ "items": [{name, patient_name, sex, dob, blood_group, mobile, email, status, creation}], "total": 2, "limit": 20, "start": 0 }`
Search matches `patient_name`, `mobile`, `email`, `name`.
**Errors:** `FORBIDDEN` (patients cannot list all patients).

### `patients.get_patient`
**Roles:** any authenticated. Omit `patient` to fetch your own record.
**Request** `{ "patient": "Test Patient A" }`
**Authorization:** `assert_patient_access` — a `Patient` caller may only read their **own**
record; staff may read any.
**Errors:** `FORBIDDEN` (someone else's record, or non-existent to a non-staff caller — the
same 403 either way, deliberately) · `NOT_FOUND` (staff only).

### `patients.create_patient` — **STAFF**
**Request** `{ "payload": { "first_name": "...", "sex": "Male", "dob": "1990-01-15", "mobile": "+92...", "email": "..." } }`
Allowed fields: `first_name, last_name, sex, dob, blood_group, mobile, email, phone` — anything
else is dropped.
**Response** includes `possible_duplicates` (same mobile) — surfaced, never auto-merged.
**Errors:** `VALIDATION_ERROR` (`first_name`/`sex` required) · `FORBIDDEN`.

### `patients.update_patient`
**Roles:** any authenticated; patients may update **only their own** contact details.
**Updatable fields (allowlist):** `mobile, email, phone, blood_group`.
`user_id`, `status` and `customer` are **not reachable via the API**, so a client cannot
re-link a patient to another user or escalate.

### `patients.visit_history`
Appointments + encounters for a patient, newest first. Ownership-guarded.

---

# PRACTITIONERS

| Endpoint | Roles | Purpose |
|---|---|---|
| `practitioners.list_practitioners` | any auth | Browse (needed to book). `user_id` deliberately omitted. |
| `practitioners.get_practitioner` | any auth | Detail + attached schedules |
| `practitioners.list_departments` | any auth | Medical departments |
| `practitioners.availability` | any auth | Configured weekly working pattern |

`availability` → `{ "practitioner": "...", "schedules": [{ "schedule": "Weekday 9to5", "slots": [{"day":"Monday","from_time":"09:00:00","to_time":"17:00:00"}, ...] }] }`

---

# APPOINTMENTS

### `appointments.available_slots`
**Request** `{ "practitioner": "Dr Test Doctor", "date": "2026-09-24" }`
**Response** `{ practitioner, date, available: true, slot_details: [...], fee_validity }`

Delegates to Marley's `get_availability_data()` — booking rules are **not** reimplemented.
When the practitioner is not available that day, returns `success: true` with
`available: false`, empty `slot_details` and an explanatory `message` (not an error — "nothing
free" is a valid answer).

> Requires a **Healthcare Service Unit** on the practitioner's schedule, else Marley returns
> *"does not have a Service Unit set against the Practitioner Schedule"*.
> `clinic_core.setup_masters.run` provisions this.

### `appointments.create_appointment`
**Roles:** `Healthcare Administrator`, `Nursing User`, `Physician`, `Patient`

```json
{ "payload": { "patient": "Test Patient A", "practitioner": "Dr Test Doctor",
               "appointment_date": "2026-09-24", "appointment_time": "10:00:00",
               "duration": 30 } }
```
Defaults filled server-side: `appointment_type` (`Consultation`), `appointment_for`
(`Practitioner`), `company`, `department`.

**A `Patient` caller may only book for themselves** — a client-supplied `patient` is ignored
and replaced with the caller's own record.

**Errors:** `CONFLICT` **(409)** — double-booking, from Marley's `OverlapError`. Marley also
rejects two appointments for the same patient on the same day. · `VALIDATION_ERROR` ·
`FORBIDDEN`.

### `appointments.list_appointments`
Filters: `patient`, `practitioner`, `status`, `from_date`, `to_date`, `limit`, `start`.
**Scoping is enforced server-side:** a `Patient` caller sees only their own appointments
regardless of the `patient` argument; a pure `Physician` defaults to their own calendar;
admin/reception see all.

### `appointments.get_appointment` / `reschedule_appointment` / `cancel_appointment`
Ownership-guarded. Reschedule re-runs overlap validation → may return `CONFLICT`.

### `appointments.set_status` — **STAFF**
Allowed values only: `Scheduled, Open, Closed, Cancelled, No Show, Checked In`.
Bound to `Patient Appointment`, saved through the ORM.

> Contrast with Marley's `set_request_status`, which takes an arbitrary `doctype`, checks
> nothing, and writes via `frappe.db.set_value` — see `docs/02_API_SECURITY_AUDIT.md` §2.

---

# ENCOUNTERS

### Clinical-notes policy
Symptoms, diagnoses and prescriptions are returned **only** to Administrator / System Manager /
Healthcare Administrator / Physician, **or the patient themselves**.
Reception receives `clinical_access: false` and the clinical keys are **omitted from the
payload entirely** — not hidden client-side.

| Endpoint | Roles |
|---|---|
| `encounters.list_encounters` | any auth (patients scoped to self) |
| `encounters.get_encounter` | any auth (ownership-guarded; clinical content gated) |
| `encounters.create_encounter` | `Physician`, `Healthcare Administrator` |
| `encounters.update_encounter` | `Physician`, `Healthcare Administrator` |
| `encounters.submit_encounter` | `Physician`, `Healthcare Administrator` |

**Create request**
```json
{ "payload": { "patient": "Test Patient A", "appointment": "HLC-APP-2026-00001",
               "symptoms": ["headache"], "diagnosis": ["tension headache"],
               "encounter_comment": "..." } }
```
`symptoms`/`diagnosis` accept a list **or** a comma-separated string. They are Marley
`Table MultiSelect` child tables; missing `Complaint`/`Diagnosis` masters are created on demand.
`appointment_type` is inherited from the linked appointment.

A practitioner may edit **only their own** encounters. Submitted encounters are immutable
(`CONFLICT`).

---

# INVOICES

| Endpoint | Roles |
|---|---|
| `invoices.list_invoices` | any auth (patients scoped to self) |
| `invoices.get_invoice` | any auth (ownership-guarded) |
| `invoices.create_consultation_invoice` | **BILLING** |
| `invoices.submit_invoice` | **BILLING** |
| `invoices.outstanding` | any auth (ownership-guarded) |

**BILLING** = `Healthcare Administrator`, `Accounts Manager`, `Accounts User`, `Nursing User`.

**Create**
```json
{ "payload": { "patient": "Test Patient A", "practitioner": "Dr Test Doctor",
               "rate": 1000, "submit": true } }
```
Omit `rate` to use the practitioner's `op_consulting_charge`. Creates the
`Consultation Charge` service Item on first use.

**`payment_status`** (normalised for clients): `draft` · `unpaid` · `partially_paid` · `paid` · `cancelled`

---

# PAYMENTS

### `payments.record_payment` — **BILLING**
```json
{ "payload": { "invoice": "ACC-SINV-2026-00001", "amount": 400,
               "mode_of_payment": "Cash", "reference_no": "..." } }
```
Omit `amount` to settle the full outstanding balance. Partial payments supported — ERPNext's
`get_payment_entry` keeps GL entries and party balances correct; we do not compute them.

**Response** `{ payment_entry, paid_amount, invoice, grand_total, outstanding_amount, invoice_status, fully_paid }`

**Errors:** `CONFLICT` (invoice not submitted, or already fully paid) ·
`VALIDATION_ERROR` (amount ≤ 0, or **exceeds outstanding** — overpayment is refused) ·
`FORBIDDEN` (patients cannot record payments).

### `payments.payment_history`
Ownership-guarded payment list for a patient.

---

## Verified billing lifecycle

Exercised end-to-end over HTTP by `scripts/e2e_scenario.py` (41/41 checks passing):

| Step | Result |
|---|---|
| Invoice created + submitted, total 1000 | `unpaid`, outstanding 1000 |
| Record payment 400 | `partially_paid`, outstanding 600 |
| Record payment 600 | `paid`, outstanding 0 |
| Attempt further payment of 100 | **rejected** |
