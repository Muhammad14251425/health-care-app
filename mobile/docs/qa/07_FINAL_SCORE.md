# MOBILE CLINIC MVP AUDIT

**Date:** 2026-09-10
**Expo SDK:** 57.0.21 (React Native 0.86.3, Expo Router 57.0.20, NativeWind 4.2.6)
**Backend:** Frappe 16.33.1 · ERPNext 16.34.2 · Marley Health 16.5.2 · `clinic_core`
**Device tested:** Android emulator, Pixel 7, API 35, 1080×2400
**Method:** live API calls as 4 real accounts + app launched and driven on Android. No score
below is based on reading code alone.

---

> ## ⬆️ UPDATED AFTER FIXES — now **98%**, READY FOR FINAL QA
>
> All four bugs found in this audit were fixed the same day and verified
> (`09_FIXES_2026-09-10.md`). Revised scores:
>
> | Requirement | Was | Now |
> |---|---:|---:|
> | Patient Profiles | 94% | **100%** |
> | Appointments + Public Booking | 88% | **99%** |
> | Doctor Availability | 98% | **100%** |
> | Invoicing | 97% | **99%** |
> | Role-Based Login | 89% | **90%** |
> | **OVERALL** | **93%** | **98%** |
>
> Role-Based Login stays at 90% only because **session expiry is still untested**
> (scored 0, not known-broken). Tests: 96 backend · 74 mobile · tsc clean.
>
> The section below is the audit as first written, kept as the record of what was
> found before the fixes.

---

## EXECUTIVE RESULT (as audited, pre-fix)

# Overall completion: 93%

## MOSTLY COMPLETE (75–89%) → upper band, borderline READY FOR FINAL QA

The app is genuinely built, not a shell. **Zero mock data exists anywhere** — every screen is
wired to a live `clinic_core` endpoint, and this audit created real ERPNext/Marley records
through it: patients, appointments, a clinical encounter, an invoice and two payment entries.
Public booking works end-to-end **while logged out**, and the result is immediately visible to
admin, reception and the correct doctor. The full invoice lifecycle Unpaid → Partly Paid →
Paid was driven through real ERPNext Payment Entries.

**One P1 defect holds the score back.** `appointments.bookable_slots` destroys the caller's
staff session, which breaks staff appointment creation and reschedule from the mobile UI. It
is a single-function bug with an identified root cause and a small fix — but until it is
fixed, two core screens cannot complete their job.

---

## FINAL FEATURE TABLE

| Requirement | Coverage | Status | Main problem |
|---|---:|---|---|
| Patient Profiles | **94%** | ✅ COMPLETE | Search returns an unfiltered result count (BUG-02) |
| Appointments + Public Booking | **88%** | 🟡 MOSTLY COMPLETE | Staff create/reschedule blocked by BUG-01; guest booking flawless |
| Doctor Availability | **98%** | ✅ COMPLETE | Reception can edit any doctor's schedule (policy question) |
| Invoicing | **97%** | ✅ COMPLETE | Share sheet not re-driven this run |
| Role-Based Login | **89%** | 🟡 MOSTLY COMPLETE | Session expiry untested; detail endpoints not scoped |
| **OVERALL** | **93%** | 🟡 | One P1 blocks two screens |

Weighted: 18.80 + 21.92 + 14.75 + 19.45 + 17.70 = **92.6%**

---

## 1. Patient Profiles — 94%

| Feature | UI | API | E2E | Permission | Score |
|---|:--:|:--:|:--:|:--:|---:|
| Patient list | ✅ | ✅ | ✅ | ✅ | 100 |
| Search | ✅ | ✅ | ⚠️ | ✅ | **50** |
| Create patient | ✅ | ✅ | ✅ | ✅ | 100 |
| Patient profile | ✅ | ✅ | ✅ | ✅ | 100 |
| Contact info | ✅ | ✅ | ✅ | ✅ | 100 |
| Edit details | ✅ | ✅ | ✅ | ✅ | 100 |
| Visit history | ✅ | ✅ | ✅ | ✅ | 100 |
| Clinical notes | ✅ | ✅ | ✅ | ✅ | 100 |
| Persistence | — | ✅ | ✅ | — | 100 |
| Permissions | ✅ | ✅ | ✅ | ✅ | 90 |

Search scores 50 because results are correct but the count and pagination are driven by an
unfiltered `total` — the UI shows "12 registered" on a search returning 0 rows.

## 2. Appointments + Public Booking — 88%

