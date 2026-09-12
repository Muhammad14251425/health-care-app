# Mock Data Status

## ✅ NO PRODUCTION SCREEN DEPENDS ON MOCK DATA.

Every screen renders from a live `clinic_core` endpoint. No screen ships with a
hardcoded patient, appointment, invoice, slot or status.

## Screen-by-screen

| Screen | Source | Mock? |
|---|---|---|
| Welcome | static copy only | no data |
| Login | `auth.login` | ❌ none |
| Home (all 3 roles) | `appointments.list_appointments`, `invoices.list_invoices` | ❌ none |
| Appointments | `appointments.list_appointments` | ❌ none |
| Appointment detail | `appointments.get_appointment` | ❌ none |
| New appointment | `patients.list_patients`, `practitioners.list_practitioners`, `appointments.available_slots` | ❌ none |
| Reschedule | `appointments.get_appointment` + slots | ❌ none |
| Calendar | `appointments.list_appointments`, `practitioners.list_practitioners` | ❌ none |
| Availability | `practitioners.availability` | ❌ none |
| Patients | `patients.list_patients` | ❌ none |
| Patient profile | `patients.get_patient`, `visit_history`, `invoices.outstanding` | ❌ none |
| Patient edit | `patients.get_patient` → `update_patient` | ❌ none |
| New patient | `patients.create_patient` | ❌ none |
| Visit history | `patients.visit_history` | ❌ none |
| Clinical notes | `encounters.list_encounters` | ❌ none |
| Encounter detail | `encounters.get_encounter` | ❌ none |
| New encounter | `encounters.create_encounter` | ❌ none |
| Billing | `invoices.list_invoices` | ❌ none |
| Invoice detail | `invoices.get_invoice`, `payments.record_payment` | ❌ none |
| New invoice | `invoices.create_consultation_invoice` | ❌ none |
| Activity | `appointments.list_appointments`, `encounters.list_encounters` | ❌ none |
| Profile | `auth.me`, dashboard queries | ❌ none |
| Booking 1–7 (public) | `public.*` | ❌ none |

## Static content that is not data

These are UI copy, not stand-ins for backend values:

* **Department icons** (`book/index.tsx`) — a name→icon map for the ~24 standard
  Marley departments, with a stethoscope fallback. Department **names** come from
  the backend; only the glyph is local.
* **Gender options** (`patient/new.tsx`) — Marley's seeded `Gender` values.
  Validated server-side against the real doctype on submit.
* **Appointment status transitions** (`appointment/[id]/index.tsx`) — which
  actions to offer from each status. Every target is inside the backend's
  `set_status` allowlist; the backend still enforces it.
* **Clinic name and help number** (`welcome.tsx`, `Logo.tsx`) — placeholder
  branding, no endpoint exists for it.
* **Calendar rail hours** (08:00–19:00) — the visible window of the timeline.
  Appointments are placed from real data.

## Test data

Any data you see in development comes from the backend's seeded synthetic
records (`Test Patient A/B`, `Dr Test Doctor`, `Test Clinic`). The app itself
contains **no** patient names, phone numbers or clinical content.

The mobile test suite constructs fixtures inline (`slots.test.ts`,
`permissions.test.ts`); those are unit-test inputs and never reach a screen.
