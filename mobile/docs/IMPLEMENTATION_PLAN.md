# Implementation Plan — Clinic Mobile (Expo SDK 54)

**Written before implementation, after inspecting the backend and both design references.**
Date: 2026-09-09

---

## 1. What was inspected first

| Source | Finding |
|---|---|
| `docs/API.md`, `FINAL_BACKEND_STATUS.md` | 32 staff endpoints, documented envelope + error codes |
| Live backend (`localhost:8000`) | Probed every module with real credentials — shapes confirmed |
| `baobab_html_css_clone_poppins.html` | Design tokens, spacing, radii, type scale |
| Reference image (6 screens) | Layout, density, hierarchy, bottom nav treatment |
| `clinic_core` source in WSL | Decorator patterns, guards, response helpers |

### Verified live behaviour that changed the plan

1. **The real permission matrix is not a hierarchy.** Probed, not assumed:

   | Persona | Encounters | Invoices |
   |---|---|---|
   | `admin` | **403** | ✅ |
   | `practitioner` (doctor) | ✅ | **403** |
   | `reception` | **403** | ✅ |

   Consequence: the Doctor tab bar shows **Activity**, not Billing (the spec
   anticipated this). Admin is *not* a superset — it cannot read clinical notes.

2. **`available_slots` returns raw Marley schedule windows**, e.g.
   `{day: "Thursday", from_time: "9:00:00", to_time: "17:00:00"}` plus a
   `service_unit`-scoped `appointments` array that is **empty for ordinary
   consultations**. It is not a list of bookable times.

3. **Public booking was impossible.** Only `auth.login` allowed guests. Every
   endpoint the booking flow needs returned `PermissionError` to a guest.

---

## 2. Backend work completed (unblocking public booking)

Approved explicitly. Added `clinic_core/api/v1/public/` — a separate, narrow
guest surface. **No staff endpoint was weakened.**

| Endpoint | Purpose |
|---|---|
| `public.departments.list_departments` | Departments that actually have a bookable doctor |
| `public.practitioners.list_practitioners` | Bookable doctors (no `user_id`, no contacts) |
| `public.practitioners.get_practitioner` | One doctor, same restricted fields |
| `public.availability.days` | Which of the next N days the doctor works |
| `public.availability.slots` | **Discrete** bookable times, server-derived |
| `public.booking.create` | The single guest write |
| `public.booking.appointment_types` | Selectable appointment types |

**Protections:** per-IP rate limiting (60/min reads, 5/10min bookings), strict
field validation, server-side patient match/create, slot re-check before insert,
Marley's `OverlapError` → 409, per-phone cap on upcoming appointments, and a
response that leaks no internal ids.

**Bugs found and fixed while testing this** (each caught by a failing test):

- `distinct <field> as <alias>` is rejected by Frappe v16's SELECT parser.
- `default_duration` lives on **Appointment Type**, not Healthcare Practitioner.
- Patient Appointment has **no phone column** in Marley 16.
- Marley's slot `appointments` array is service-unit scoped and unusable for
  conflict display — booked times must be read directly.
- **Security:** Marley invites every new Patient as a portal **User** by default.
  On an anonymous form that is a User-creation endpoint. Now `invite_user = 0`,
  with a regression test.

**Tests:** 28/28 passing in `clinic_core/tests/test_public_booking.py`, covering
all ten required scenarios. Full suite still green (41/41 E2E, 9 security).

---

## 3. Design system extraction

Tokens taken from the supplied HTML, not invented:

```
bg #F3F2ED   ink #10110F   muted #73756F   card #FFFFFF
green #124F3D   green2 #1F6A53   line #EBE9E2
gold #F4BF52   peach #F8DDC7   mint #E8EFE7   paleYellow #F8ECC2   brown #965C33
```

Added, staying inside the palette's temperature: a muted warm red for errors
(`#AD4F49`, taken from the reference's own `.logout` colour) and the dark green
for success.

**Proportions** measured from the reference (which renders at 300px wide) and
scaled to real device widths rather than copied literally: card radius 14–18,
tile radius 11–13, hero radius 17, pill radius 999, nav radius 16.

Typography: Poppins 400/500/600/700/800. The reference uses weight 850 for
headings — not a real Poppins weight, so headings use 800 with tight tracking
(`-0.9` on display, `-0.3` on section titles) to match the visual density.

---

## 4. Screen → data mapping (no screen ships on mock data)

| Screen | Endpoint(s) | Role |
|---|---|---|
| Login | `auth.login`, `auth.me` | all |
| Home (Admin) | `appointments.list_appointments`, `invoices.outstanding` | admin |
| Home (Doctor) | `appointments.list_appointments` (own), `encounters.list_encounters` | doctor |
| Home (Reception) | `appointments.list_appointments`, `invoices.list_invoices` | reception |
| Appointments | `appointments.list_appointments` + filters | all |
| Appointment detail | `appointments.get_appointment`, `set_status`, `cancel` | staff |
| New appointment | `available_slots` → `create_appointment` | staff |
| Reschedule | `reschedule_appointment` | staff |
| Calendar | `list_appointments` (date range) | staff |
| Availability | `practitioners.availability` | staff |
| Patients | `patients.list_patients` (search, paged) | staff |
| Patient profile | `get_patient`, `visit_history`, `invoices.outstanding` | staff |
| Clinical notes | `encounters.*` | **doctor only** |
| Billing | `invoices.list_invoices`, `outstanding` | admin/reception |
| Invoice detail | `get_invoice`, `payments.record_payment` | admin/reception |
| Public booking | `public.*` | guest |

---

## 5. Build order

1. **Foundation** — theme, NativeWind, Poppins, API client, auth, components
2. **Auth** — welcome, login, session restore, role resolution
3. **Home** — three role dashboards
4. **Appointments** — list, detail, create, reschedule, cancel, calendar, availability
5. **Patients** — list, search, profile, create, history, notes
6. **Doctor workflow** — encounters
7. **Billing** — invoices, detail, create, payments
8. **Public booking** — the 7-step flow against the new guest API
9. **Profile** — settings, logout
10. **Verification** — expo-doctor, tsc, lint, tests, Android run

---

## 5a. SDK change during the build

The plan targeted **Expo SDK 54** as the brief required, and the app was built
and fully verified on it (expo-doctor 18/18, clean typecheck, Android bundle).

It was then **upgraded to SDK 57 at the user's explicit request**: the Expo Go
on the test device is an SDK 57 build, and Expo Go supports one SDK at a time.
Versions came from SDK 57's own `bundledNativeModules.json` rather than being
guessed. Details and the revert path are in `06_KNOWN_LIMITATIONS.md` §12.

---

## 6. Known constraints carried into the build

- **Token auth is not implemented backend-side.** `auth.generate_token` does not
  exist; `auth.login` returns a session `sid`. The app stores the `sid` in
  `expo-secure-store` and sends it as a cookie. The API client is written so
  swapping to `Authorization: token …` is a one-line change.
- **No TLS in dev.** Plain HTTP against `10.0.2.2:8000` (Android emulator).
  Must not carry real patient data.
- **Concurrency.** Double-booking is proven sequentially; a true parallel race
  is untested upstream (Marley reads then validates).
