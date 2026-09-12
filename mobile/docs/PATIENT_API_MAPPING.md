# Patient API Mapping

Every screen → the endpoint behind it → what the server actually returns.
All paths are dotted: `/api/method/clinic_core.api.v1.<module>.<function>`.
(A slash after `v1` yields a bare `AttributeError` from Frappe — see
`docs/qa/04_BACKEND_API_AUDIT.md`.)

**The rule that governs this whole surface: the backend derives the patient from
`frappe.session.user`. No endpoint below accepts a patient identifier.**

---

## Auth

| screen | endpoint | notes |
|---|---|---|
| `(patient-auth)/phone` | `patient_auth.request_otp` | `{phone_number}` — any format |
| `(patient-auth)/otp` | `patient_auth.verify_otp` | `{phone_number, otp}` → `{sid, patient, needs_registration, …}` |
| `(patient-auth)/register` | `patient_auth.register` | `{payload:{full_name, gender, dob?, email?}}` |
| cold start | `patient_auth.session_valid` | `{valid, user, patient}` |
| profile → logout | `patient_auth.logout` | kills the session server-side |
| `profile/phone` | `patient_auth.request_phone_change` → `.confirm_phone_change` | code goes to the NEW number |

## Home

| screen | endpoint | returns |
|---|---|---|
| `(patient)/(tabs)/index` | `patient.home` | `{patient_id, patient_name, counts{upcoming, visits, outstanding, unpaid_invoices}, next_appointment, recent_visits[]}` |

Bundled into one call deliberately — a patient on mobile data should not pay
four round trips for one screen. Every number is computed server-side and scoped
to the caller.

## Profile

| screen | endpoint | notes |
|---|---|---|
| `(tabs)/profile` | `patient.me` | profile + counts + `login_phone`, `phone_verified_on` |
| `profile/edit` | `patient.update_me` | allowlist is **`email`, `phone` only** |
| — | `patient.emergency_contact` | reports `available:false` when the install has no such fields |

Not editable by the patient, by design: `patient_name`, `dob`, `sex`,
`blood_group`, `status`, `patient_id`, and `mobile` (the credential — see
PATIENT_AUTH.md §6). Fields outside the allowlist are dropped by `pick()`; a
request that names a *patient* is rejected outright.

## Appointments

| screen | endpoint | notes |
|---|---|---|
| `(tabs)/appointments` | `patient_appointments.list_appointments` | `{scope: upcoming\|past\|cancelled\|all}` — scope picks the TAB, not the patient |
| home hero | `patient_appointments.upcoming` | soonest live appointments |
| `appointment/[id]` | `patient_appointments.get_appointment` | adds `can_cancel`, `can_reschedule` |
| `appointment/new` | `patient_appointments.create` | `{payload:{practitioner, date, time, appointment_type?, reason?}}` |
| `appointment/[id]/reschedule` | `patient_appointments.reschedule` | `{appointment, date, time}` |
| detail → cancel | `patient_appointments.cancel` | `{appointment}` |

### Availability is shared with the guest flow

The booking screen reads `public.availability.slots` and
`public.availability.days` — the same server-side slot engine
(`clinic_core.api.v1.slots.compute_slots`) that the staff and guest flows use.
One calendar, one implementation; three clients cannot disagree about what is
free.

### Booking security chain

```
authenticated patient
  → guard.me()                       patient from the session, nothing else
  → reject_patient_override(payload)  a request naming a patient is REFUSED
  → practitioner exists and is Active
  → date not past, within 180 days
  → time must appear in the server's own slot list
  → live-appointment cap (5)
  → Marley validate_overlaps() on insert → 409 CONFLICT
```

## Records

| screen | endpoint | notes |
|---|---|---|
| `(tabs)/records` → Visits | `patient_records.visits` | completed appointments, with `encounter`/`has_record` where a note exists |
| `record/visit/[id]` | `patient_records.visit` | **patient-safe projection** — see below |
| → Prescriptions | `patient_records.prescriptions` | from `Drug Prescription` child rows |
| → Lab results | `patient_records.diagnostics` | `{enabled, items[]}` — optional module |
| `record/diagnostic/[id]` | `patient_records.diagnostic` | signed-off results only |
| tab counts | `patient_records.summary` | `{visits, records, prescriptions, diagnostics, diagnostics_enabled}` |

### The patient-safe projection

`patient_records.visit` **builds** its response from an allowlist. It never
serialises a `Patient Encounter`.

| returned | withheld |
|---|---|
| `encounter_date`, `encounter_time` | `clinical_notes` |
| `practitioner_name`, `medical_department` | `encounter_comment` |
| `symptoms[]`, `diagnosis[]` (honouring `*_in_print`) | `physical_examination` |
| `prescriptions[]` | `source`, `referring_practitioner` |
| `lab_requests[]` | `insurance_*`, `codification_table`, `invoiced` |

The withheld fields never enter the JSON, so they never cross the wire. Filtering
in React Native would leave them readable with any HTTP proxy.

`symptoms` and `diagnosis` come back as **arrays of strings**: on this install
they are `Table MultiSelect` child tables linking to the `Complaint` and
`Diagnosis` masters, not text fields. Marley pairs each with an `*_in_print`
flag (shipped defaults differ — `symptoms_in_print=0`, `diagnosis_in_print=1`),
which the projection consults per field rather than assuming.

Draft encounters (`docstatus 0`) are invisible everywhere: an unfinished
clinical note is not a record of anything yet.

## Billing

| screen | endpoint | notes |
|---|---|---|
| `(tabs)/billing` hero | `patient_billing.summary` | `{total_billed, total_paid, total_outstanding, unpaid_count, currency}` |
| invoice list | `patient_billing.invoices` | `{status: all\|unpaid\|paid\|partial}` |
| `invoice/[id]` | `patient_billing.invoice` | items + payments received |
| detail → share | `patient_billing.invoice_pdf` | base64 PDF for the native share sheet |

**Read-only by construction.** There is no write endpoint in this module. A
patient cannot mark an invoice paid, create a Payment Entry, or alter a total —
those are accounting acts performed by staff against evidence.

Draft invoices (`docstatus 0`) are never shown; a figure the clinic has not
committed to would read to a patient as a bill. Cancelled invoices are excluded
from balances.

`payment_status` uses the same vocabulary as the staff API
(`paid` / `partially_paid` / `unpaid` / `cancelled`) so both audiences resolve
through one colour map (`invoiceStatusTone`) and the same invoice can never
appear in two different colours.

---

## Endpoints a patient session must NOT reach

Verified to refuse or return nothing: `patients.list_patients`,
`appointments.*` (staff scope), `invoices.*`, `encounters.*`,
`practitioners.set_schedule` / `.block_time` / `.set_leave`, `payments.*`.

Marley's `Patient` role holds **zero DocPerms** on every clinical doctype on
this install, so a patient session cannot read anything through the ORM either —
`frappe.get_list("Patient Appointment")` as a patient returns nothing. Every
byte a patient sees comes through the scoped endpoints above.
