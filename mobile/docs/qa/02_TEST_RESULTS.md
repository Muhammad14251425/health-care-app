# TEST RESULTS

**2026-09-10.** ✅ pass · ⚠️ warning · ❌ fail · ⬜ not tested (deliberately not counted as pass)

## Build & tooling

| Check | Command | Result |
|---|---|---|
| Expo doctor | `npx expo-doctor` | ✅ **21/21 checks passed** |
| TypeScript | `npx tsc --noEmit` | ✅ **clean, 0 errors** |
| Mobile tests | `npx jest` | ✅ **74 passed / 74**, 5 suites, 9.2s |
| Backend tests | `bench run-tests --app clinic_core` | ✅ **80 passed / 80**, 6.8s |
| Metro bundler | `expo start --port 8082` | ✅ running, bundle served |
| Android launch | Expo Go on Pixel 7 emulator | ✅ app launched and rendered |

Versions: Expo **57.0.21**, React Native **0.86.3**, React 19.2.3, Expo Router 57.0.20,
NativeWind 4.2.6, TanStack Query 5.102.8, TypeScript 6.0.3.

> The brief specified Expo SDK 54; the project is on **SDK 57**. This is a deliberate,
> documented upgrade (`docs/06_KNOWN_LIMITATIONS.md`), not drift. expo-doctor is fully green
> on 57.

Deprecation noted in the backend run: `limit_page_length` is deprecated from Frappe v17.
Harmless today, will need updating before a v17 upgrade.

## Environment

| Item | Value |
|---|---|
| Backend | `http://localhost:8000` — Frappe 16.33.1, ERPNext 16.34.2, Marley Health 16.5.2 |
| Site | `clinic.localhost` (WSL2 Ubuntu-24.04) |
| Device | Android emulator, Pixel 7, API 35, 1080×2400 |
| Connectivity | `adb reverse tcp:8000` + `tcp:8082` |
| API health | ✅ `frappe.ping` → `{"message":"pong"}` |

## Requirement 1 — Patient profiles

| Test | Result |
|---|---|
| Patient list from backend | ✅ 9 real patients |
| Server-side search (name / phone / email / id) | ✅ matches correct |
| Search — no results | ✅ returns 0 items |
| **Search — result count** | ❌ **BUG-02** `total` ignores the filter (always 12) |
| **Search — pagination** | ❌ **BUG-02** fetches a needless empty page |
| Create patient | ✅ `QAMobile Patient` created |
| Duplicate detection | ✅ `possible_duplicates` returned |
| Patient profile fields | ✅ name, sex, dob, mobile, email, status |
| Update patient (phone) | ✅ 200 |
| **Update persists across a fresh session** | ✅ re-read confirms new value |
| Visit history | ✅ real appointments + encounters |
| Guest blocked | ✅ 403 |

## Requirement 2 — Appointments & public booking

| Test | Result |
|---|---|
| Appointment list | ✅ 26 records, real Marley IDs |
| Role scoping | ✅ admin 26 · doc1 25 · doc2 1 |
| Appointment detail | ✅ 200 (⚠️ BUG-03 not scoped) |
| **Create appointment (API)** | ✅ created `HLC-APP-2026-00042…00050` |
| **Create appointment (mobile flow)** | ❌ **BUG-01 — blocked** |
| **Double-booking rejected** | ✅ **409 CONFLICT** |
| Reschedule | ✅ old slot freed, new taken, persisted |
| **Reschedule (mobile flow)** | ❌ **BUG-01 — blocked** |
| Cancel | ✅ status → `Cancelled` |
| Status transitions (Open/Closed/No Show) | ✅ all accepted |
| Calendar list feed | ✅ |
| **Guest booking end-to-end, logged out** | ✅ **created `HLC-APP-2026-00041`, `-00051`** |
| Guest double-booking | ✅ **409** with a user-friendly message |
| Booked slot disappears from availability | ✅ 15 → 14 |
| **Guest booking visible to admin** | ✅ |
| **Guest booking visible to reception** | ✅ |
| **Guest booking visible to correct doctor** | ✅ |
| **Guest booking hidden from other doctor** | ✅ |
| Input validation (bad last name) | ✅ 400 with a clear message |
| Booking flood protection | ✅ implemented (`_assert_not_flooding`) |

