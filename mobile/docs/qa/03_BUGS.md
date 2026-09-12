# BUG REGISTER — Mobile Clinic MVP

Re-verification audit, **2026-09-10**. Every bug below was reproduced live against
`http://localhost:8000` (Frappe 16.33.1 / ERPNext 16.34.2 / Marley 16.5.2) during this
audit. Bugs closed in the 2026-09-09 pass were re-tested and are listed at the bottom.

> ## ⚠️ ALL FOUR BUGS BELOW ARE NOW FIXED (2026-09-10)
>
> This file is kept as the **record of what was found**. For the fixes, the root-cause
> experiments and the verification, see **`09_FIXES_2026-09-10.md`**.
>
> | Bug | Status |
> |---|---|
> | BUG-01 session destroyed by `bookable_slots` | ✅ FIXED — `session.data` restored |
> | BUG-02 search `total` ignores the filter | ✅ FIXED — count honours `or_filters` |
> | BUG-03 detail endpoints not scoped | ✅ FIXED — scoping applied to both |
> | BUG-04 reception schedule authority | ✅ CHANGED — hours split from diary |
>
> 96 backend tests (+16 regression) · 74 mobile · tsc clean · 18/18 live checks.
> One correction to the analysis below: the operative cause of BUG-01 is
> **`session.data`**, not `session.sid` — proved by reverting each line separately.

Severity: **P0** security/data exposure · **P1** main workflow broken · **P2** important
· **P3** minor UX · **P4** cosmetic.

---

## BUG-01 — `bookable_slots` destroys the caller's staff session (P1)

**The most important finding of this audit.** Staff appointment booking is broken end to end.

| | |
|---|---|
| Severity | **P1** |
| Feature | Appointments — staff booking |
| Roles | Admin, Receptionist, Doctor (every authenticated staff user) |
| Screen | `/(app)/appointment/new`, `/(app)/appointment/[id]/reschedule` |
| Status | **OPEN** |

### Steps to reproduce (pure API, fresh session)

```
1. POST auth.login (admin.clinic@test.local)   -> 200, sid issued
2. POST auth.me                                -> 200   (session healthy)
3. POST appointments.bookable_slots            -> 200   (returns correct slots)
4. POST auth.me                                -> 403   <-- SESSION IS NOW DEAD
5. POST appointments.create_appointment        -> 403
6. POST patients.list_patients                 -> 403
```

**Expected:** step 4 onwards return 200; the booking completes.
**Actual:** every subsequent request in that session returns `403 "No App"`. The session is
unrecoverable; only a fresh `auth.login` restores it.

### Backend response

```json
403  "No App"
```

Note the body is a bare string, **not** the `{success,data,error}` envelope — so it is not
even a structured API error.

### Blast radius

Not limited to writes. After step 3 the session is dead for **reads too** (`auth.me`,
`patients.list_patients` all 403). The user is effectively logged out but not told so.

### Why this breaks the real app

`app/(app)/appointment/new.tsx:78` calls `useStaffSlots()` (→ `appointments.bookable_slots`)
to render the slot picker, then line 82 calls `createAppointment()` on submit — the exact
poisoning sequence, on the same session. So:

- the slot list renders correctly (the call itself succeeds), then
- **every** tap afterwards fails, and
- because `403` maps to `FORBIDDEN` (not `UNAUTHENTICATED`) in `src/api/errors.ts:33-35`,
  the client does **not** trigger `onUnauthenticated`, so the app does not log out or
  re-authenticate. It just shows
  *"You do not have permission to view this information."* (`src/api/errors.ts:53`)
  on every screen until the user manually signs out and in again.

That message is actively misleading: the user does have permission.

### Likely cause — identified

`backend/clinic_core/api/v1/slots.py:37-53`:

```python
def _elevated(fn):
    original = frappe.session.user
    try:
        frappe.set_user("Administrator")
        raw = fn()
    finally:
        frappe.set_user(original)      # <-- restores the NAME, not the session state
```

`frappe.set_user()` rebuilds `frappe.local.session` / the role cache for the new user.
Restoring `original` sets the username back but leaves the request's session/boot state
degraded, so Frappe subsequently treats the request as an unauthenticated Website User —
which is the code path that emits the literal string `"No App"`
(`frappe/auth.py:200`, the `user_type == "Website User"` branch).

**Confirmed by isolation:** `_elevated()` is called from exactly one place,
`compute_slots()` (`slots.py:182`). `appointments.working_days` uses the same slot module
but does **not** go through `_elevated()` — and it does **not** poison the session:

| Sequence | Result |
|---|---|
| login → `working_days` → `auth.me` | 200 / 200 ✅ |
| login → `available_slots` → create | 200 / 200 ✅ |
| login → `list_appointments` → create | 200 / 200 ✅ |
| login → **`bookable_slots`** → `auth.me` | 200 / **403** ❌ |

### Not affected

**Guest/public booking is unaffected.** `public.availability.slots` → `public.booking.create`
works end to end (verified: created `HLC-APP-2026-00051`). A guest has no session to destroy.

### Suggested fix

Do not mutate the request's session user. Prefer passing `ignore_permissions=True` to the
specific reads inside `compute_slots` (the module already does this in 5 other places —
lines 109, 135, 264, 272, 293), and delete `_elevated()` entirely.

### Why the test suite missed it

All 80 backend tests pass. No test performs `bookable_slots` followed by another call **on
the same session** — each test method gets a fresh context. A regression test must assert
that a call *after* `bookable_slots` still succeeds.

---

## BUG-02 — Patient search returns an unfiltered `total` (P2)

