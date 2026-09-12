# FEATURE COVERAGE

**2026-09-10.** Classification per the audit scheme:

✅ COMPLETE · 🟡 MOSTLY COMPLETE · 🟠 PARTIAL · 🔴 BROKEN · ⚫ NOT IMPLEMENTED · 🎭 MOCK ONLY

**No feature in this project is 🎭 MOCK ONLY.** A full-project scan found zero fabricated
data — see `MOCK_DATA_AUDIT.md`.

---

## 1. Patient / client profiles — 94% ✅

| Sub-feature | Status | Score | Evidence |
|---|---|---:|---|
| Patient list | ✅ COMPLETE | 100 | 9 real patients, all roles |
| Patient search | 🟠 PARTIAL | 50 | Results correct; `total` unfiltered (BUG-02) |
| Create patient | ✅ COMPLETE | 100 | `QAMobile Patient` created + duplicate detection |
| Patient profile | ✅ COMPLETE | 100 | name, sex, dob, mobile, email, status |
| Contact information | ✅ COMPLETE | 100 | correct against backend |
| Edit contact info | ✅ COMPLETE | 100 | phone change persisted across a fresh session |
| Visit history | ✅ COMPLETE | 100 | real appointments + encounters |
| Clinical notes | ✅ COMPLETE | 100 | created, submitted, re-read, role-correct |
| Upcoming appointments | ✅ COMPLETE | 100 | via `visit_history` |
| Persistence | ✅ COMPLETE | 100 | verified from new sessions |
| Permissions | ✅ COMPLETE | 90 | guest 403; reception redacted |

## 2. Appointment system — 88% 🟡

| Sub-feature | Status | Score | Evidence |
|---|---|---:|---|
| Appointment list | ✅ COMPLETE | 100 | 26 records, scoped per role |
| Appointment details | ✅ COMPLETE | 90 | works; not horizontally scoped (BUG-03) |
| Create — backend | ✅ COMPLETE | 100 | `HLC-APP-2026-00042…00050` |
| **Create — mobile flow** | 🔴 **BROKEN** | **25** | **BUG-01** — screen renders, submit fails |
| **Reschedule** | 🔴 **BROKEN** | **40** | API works; mobile flow blocked by BUG-01 |
| Cancel | ✅ COMPLETE | 100 | status → `Cancelled` |
| Status updates | ✅ COMPLETE | 100 | Open / Closed / No Show |
| Admin calendar | ✅ COMPLETE | 90 | live feed; filters not exhaustively driven |
| Conflict protection | ✅ COMPLETE | 100 | **409** on staff and guest double-booking |
| Availability integration | ✅ COMPLETE | 100 | booked slots vanish, cancelled return |
| **Public booking** | ✅ COMPLETE | 100 | **full guest flow while logged out** |
| Role visibility | ✅ COMPLETE | 95 | doctor sees only own |
| Persistence | ✅ COMPLETE | 100 | survives fresh sessions |

Public booking is the strongest part of this requirement; staff booking is the weakest.

## 3. Doctor / staff availability — 98% ✅

| Sub-feature | Status | Score | Evidence |
|---|---|---:|---|
| Doctor list | ✅ COMPLETE | 100 | 2 practitioners + departments |
| Weekly schedule | ✅ COMPLETE | 100 | Mon–Fri 09:00–17:00 |
| Available slots | ✅ COMPLETE | 100 | server-computed discrete times |
| Unavailable periods | ✅ COMPLETE | 100 | block 11:00–12:00 → 16→14 slots |
| Booked-slot update | ✅ COMPLETE | 100 | staff and guest agree exactly |
| Leave handling | ✅ COMPLETE | 100 | full day → 0 slots, booking 409 |
| **Schedule editing** | ✅ COMPLETE | 100 | **write-capable, not read-only** |
| Role permission | ✅ COMPLETE | 85 | doctor↔doctor 403; reception broad (BUG-04) |
| Backend persistence | ✅ COMPLETE | 100 | shared-schedule fork verified |

Requirement 3 asks for availability **and scheduling**; both read and write exist, so full
marks are warranted here rather than the read-only cap.

## 4. Basic invoicing — 97% ✅

| Sub-feature | Status | Score | Evidence |
|---|---|---:|---|
| Invoice list | ✅ COMPLETE | 100 | 10 invoices, status filters |
| Invoice details | ✅ COMPLETE | 90 | works; detail not scoped (BUG-03) |
| Create invoice | ✅ COMPLETE | 100 | real `ACC-SINV-2026-00012` |
| Unpaid | ✅ COMPLETE | 100 | outstanding 3000 |
| Partially paid | ✅ COMPLETE | 100 | 1000 paid → `Partly Paid` |
| Paid | ✅ COMPLETE | 100 | outstanding 0 → `Paid` |
| Outstanding balance | ✅ COMPLETE | 100 | correct at each stage |
| Record payment | ✅ COMPLETE | 100 | real ERPNext Payment Entries |
| Share / send | 🟡 MOSTLY | 85 | PDF + email implemented; sheet not re-driven |
| Role permissions | ✅ COMPLETE | 95 | doctor 403 on list/pay/PDF |
| Persistence | ✅ COMPLETE | 100 | verified |

The share button is **not** an empty stub — `invoices.invoice_pdf` returns real `%PDF` bytes
and `email_invoice` exists. Marked 85 only because the native share sheet was not re-driven
in this run.

## 5. Role-based login — 89% 🟡

| Sub-feature | Status | Score | Evidence |
|---|---|---:|---|
| Admin login | ✅ COMPLETE | 100 | API **and** app UI |
| Receptionist login | ✅ COMPLETE | 100 | persona `reception` |
| Doctor login | ✅ COMPLETE | 100 | resolves to practitioner record |
| Role-specific home | ✅ COMPLETE | 100 | admin dashboard verified on device |
| Role-specific tabs | ✅ COMPLETE | 100 | doctor gets Activity, not Billing |
| Backend permissions | ✅ COMPLETE | 90 | list endpoints correct; detail gaps |
| Unauthorized blocked | ✅ COMPLETE | 95 | guest 403 everywhere |
| Logout | ✅ COMPLETE | 100 | |
| Session restore | ✅ COMPLETE | 100 | secure-store sid |
| **Session expiry** | ⬜ NOT TESTED | **0** | not exercised |

---

## Cross-cutting

| Area | Status | Notes |
|---|---|---|
| **Mock data** | ✅ NONE | zero fabricated data project-wide |
| Design system | ✅ COMPLETE | Poppins, warm bg, dark green, gold — verified on device |
| Navigation | ✅ COMPLETE | 34 routes, no orphans |
| Form validation | ✅ COMPLETE | zod + react-hook-form; inline errors seen on device |
| Error envelope | ✅ COMPLETE | 400/401/403/404/409 correct — except BUG-01's bare string |
| Loading states | ✅ COMPLETE | no white screens observed |
| Offline / network loss | ⬜ NOT TESTED | |
| Screen-size range | ⬜ PARTIAL | only Pixel 7 profile available |

## Count

| Classification | Count |
|---|---:|
| ✅ COMPLETE | 44 |
| 🟡 MOSTLY COMPLETE | 1 |
| 🟠 PARTIAL | 1 |
| 🔴 BROKEN | 2 |
| ⚫ NOT IMPLEMENTED | 0 |
| 🎭 MOCK ONLY | **0** |
| ⬜ NOT TESTED | 3 |

Both 🔴 items share the single root cause in BUG-01.
