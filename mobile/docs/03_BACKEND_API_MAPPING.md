# Backend API Mapping

Every network call the app makes. All paths are prefixed
`/api/method/clinic_core.api.v1.` — **all dots, no slashes**. A slash after `v1`
produces HTTP 417 and a bare `{"exc_type":"AttributeError"}`, which looks
exactly like a broken backend.

Transport is `POST` with a JSON body for every endpoint (Frappe also accepts GET
with query params; the client uses POST uniformly).

**Status legend:** ✅ Working (verified against the live backend) · ⚠️ Limitation · ❌ Broken

---

## Auth

| Mobile feature | Mobile function | Backend endpoint | Roles | Status |
|---|---|---|---|---|
| Sign in | `api/auth.login` | `auth.login` | guest | ✅ |
| Session restore | `api/auth.me` | `auth.me` | any auth | ✅ |
| Sign out | `api/auth.logout` | `auth.logout` | any auth | ✅ |
| Session probe | `api/auth.sessionValid` | `auth.session_valid` | any auth | ✅ |

## Patients

| Mobile feature | Mobile function | Backend endpoint | Roles | Status |
|---|---|---|---|---|
| Patient list / search | `api/patients.listPatients` | `patients.list_patients` | STAFF | ✅ |
| Patient profile | `api/patients.getPatient` | `patients.get_patient` | any auth (ownership-guarded) | ✅ |
| Register patient | `api/patients.createPatient` | `patients.create_patient` | STAFF | ✅ |
| Edit contact details | `api/patients.updatePatient` | `patients.update_patient` | any auth (own record only for patients) | ⚠️ only `mobile`, `email`, `phone`, `blood_group` are writable |
| Visit history | `api/patients.visitHistory` | `patients.visit_history` | any auth (ownership-guarded) | ✅ |

## Practitioners

| Mobile feature | Mobile function | Backend endpoint | Roles | Status |
|---|---|---|---|---|
| Doctor picker | `api/practitioners.listPractitioners` | `practitioners.list_practitioners` | any auth | ✅ |
| Doctor detail | `api/practitioners.getPractitioner` | `practitioners.get_practitioner` | any auth | ✅ |
| Department list | `api/practitioners.listDepartments` | `practitioners.list_departments` | any auth | ✅ |
| Availability screen | `api/practitioners.availability` | `practitioners.availability` | any auth | ✅ returns `can_manage` |
| Edit weekly hours | `api/practitioners.setSchedule` | `practitioners.set_schedule` | admin, reception, own doctor | ✅ replaces the whole pattern |
| Block part of a day | `api/practitioners.blockTime` | `practitioners.block_time` | admin, reception, own doctor | ✅ 409 if appointments exist |
| Add leave | `api/practitioners.setLeave` | `practitioners.set_leave` | admin, reception, own doctor | ✅ whole days |
| Remove leave / block | `api/practitioners.clearUnavailability` | `practitioners.clear_unavailability` | admin, reception, own doctor | ✅ |
| Leave list | `api/practitioners.unavailability` | `practitioners.unavailability` | any auth | ✅ |
| Staff slots | `api/appointments.bookableSlots` | `appointments.bookable_slots` | any staff | ✅ server-derived; same fn as guest flow |
| Staff date strip | `api/appointments.workingDays` | `appointments.working_days` | any staff | ✅ |

## Appointments

| Mobile feature | Mobile function | Backend endpoint | Roles | Status |
|---|---|---|---|---|
| Appointment list, dashboard, calendar | `api/appointments.listAppointments` | `appointments.list_appointments` | any auth (scoped server-side) | ✅ |
| Appointment detail | `api/appointments.getAppointment` | `appointments.get_appointment` | any auth (ownership-guarded) | ✅ |
| Slot lookup (staff) | `api/appointments.availableSlots` | `appointments.available_slots` | any auth | ⚠️ returns raw schedule windows, not slots — see below |
| Create appointment | `api/appointments.createAppointment` | `appointments.create_appointment` | Healthcare Administrator, Nursing User, Physician, Patient | ✅ 409 on conflict |
| Reschedule | `api/appointments.rescheduleAppointment` | `appointments.reschedule_appointment` | as above | ✅ 409 on conflict |
| Cancel | `api/appointments.cancelAppointment` | `appointments.cancel_appointment` | as above | ✅ |
| Check in / complete / no show | `api/appointments.setStatus` | `appointments.set_status` | STAFF | ✅ allowlist only |

### `available_slots` shape

It delegates to Marley's `get_availability_data()` and returns the practitioner's
**schedule windows**:

```json
{ "slot_details": [{ "avail_slot": [{ "day": "Thursday",
                                      "from_time": "9:00:00",
                                      "to_time": "17:00:00" }],
                     "appointments": [] }] }
```

Two consequences the app has to handle:

1. Times are **not zero-padded** (`9:00:00`), so string comparison against
   `09:00:00` fails. `utils/date.parseBackendTime` accepts both.
2. `appointments[]` is **service-unit scoped** and comes back empty for ordinary
   consultations — it cannot be used to grey out booked times. `hooks/useStaffSlots`
   therefore reads the day's appointments separately and subtracts them.

