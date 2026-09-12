# BASELINE STATUS

**Audit date:** 2026-09-10
**Type:** Independent re-verification baseline (Phase 0 — audit only, no feature code changed)
**Verdict:** **93% — MOSTLY COMPLETE**, one P1 blocking two screens

## What was done

A full baseline audit against a **running** system, not a code read:

- Backend live at `http://localhost:8000` (Frappe 16.33.1 · ERPNext 16.34.2 · Marley 16.5.2)
- 4 real accounts driven through the API (admin, reception, doctor, doctor 2) + guest
- Mobile app launched on an Android emulator via Expo Go and signed into as Admin
- Real records created, mutated and re-read to prove persistence
- Every role restriction tested **against the server**, not by looking at hidden buttons

## Result summary

| Requirement | Score | Status |
|---|---:|---|
| Patient profiles | 94% | ✅ |
| Appointments + public booking | 88% | 🟡 |
| Doctor availability | 98% | ✅ |
| Invoicing | 97% | ✅ |
| Role-based login | 89% | 🟡 |
| **Overall** | **93%** | 🟡 |

## Headline findings

**The app is real.** Zero mock data anywhere in the project. Every screen is bound to a live
`clinic_core` endpoint, and the audit created genuine ERPNext/Marley records through the API:
appointments `HLC-APP-2026-00041…51`, patient `QAMobile Patient`, encounter
`HLC-ENC-2026-00014`, invoice `ACC-SINV-2026-00012`, payment entries `ACC-PAY-2026-00022/23`.

**One P1 defect.** `appointments.bookable_slots` destroys the caller's staff session — every
subsequent request returns `403 "No App"` until re-login. Because the New Appointment and
Reschedule screens load slots before submitting, **staff booking and reschedule cannot
complete from the mobile UI**. Root cause identified (`slots.py:37-53`, `frappe.set_user()`),
fix is small. Guest/public booking is unaffected.

**Security posture is solid.** Guests are locked out of every protected endpoint (403).
Doctor↔doctor clinical isolation is real. Reception's clinical redaction is enforced
server-side, with fields stripped to null — not merely hidden in the UI. Doctors are blocked
from billing. Login gives no user enumeration.

**Availability went from the weakest area to the strongest** (58% → 98%): schedule editing,
block time and leave are fully implemented and write-capable, propagating identically to staff
and guest views.

## Build health

| Check | Result |
|---|---|
| `npx expo-doctor` | ✅ 21/21 |
| `npx tsc --noEmit` | ✅ clean |
| `npx jest` | ✅ 74/74 |
| `bench run-tests --app clinic_core` | ✅ 80/80 |
| Android launch | ✅ rendered, admin signed in |

## Note on Expo SDK

The brief specifies SDK 54; the project runs **SDK 57**. This is a deliberate, documented
upgrade (`docs/06_KNOWN_LIMITATIONS.md`) and expo-doctor is fully green on it. Not treated as
a defect.

## Phase 0 compliance

No production feature code was modified. The only writes were test data through public APIs,
and test unavailability rows were cleaned up afterwards (verified 0 remaining). Documents in
this folder were rewritten with re-verified results.

## Documents

| File | Contents |
|---|---|
| `00_BASELINE_STATUS.md` | This summary |
| `01_FEATURE_COVERAGE.md` | Feature-by-feature classification |
| `02_TEST_RESULTS.md` | Every test run, incl. what was **not** tested |
| `03_BUGS.md` | 4 open bugs with repro steps and identified causes |
| `04_BACKEND_API_AUDIT.md` | All 41 endpoints, live results |
| `05_ROLE_PERMISSION_MATRIX.md` | Verified permission matrix |
| `06_MOBILE_SCREEN_AUDIT.md` | All 34 routes |
| `MOCK_DATA_AUDIT.md` | Proof of zero mock data |
| `07_FINAL_SCORE.md` | Scores, priority fixes, backend gaps |
| `08_FIXES_APPLIED.md` | Prior (2026-09-09) fix record — re-verified, still valid |