| | |
|---|---|
| Severity | **P2** |
| Feature | Patients — search / list |
| Roles | All staff |
| Screen | `/(app)/(tabs)/patients` |
| Status | **OPEN** |

### Steps to reproduce

```
POST patients.list_patients {"search": "QAMobile"}
  -> items: 2 rows, total: 12
POST patients.list_patients {"search": "zzz-no-such-patient"}
  -> items: 0 rows, total: 12
```

**Expected:** `total` reflects the number of rows matching the search.
**Actual:** `total` is always the count of *all* active patients (12), regardless of query.

### Likely cause — identified

`backend/clinic_core/api/v1/patients.py:65`:

```python
rows  = frappe.get_list("Patient", filters=filters, or_filters=or_filters, ...)
total = frappe.db.count("Patient", filters)     # <-- or_filters not passed
```

`or_filters` (which carries the search terms) is applied to the rows but omitted from the
count.

### User-visible impact — two defects, both confirmed

1. **Wrong count displayed.** `app/(app)/(tabs)/patients.tsx:71` renders
   `` `${total} registered` `` — so a search showing 0 results still displays
   *"12 registered"*.
2. **Broken infinite scroll.** `patients.tsx:47` computes
   `loaded < lastPage.total ? loaded : undefined` to decide whether more pages exist.
   During a search, `loaded` (2) is always < `total` (12), so the list keeps requesting
   pages. Verified: page 2 of a 2-result search returns an empty `items` array — a
   needless round trip on every scroll to the bottom.

### Suggested fix

Pass `or_filters` to the count, or derive the total from the same query.

---

## BUG-03 — Staff can read detail records outside their own list scope (P3)

| | |
|---|---|
| Severity | **P3** (see rationale — *not* a clinical-data leak) |
| Feature | Appointments / Invoices — detail endpoints |
| Roles | Doctor |
| Status | **OPEN — design decision needed** |

### Observed

| Call | Doctor 2 (not the treating doctor) |
|---|---|
| `appointments.list_appointments` | 200 — correctly scoped, doc1's appointments **excluded** |
| `appointments.get_appointment` (doc1's appt) | **200 — full record returned** |
| `invoices.list_invoices` | 403 FORBIDDEN ✅ |
| `invoices.get_invoice` (any invoice) | **200 — `grand_total`, `outstanding_amount`, patient name returned** |

So the *list* endpoints enforce scoping but the *detail* endpoints do not apply the same
horizontal check. A doctor who knows or guesses a document ID (`HLC-APP-2026-000NN`,
`ACC-SINV-2026-000NN` — both sequential and enumerable) can read it.

### Why P3 and not P0

The genuinely sensitive surface is correctly protected — this was explicitly re-tested:

- `encounters.get_encounter` on another doctor's encounter → **403**
  *"You may only view your own clinical records."* ✅
- Reception reading an encounter → 200 but **fully redacted**: `clinical_access: false`
  and `symptoms`, `diagnosis`, `encounter_comment` all `null` — enforced **server-side**,
  not hidden in the UI ✅

What leaks is appointment metadata and invoice totals, to an authenticated clinician —
not clinical notes, and not to an outsider. Guests get 403 on every protected endpoint.

### Suggested fix

Apply `_scope_filters()` / `_practitioner_scope()` (already written for the list endpoints)
to `get_appointment` and `get_invoice`, mirroring what `encounters.get_encounter` does.

---

## BUG-04 — Reception can edit any practitioner's schedule (P3, policy)

| | |
|---|---|
| Severity | **P3 — policy question, not a defect** |
| Feature | Availability management |
| Status | **OPEN — needs a product decision** |

`practitioners.availability` returns `can_manage: true` for Receptionist against *any*
practitioner, and `block_time` on another doctor's calendar succeeds (200).

Doctors are correctly restricted to their own schedule (doc2 → doc1 = **403**
*"You may only manage your own schedule."*).

This is plausibly intentional — a front desk normally does manage the clinic diary. Flagged
so it is an explicit decision rather than an accident. No fix applied.

---

## Re-tested and CONFIRMED FIXED

Verified live during this audit, not taken on trust from the previous report:

| Was | Status now | Evidence |
|---|---|---|
| Cross-doctor clinical notes readable | ✅ **FIXED** | doc2 → doc1's encounter = 403; doc2 sees 0 of doc1's 12 encounters |
| Client-side slot derivation drifting from server | ✅ **FIXED** | one server engine; `utils/slots.ts` deleted; staff & guest slot lists identical |
| Invoice share/send unimplemented | ✅ **FIXED** | `invoices.invoice_pdf` returns a real base64 `%PDF`; doctor correctly 403 |
| PDF `HostNotFoundError` | ✅ **FIXED** | `host_name` in site_config; PDFs render |
| Reception seeing clinical detail | ✅ **CORRECT** | `clinical_access:false`, fields stripped server-side |
| Practitioner Schedule shared between doctors | ✅ **FIXED** | `set_schedule` forked Dr Second Doctor onto a private schedule; `Weekday 9to5` intact |

---

## Priority fix order

1. **BUG-01 (P1)** — `bookable_slots` kills the session. Staff booking and reschedule are
   unusable. One-function fix in `slots.py`; add a same-session regression test.
2. **BUG-02 (P2)** — search `total`; one-line fix, removes a wrong count and a wasted
   request per scroll.
3. **BUG-03 (P3)** — scope the detail endpoints to match the list endpoints.
4. **BUG-04 (P3)** — confirm whether reception *should* manage all schedules.
