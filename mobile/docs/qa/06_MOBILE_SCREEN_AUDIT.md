# MOBILE SCREEN AUDIT

**2026-09-10.** 34 route files under `app/`. Expo Router file-based routing, three groups:
`(public)` (unauthenticated), `(app)` (authenticated), `(app)/(tabs)` (tab bar).

**Backend column** = does the screen read/write real `clinic_core` data.
**Mock** = hardcoded/fake data. **Verified** = exercised in this audit (API and/or emulator).

## Public — no authentication

| Screen | Route | Backend | Mock | Verified | Status |
|---|---|---|---|---|---|
| Entry redirect | `app/index.tsx` | session check | no | ✅ emulator | ✅ |
| Welcome | `(public)/welcome` | static | no | ✅ emulator | ✅ |
| Login | `(public)/login` | `auth.login` | no | ✅ emulator + API | ✅ |
| Book — department | `(public)/book/index` | `public.departments` | no | ✅ API | ✅ |
| Book — practitioner | `(public)/book/practitioner` | `public.practitioners` | no | ✅ API | ✅ |
| Book — date | `(public)/book/date` | `public.availability.days` | no | ✅ API | ✅ |
| Book — slot | `(public)/book/slot` | `public.availability.slots` | no | ✅ API | ✅ |
| Book — details | `(public)/book/details` | booking store | no | ✅ validation | ✅ |
| Book — confirm | `(public)/book/confirm` | `public.booking.create` | no | ✅ **created HLC-APP-2026-00041** | ✅ |
| Book — success | `(public)/book/success` | store | no | ✅ | ✅ |

Guest booking was completed end to end **while logged out** and the result is visible to
admin, reception and the correct doctor.

## Tabs — authenticated

| Screen | Route | Role | Backend | Mock | Verified | Status |
|---|---|---|---|---|---|---|
| Home / dashboard | `(tabs)/index` | all staff | `useDashboard` (multi-endpoint) | no | ✅ **emulator, live data** | ✅ |
| Appointments | `(tabs)/appointments` | all staff | `list_appointments` | no | ✅ API | ✅ |
| Patients | `(tabs)/patients` | all staff | `list_patients` | no | ✅ API | ⚠️ BUG-02 |
| Billing | `(tabs)/billing` | admin, reception | `list_invoices` | no | ✅ API | ✅ |
| Activity | `(tabs)/activity` | doctor | `list_encounters` | no | ✅ API | ✅ |
| Profile / Me | `(tabs)/profile` | all | `auth.me`, logout | no | ✅ emulator | ✅ |

Tab bar is role-driven (`src/utils/permissions.ts`): Doctor gets **Activity** instead of
**Billing**, matching the server's 403 on invoices.

## Detail & form screens

| Screen | Route | Backend | Mock | Verified | Status |
|---|---|---|---|---|---|
| Appointment detail | `(app)/appointment/[id]/index` | `get_appointment`, `set_status`, `cancel` | no | ✅ API | ✅ |
| **New appointment** | `(app)/appointment/new` | `bookable_slots` → `create_appointment` | no | ✅ API | ❌ **BUG-01** |
| **Reschedule** | `(app)/appointment/[id]/reschedule` | `bookable_slots` → `reschedule` | no | ✅ API | ❌ **BUG-01** |
| Calendar | `(app)/calendar/index` | `list_appointments` | no | ✅ API | ✅ |
| Availability | `(app)/availability/index` | `availability`, `set_schedule`, `block_time`, `set_leave`, `clear_unavailability` | no | ✅ API | ✅ |
| Patient profile | `(app)/patient/[id]/index` | `get_patient` | no | ✅ API | ✅ |
| Patient edit | `(app)/patient/[id]/edit` | `update_patient` | no | ✅ **persisted** | ✅ |
| Patient new | `(app)/patient/new` | `create_patient` | no | ✅ **created** | ✅ |
| Visit history | `(app)/patient/[id]/history` | `visit_history` | no | ✅ API | ✅ |
| Patient notes | `(app)/patient/[id]/notes` | `list_encounters` | no | ✅ API | ✅ |
| Encounter detail | `(app)/encounter/[id]` | `get_encounter` | no | ✅ API + redaction | ✅ |
| New encounter | `(app)/encounter/new` | `create_encounter`, `submit` | no | ✅ **created HLC-ENC-2026-00014** | ✅ |
| Invoice detail | `(app)/invoice/[id]` | `get_invoice`, `record_payment`, `invoice_pdf` | no | ✅ **full lifecycle** | ✅ |
| New invoice | `(app)/invoice/new` | `create_consultation_invoice` | no | ✅ **ACC-SINV-2026-00012** | ✅ |

**Two screens are blocked by BUG-01.** Both render their slot picker correctly, then fail on
submit because `bookable_slots` has already killed the session.

## Navigation

- 34 routes, all reachable; no orphans found.
- `(app)/_layout.tsx` guards the authenticated group and redirects to login when there is no
  session; `app/index.tsx` routes by session state on cold start.
- Emulator: welcome → login → dashboard traversed successfully with correct back behaviour.

## UI / UX (Android emulator, Pixel 7, 1080×2400)

Verified on screen, against the design reference:

| Item | Result |
|---|---|
| Poppins | ✅ throughout |
| Warm background / dark green / gold accent | ✅ exact |
| Cards, rounded corners, shadows | ✅ |
| Bottom tab bar, 5 tabs | ✅ correct icons + labels |
| Safe areas (status bar, gesture bar) | ✅ no clipping |
| Form validation | ✅ inline red message + red border ("Password is required") |
| Loading states | ✅ splash → content, no white flash |
| Text clipping / horizontal overflow | ✅ none seen |
| Touch targets | ✅ comfortably sized |

**Not covered:** small/large screen sizes (only the Pixel 7 profile was available in this
run), keyboard-overlap behaviour on every form, and pull-to-refresh on each tab. These are
recorded as untested rather than passing — see `02_TEST_RESULTS.md`.

## Mock data

**Zero.** A full-project scan for `mock|dummy|fake|sampleData|testData` and for hardcoded
domain arrays (`const patients = [...]` etc.) returned **no** fabricated data. The only
matches are the word "fake" in two design comments describing the reference mockup's phone
frame, plus a legitimate test file. Every data-bearing screen calls a real hook or API
module. See `MOCK_DATA_AUDIT.md`.