| Feature | UI | API | E2E | Permission | Score |
|---|:--:|:--:|:--:|:--:|---:|
| List | ✅ | ✅ | ✅ | ✅ | 100 |
| Details | ✅ | ✅ | ✅ | ⚠️ | 90 |
| Create (API) | ✅ | ✅ | ✅ | ✅ | 100 |
| **Create (mobile flow)** | ✅ | ✅ | ❌ | ✅ | **25** |
| Calendar | ✅ | ✅ | ✅ | ✅ | 90 |
| **Reschedule** | ✅ | ✅ | ❌ | ✅ | **40** |
| Cancel | ✅ | ✅ | ✅ | ✅ | 100 |
| Statuses | ✅ | ✅ | ✅ | ✅ | 100 |
| Availability integration | ✅ | ✅ | ✅ | ✅ | 100 |
| Conflict prevention | ✅ | ✅ | ✅ | ✅ | 100 |
| **Public booking** | ✅ | ✅ | ✅ | ✅ | **100** |
| Role visibility | ✅ | ✅ | ✅ | ✅ | 95 |
| Persistence | — | ✅ | ✅ | — | 100 |

The split matters: the **backend** creates and reschedules appointments perfectly (verified
repeatedly, with 409 on conflict). It is the **mobile screen sequence** that fails, because it
loads slots first.

## 3. Doctor Availability — 98%

| Feature | UI | API | E2E | Permission | Score |
|---|:--:|:--:|:--:|:--:|---:|
| Doctor list | ✅ | ✅ | ✅ | ✅ | 100 |
| Weekly schedule | ✅ | ✅ | ✅ | ✅ | 100 |
| Available slots | ✅ | ✅ | ✅ | ✅ | 100 |
| Unavailable periods | ✅ | ✅ | ✅ | ✅ | 100 |
| Booked-slot update | ✅ | ✅ | ✅ | ✅ | 100 |
| Leave handling | ✅ | ✅ | ✅ | ✅ | 100 |
| **Schedule editing** | ✅ | ✅ | ✅ | ✅ | **100** |
| Role permission | ✅ | ✅ | ✅ | ⚠️ | 85 |
| Backend persistence | — | ✅ | ✅ | — | 100 |

This was the weakest area in the previous audit (58%) and is now the strongest. Schedule
editing is fully implemented and **write-capable**, not read-only: block time, leave, and
weekly-schedule edits all work and propagate to both staff and guest views.

## 4. Invoicing — 97%

| Feature | UI | API | E2E | Permission | Score |
|---|:--:|:--:|:--:|:--:|---:|
| Invoice list | ✅ | ✅ | ✅ | ✅ | 100 |
| Details | ✅ | ✅ | ✅ | ⚠️ | 90 |
| Create | ✅ | ✅ | ✅ | ✅ | 100 |
| Unpaid | ✅ | ✅ | ✅ | ✅ | 100 |
| Partially paid | ✅ | ✅ | ✅ | ✅ | 100 |
| Paid | ✅ | ✅ | ✅ | ✅ | 100 |
| Outstanding | ✅ | ✅ | ✅ | ✅ | 100 |
| Record payment | ✅ | ✅ | ✅ | ✅ | 100 |
| Share / send | ✅ | ✅ | ⚠️ | ✅ | 85 |
| Role permissions | ✅ | ✅ | ✅ | ✅ | 95 |
| Persistence | — | ✅ | ✅ | — | 100 |

Verified with real money movement: Rs 3,000 invoice → Rs 1,000 partial (`Partly Paid`,
outstanding 2,000) → Rs 2,000 (`Paid`, outstanding 0), backed by ERPNext Payment Entries
`ACC-PAY-2026-00022/00023`. Overpayment and double-payment are both correctly refused.

## 5. Role-Based Login — 89%

| Feature | UI | API | E2E | Permission | Score |
|---|:--:|:--:|:--:|:--:|---:|
| Admin login | ✅ | ✅ | ✅ | ✅ | 100 |
| Receptionist login | ✅ | ✅ | ✅ | ✅ | 100 |
| Doctor login | ✅ | ✅ | ✅ | ✅ | 100 |
| Role-specific home | ✅ | ✅ | ✅ | ✅ | 100 |
| Role-specific tabs | ✅ | ✅ | ✅ | ✅ | 100 |
| Backend permissions | ✅ | ✅ | ✅ | ⚠️ | 90 |
| Unauthorized requests blocked | ✅ | ✅ | ✅ | ✅ | 95 |
| Logout | ✅ | ✅ | ✅ | ✅ | 100 |
| Session restore | ✅ | ✅ | ✅ | ✅ | 100 |
| **Session expiry** | ⬜ | ⬜ | ⬜ | ⬜ | **0** |

Session expiry scores 0 because it was **not tested**, not because it is known broken.

---

# WHAT MUST BE FIXED NEXT

1. **P1 — `bookable_slots` destroys the staff session.** Staff appointment create and
   reschedule are unusable from the app. Root cause identified: `_elevated()` in
   `backend/clinic_core/api/v1/slots.py:37-53` calls `frappe.set_user()` and cannot restore
   session state. Fix: drop `_elevated()` and use `ignore_permissions=True` on the specific
   reads (the module already does this in 5 other places). Add a regression test that calls
   another endpoint *after* `bookable_slots` on the same session.