The derived list is advisory. `create_appointment` re-validates and returns
**409 CONFLICT**, which is the authority.

## Encounters (clinical)

| Mobile feature | Mobile function | Backend endpoint | Roles | Status |
|---|---|---|---|---|
| Notes list | `api/encounters.listEncounters` | `encounters.list_encounters` | any auth (see note) | ✅ |
| Note detail | `api/encounters.getEncounter` | `encounters.get_encounter` | any auth (content gated) | ✅ |
| Write note | `api/encounters.createEncounter` | `encounters.create_encounter` | Physician, Healthcare Administrator | ✅ |
| Edit note | `api/encounters.updateEncounter` | `encounters.update_encounter` | own encounters only | ✅ |
| Sign note | `api/encounters.submitEncounter` | `encounters.submit_encounter` | Physician, Healthcare Administrator | ✅ irreversible |

> **Verified, not assumed:** a live probe showed **Healthcare Administrator and
> Nursing User both receive 403** from `list_encounters` (no `Patient Encounter`
> permission). Only Physician succeeds. The app gates clinical UI on the
> Physician role accordingly.
>
> When a caller lacks clinical access the backend **omits** `symptoms`,
> `diagnosis` and `encounter_comment` from the payload entirely and sets
> `clinical_access: false` — it does not blank them client-side.

## Invoices

| Mobile feature | Mobile function | Backend endpoint | Roles | Status |
|---|---|---|---|---|
| Billing list | `api/invoices.listInvoices` | `invoices.list_invoices` | any auth (scoped) | ✅ |
| Invoice detail | `api/invoices.getInvoice` | `invoices.get_invoice` | any auth (ownership-guarded) | ✅ |
| Create invoice | `api/invoices.createConsultationInvoice` | `invoices.create_consultation_invoice` | BILLING | ✅ |
| Submit invoice | `api/invoices.submitInvoice` | `invoices.submit_invoice` | BILLING | ✅ |
| Outstanding totals | `api/invoices.outstanding` | `invoices.outstanding` | any auth (ownership-guarded) | ✅ |

> **Verified:** a pure **Physician gets 403** from every invoice endpoint (no
> `Sales Invoice` permission). This is why doctors see an **Activity** tab where
> admin and reception see **Billing**.

BILLING = Healthcare Administrator, Accounts Manager, Accounts User, Nursing User.

## Payments

| Mobile feature | Mobile function | Backend endpoint | Roles | Status |
|---|---|---|---|---|
| Record payment | `api/payments.recordPayment` | `payments.record_payment` | BILLING | ✅ partial supported, overpayment refused |
| Payment history | `api/payments.paymentHistory` | `payments.payment_history` | any auth (ownership-guarded) | ✅ |

## Public booking (guest — no session)

Added to `clinic_core` as part of this work; see `BACKEND_CHANGES.md`.

| Mobile feature | Mobile function | Backend endpoint | Roles | Status |
|---|---|---|---|---|
| Step 1 departments | `api/publicBooking.listDepartments` | `public.departments.list_departments` | guest | ✅ |
| Step 2 doctors | `api/publicBooking.listPractitioners` | `public.practitioners.list_practitioners` | guest | ✅ |
| Doctor detail | `api/publicBooking.getPractitioner` | `public.practitioners.get_practitioner` | guest | ✅ |
| Step 3 dates | `api/publicBooking.availableDays` | `public.availability.days` | guest | ✅ |
| Step 4 times | `api/publicBooking.availableSlots` | `public.availability.slots` | guest | ✅ discrete slots, derived server-side |
| Step 6 submit | `api/publicBooking.createBooking` | `public.booking.create` | guest | ✅ 409 on conflict |
| Appointment types | `api/publicBooking.appointmentTypes` | `public.booking.appointment_types` | guest | ✅ |

Guest endpoints are rate limited per IP (60/min reads, 5 per 10 min for
bookings) and return `RATE_LIMITED` (HTTP 429) when exceeded.

---

## Response envelope

```jsonc
// success
{ "message": { "success": true, "data": { }, "message": null } }
// failure
{ "message": { "success": false, "data": null,
               "error": { "code": "FORBIDDEN", "message": "…" } } }
```

`api/client.ts` unwraps this and throws `ApiError`; screens never see the raw shape.

| Code | HTTP | App behaviour |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Clear session once, redirect to login. Never retried. |
| `FORBIDDEN` | 403 | Permission message, no Retry button offered. |
| `NOT_FOUND` | 404 | "We could not find what you were looking for." |
| `VALIDATION_ERROR` | 400 | Field-level message surfaced. |
| `CONFLICT` | 409 | Refresh slots and ask the user to pick again. |
| `RATE_LIMITED` | 429 | "Please wait a moment and try again." |
| `INTERNAL_ERROR` | 500 | Generic retry. Server message suppressed. |
| `NETWORK_ERROR` / `TIMEOUT` | — | Client-side; offline state with Retry. |

Server messages are only displayed after passing a safety filter that rejects
HTML, tracebacks, SQL and framework internals (`api/errors.ts`).
