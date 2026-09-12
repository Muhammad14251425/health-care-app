# ROLE & PERMISSION MATRIX — verified live

**2026-09-10.** Every cell was produced by a real API call as that role. Hidden UI buttons
were **not** accepted as evidence — each restriction was tested against the server directly.

## Accounts

| Persona | Account | `persona` | Frappe roles |
|---|---|---|---|
| Admin | `admin.clinic@test.local` | `admin` | Healthcare Administrator, Accounts Manager, System Manager, Item Manager, Stock User |
| Receptionist | `reception@test.local` | `reception` | Nursing User, Accounts User, Item Manager |
| Doctor | `doctor@test.local` | `practitioner` | Physician → `Dr Test Doctor` |
| Doctor 2 | `doctor2@test.local` | `practitioner` | Physician → `Dr Second Doctor` |
| Guest | *(none)* | — | — |

Marley/ERPNext ship **no** "Healthcare Receptionist" role. The receptionist persona uses
`Nursing User` and is deliberately **not** given `Physician`; `clinic_core` hardens the rest
at the API layer.

## Master matrix

✅ allowed · ⛔ blocked server-side · 🔒 allowed but redacted · ⚠️ allowed but shouldn't be

| Capability | Admin | Reception | Doctor | Doctor 2 | Guest |
|---|:--:|:--:|:--:|:--:|:--:|
| Log in | ✅ | ✅ | ✅ | ✅ | — |
| Patient list / search | ✅ 9 | ✅ 9 | ✅ 9 | ✅ 9 | ⛔ 403 |
| Create / update patient | ✅ | ✅ | ✅ | ✅ | ⛔ 403 |
| Visit history | ✅ | ✅ | ✅ | ✅ | ⛔ 403 |
| Appointment list | ✅ 26 | ✅ 26 | ✅ **25** | ✅ **1** | ⛔ 403 |
| Appointment detail | ✅ | ✅ | ✅ | ⚠️ 200 | ⛔ 403 |
| Create / reschedule / cancel | ✅ | ✅ | ✅ | ✅ | — |
| **Clinical notes — list** | ✅ 12 | ⛔ **403** | ✅ 12 | ✅ **0** | ⛔ 403 |
| **Clinical notes — read** | ✅ | 🔒 **redacted** | ✅ | ⛔ **403** | ⛔ 403 |
| **Clinical notes — create** | ✅ | ⛔ **403** | ✅ | ✅ own | ⛔ 403 |
| Invoice list | ✅ 10 | ✅ 10 | ⛔ **403** | ⛔ 403 | ⛔ 403 |
| Invoice detail | ✅ | ✅ | ⚠️ 200 | ⚠️ 200 | ⛔ 403 |
| Create invoice | ✅ | ✅ | ⛔ 403 | ⛔ 403 | — |
| **Record payment** | ✅ | ✅ | ⛔ **403** | ⛔ 403 | ⛔ 403 |
| Invoice PDF / share | ✅ | ✅ | ⛔ **403** | ⛔ 403 | ⛔ 403 |
| View availability | ✅ | ✅ | ✅ | ✅ | ✅ public |
| Manage own schedule | ✅ | ✅ | ✅ | ✅ | — |
| Manage **another** doctor's schedule | ✅ | ⚠️ ✅ | — | ⛔ **403** | — |
| Public booking | — | — | — | — | ✅ |

## The three key isolations — all confirmed real

**1. Doctor ↔ doctor clinical isolation ✅**
Doctor 2 sees **0** of Doctor 1's 12 encounters, and reading one directly returns
**403 — *"You may only view your own clinical records."*** Appointment scoping is equally
real: doc1 sees only its own 25, doc2 only its 1.

**2. Reception clinical redaction ✅ — enforced server-side**
Reception gets 200 on `get_encounter` but the payload is stripped:

```
doctor1  clinical_access=True   symptoms=['TEST symptom: headache']
                                diagnosis=['TEST diagnosis: tension headache']
                                encounter_comment='TEST clinical note...'
reception clinical_access=False symptoms=None diagnosis=None encounter_comment=None
```

This is a server-side control, not a hidden button. Reception is also **403** on
`list_encounters` and **403** on `create_encounter`.

**3. Doctor ↔ finance separation ✅**
Doctor is **403** on invoice list, payment recording and PDF export. Verified by direct API
call, not by checking whether the Billing tab renders.

## Deviations

| # | Finding | Severity |
|---|---|---|
| 1 | Doctor 2 reads Doctor 1's **appointment detail** (200) though the list excludes it | P3 — BUG-03 |
| 2 | Doctor reads **invoice detail** (200) though `list_invoices` is 403 | P3 — BUG-03 |
| 3 | Reception may edit **any** practitioner's schedule (`can_manage:true`) | P3 — BUG-04, policy |

All three are horizontal-scope gaps on *detail* endpoints among **authenticated staff**. No
clinical content and no guest access is involved. Fix: apply the existing
`_scope_filters()` / `_practitioner_scope()` helpers to `get_appointment` and `get_invoice`,
as `encounters.get_encounter` already does.

## Authentication behaviour

| Test | Result |
|---|---|
| Correct credentials × 4 accounts | ✅ 200, correct persona each time |
| Wrong password | ✅ **401** *"Invalid credentials."* |
| Unknown user | ✅ **401**, identical message — no user enumeration |
| Guest → 5 protected endpoints | ✅ **403** on all |
| Concurrent sessions (4 roles at once) | ✅ independent, no interference |
| Re-login while a session is live | ✅ new sid issued, old sid still valid |
| Session restore | ✅ sid in `expo-secure-store`, verified via `auth.me` on a fresh client |

**Session expiry is the one authentication case not exercised** — it needs either a
server-side timeout wait or a forged sid, neither of which was run. Not counted as passing.

## UI-level role gating

Verified in code and consistent with the server matrix: `src/utils/permissions.ts` (with
unit tests) drives the tab bar, so a Doctor gets an **Activity** tab rather than **Billing** —
matching the server's 403 on invoices. The tab bar seen on the running emulator for Admin was
Home / Schedule / Patients / Billing / Me, which is correct.

The important point: **every one of these UI restrictions is also enforced server-side**, so
hidden buttons are defence in depth rather than the only control.