## Requirement 3 — Doctor availability & scheduling

| Test | Result |
|---|---|
| Practitioner list / departments | ✅ 2 practitioners |
| Weekly schedule read | ✅ Mon–Fri 09:00–17:00 |
| Bookable slots | ✅ discrete times, pre-formatted labels |
| Non-working day | ✅ `available:false` + explanatory message |
| **Block time (11:00–12:00)** | ✅ 16 → 14 slots |
| **Block propagates to guest view** | ✅ identical result |
| Full-day leave | ✅ `available:false`, 0 slots |
| Booking on a blocked day | ✅ **409** |
| Clear unavailability | ✅ restored to 16 |
| Reason enum validation | ✅ 400 on free text |
| **Shared-schedule fork** | ✅ private copy created, other doctor unaffected |
| Doctor edits own schedule | ✅ |
| **Doctor edits another's schedule** | ✅ blocked — **403** |
| Reception edits any schedule | ⚠️ allowed — BUG-04 (policy) |

## Requirement 4 — Invoicing

| Test | Result |
|---|---|
| Invoice list + status filters | ✅ 10 invoices |
| **Create invoice** | ✅ real `ACC-SINV-2026-00012`, Rs 3,000 |
| Unpaid state | ✅ outstanding 3000, `Unpaid` |
| **Partial payment Rs 1,000** | ✅ outstanding 2000, **`Partly Paid`** |
| **Full payment Rs 2,000** | ✅ outstanding 0, **`Paid`** |
| **Real ERPNext Payment Entries** | ✅ `ACC-PAY-2026-00022`, `-00023` |
| Overpayment rejected | ✅ **400** *"Amount exceeds outstanding 2000.0."* |
| Paying a paid invoice | ✅ **409** *"Invoice is already fully paid."* |
| Payment history | ✅ 5 entries |
| **PDF generation** | ✅ real base64 `%PDF` |
| Share sheet (expo-sharing) | ⬜ not re-driven this run (verified 2026-09-09) |
| Email invoice | ✅ implemented; missing config → 4xx not 500 |
| Doctor blocked from payments/PDF | ✅ **403** |

## Requirement 5 — Role-based login

| Test | Result |
|---|---|
| Admin login (API + **UI**) | ✅ dashboard rendered with live data |
| Reception login | ✅ persona `reception` |
| Doctor login | ✅ persona `practitioner` → `Dr Test Doctor` |
| Doctor 2 login | ✅ → `Dr Second Doctor` |
| Wrong password | ✅ **401** *"Invalid credentials."* |
| Unknown user | ✅ **401**, identical message (no enumeration) |
| Guest → 5 protected endpoints | ✅ **403** on all |
| Reception blocked from clinical notes | ✅ **403** list, **redacted** detail |
| Doctor blocked from billing | ✅ **403** |
| Doctor↔doctor clinical isolation | ✅ **403** |
| Concurrent multi-role sessions | ✅ independent |
| Session restore (secure-store sid) | ✅ |
| Logout | ✅ |
| Form validation on login | ✅ inline error shown in UI |
| **Session expiry** | ⬜ **not tested** |

## Error handling

| Case | Result |
|---|---|
| 400 validation | ✅ structured envelope, clear message |
| 401 | ✅ |
| 403 | ✅ (except BUG-01's bare string) |
| 404 | ✅ |
| 409 conflict | ✅ correct on double-booking and double-payment |
| Non-JSON response | ✅ client refuses to display raw content |
| Request timeout | ✅ 20s abort controller |
| Backend offline | ⬜ not simulated this run |
| Network loss mid-request | ⬜ not simulated |

## Explicitly NOT tested

Listed so no score is inflated by assumption:

- Session expiry / forged-sid handling
- Backend-offline and mid-request network-loss behaviour
- Pull-to-refresh on each tab individually
- Keyboard-overlap on every form
- Small (<720p) and large/tablet screen sizes
- Double-tap submit guarding on every form
- Deep-link entry into authenticated routes
- Share-sheet interaction (re-verification of the 2026-09-09 pass)