2. **P2 — Patient search `total` ignores the filter** (`patients.py:65`): pass `or_filters`
   to the count. Fixes both the wrong "12 registered" label and the wasted pagination request.
3. **P3 — Detail endpoints are not scoped.** Apply the existing scope helpers to
   `get_appointment` and `get_invoice`, as `get_encounter` already does.
4. **P3 — Decide reception's schedule authority.** Currently reception may edit any
   practitioner's schedule. Probably intended; make it explicit.
5. **P3 — Test session expiry** and backend-offline handling before release.

---

# FULLY WORKING FEATURES

Only items personally verified end-to-end in this audit:

✅ Admin / Receptionist / Doctor login — correct persona and roles each time
✅ Admin login **through the app UI**, dashboard rendering live backend data
✅ Wrong password and unknown user → 401 with an identical message (no user enumeration)
✅ Guest blocked (403) from patients, appointments, invoices, encounters and PDFs
✅ Patient list, server-side search, create, update — **persisted across a fresh session**
✅ Duplicate-patient detection on create
✅ Visit history with real appointments and encounters
✅ Clinical note created, submitted and re-read (`HLC-ENC-2026-00014`)
✅ Doctor↔doctor clinical isolation — 403, and 0 rows leaked in listings
✅ Reception clinical redaction — enforced **server-side**, fields stripped to null
✅ Reception blocked from creating clinical notes
✅ Appointment list with correct per-role scoping (26 / 26 / 25 / 1)
✅ Appointment create, reschedule, cancel, status transitions **via API**
✅ Double-booking rejected with **409** — staff and guest
✅ **Public booking end-to-end while logged out** (`HLC-APP-2026-00041`, `-00051`)
✅ Guest booking visible to admin, reception and the correct doctor — hidden from the other
✅ Booked slots disappear from availability; cancelled slots return
✅ Weekly schedule, block time, full-day leave — propagate to **both** staff and guest views
✅ Shared-schedule fork protects other practitioners
✅ Doctor cannot edit another doctor's schedule (403)
✅ Invoice create → Unpaid → Partly Paid → Paid with real ERPNext Payment Entries
✅ Overpayment (400) and double-payment (409) both refused
✅ Invoice PDF generation (real `%PDF` bytes); doctor correctly 403
✅ Doctor blocked from invoice list, payments and PDF export
✅ 80/80 backend tests · 74/74 mobile tests · tsc clean · expo-doctor 21/21

---

# UI EXISTS BUT FEATURE IS NOT COMPLETE

⚠️ **New Appointment screen** (`appointment/new`) — renders the slot picker correctly, then
fails on submit. The user sees *"You do not have permission to view this information."*, which
is wrong and misleading: they do have permission. (BUG-01)

⚠️ **Reschedule screen** (`appointment/[id]/reschedule`) — same cause, same symptom.

⚠️ **Patient search count** — the list is right, the number above it is not. (BUG-02)

Nothing else in this category. Notably **no screen anywhere is a mock-data facade** — a full
project scan found zero fabricated data.

---

# BACKEND GAPS

Very few. The backend is ahead of, not behind, the mobile app.

| Feature | Required endpoint | Current problem | Suggestion |
|---|---|---|---|
| Staff booking | `appointments.bookable_slots` | Exists and returns correct data, but destroys the session | Remove `_elevated()`; use `ignore_permissions=True` |
| Patient search count | `patients.list_patients` | `total` ignores `or_filters` | Pass `or_filters` to the count |
| Token auth | `auth.generate_token` | Not implemented; app uses session `sid` | Fine for now — documented, and a one-function swap |
| Detail scoping | `get_appointment`, `get_invoice` | No horizontal check | Reuse the existing scope helpers |

No feature was found where the mobile app is blocked by a *missing* backend capability.

---

## Evidence

Records created during this audit, all real and verifiable in the backend:

- Appointments `HLC-APP-2026-00041` … `HLC-APP-2026-00051`
- Patient `QAMobile Patient`
- Encounter `HLC-ENC-2026-00014`
- Invoice `ACC-SINV-2026-00012` (Rs 3,000, fully paid)
- Payment Entries `ACC-PAY-2026-00022`, `ACC-PAY-2026-00023`

Test unavailability rows created during scheduling tests were cleaned up (verified 0
remaining). Screenshots: `docs/qa/screenshots/r2_01…r2_05`.

## Trust note

The previous report (2026-09-09, 88%→92%) was **independently re-verified**, not assumed. Its
claimed fixes — cross-doctor clinical isolation, the unified server-side slot engine, invoice
share/PDF, the shared-schedule fork — all hold up under live testing. The BUG-01 regression is
new and was introduced by the very refactor that fixed the slot-parity problem: `_elevated()`
is the mechanism that made one shared slot engine possible for guests.
