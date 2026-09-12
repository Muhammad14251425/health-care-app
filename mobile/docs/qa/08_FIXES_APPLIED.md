# 08 — Fixes Applied

Follow-up to the baseline audit (`07_FINAL_SCORE.md`). Every fix below was
verified against the **live backend**, and where it has a UI, **in the running
Android app**. Nothing here is "should work now".

**Test status after all changes**

| Suite | Before | After |
|---|---|---|
| Backend (`bench run-tests --app clinic_core`) | 37 pass | **58 pass** (+21 new) |
| Mobile (`jest`) | 78 pass | **78 pass** |
| Mobile (`tsc --noEmit`) | clean | **clean** |

---

## BUG-01 (P1) — cross-doctor clinical notes — **FIXED**

**Was:** any Physician could read *any* other Physician's clinical notes,
including for patients they had never treated. `list_encounters` applied a
practitioner filter only when the caller supplied one, and `_may_see_clinical()`
granted access to every Physician with no care-relationship check.

**Fix** — `backend/clinic_core/api/v1/encounters.py`:

* Added `_treats(patient, practitioner)` — a care relationship means the
  practitioner authored an encounter for that patient, or has an appointment
  with them. The common "it is my own note" case short-circuits with no query.
* Added `_practitioner_scope()`, mirroring `appointments._scope_filters()`: a
  pure Physician is pinned to their own records; supervisor roles are not.
* `list_encounters` now pins the practitioner filter to the caller's own scope,
  and **refuses** a request for someone else's records (403) rather than
  silently widening.
* `get_encounter` refuses when the caller is a scoped practitioner with no care
  relationship to that patient.
* `submit_encounter` gained the ownership guard that `update_encounter` already
  had — a doctor could previously sign off another clinician's draft.

**Verified live**

| Check | Result |
|---|---|
| doctor2 reads doctor1's note | **403** (was 200 + full content) |
| doctor2 lists encounters | own only — doctor1's note absent |
| doctor2 requests `practitioner=Dr Test Doctor` | **403**, not widened |
| doctor2 updates / submits doctor1's note | **403** |
| doctor1 reads own note | **200**, full clinical content |
| doctor1 lists own encounters | works, 12 records |

## BUG-02 (P2) — admin list/get inconsistency — **FIXED**

**Was:** `list_encounters` returned 403 for a Healthcare Administrator (Marley
grants the `Patient Encounter` doctype read to `Physician` **only**) while
`get_encounter` returned the same record's clinical content in full, because
`frappe.get_doc()` performs no permission check. The two disagreed.

**Fix:** authorization for the encounter list is now decided explicitly in
`list_encounters` (non-staff → own patient; pure Physician → own practitioner;
otherwise a supervisor role), and the query uses `frappe.get_all(...,
ignore_permissions=True)` so the doctype's Physician-only grant no longer
contradicts a decision already made above. Only the **summary** fields are
returned that way; clinical content stays gated by `_may_see_clinical()`.

Because that query now bypasses Frappe's check, an explicit refusal was added
for staff who are **neither** a supervisor **nor** a practitioner — reception
and billing-only accounts — so the branch cannot fall through to an unfiltered
read of every clinical record.

`CLINICAL_SUPERVISOR_ROLES` deliberately contains only `Administrator` and
`System Manager`. `Healthcare Administrator` was **removed** from clinical
content access: it matches the doctype, and it matches what the mobile app
already offers (`canViewClinicalNotes` is Physician-only).

> The seeded `admin.clinic@test.local` also holds **System Manager**, so that
> account still has supervisor access — correctly, and now *consistently* across
> both endpoints.

**Verified live:** list and get now return the same verdict for admin, doctor
and reception. Reception keeps its redacted scheduling summary
(`clinical_access: false`, no `symptoms`/`diagnosis`/`encounter_comment`) but
**cannot enumerate** encounters.

## BUG-03 (P2) — invoice share / send — **IMPLEMENTED**

**Was:** an explicit MVP requirement with no backend endpoint and no mobile
action.

**A second, hidden defect surfaced while building it:** PDF rendering was broken
on this deployment entirely. `wkhtmltopdf` resolves header/footer asset URLs
through `frappe.utils.get_url()`, which returned `http://clinic.localhost:8000`
— a host that **does not resolve** (see `docs/00_MACHINE_AUDIT.md`; the hosts
file could not be edited). Every PDF attempt died with
`Exit with code 1 due to network error: HostNotFoundError`. Fixed by pinning
`host_name` to `http://127.0.0.1:8000` in the site config.

**Backend** — `invoices.py`:

* `_render_invoice_pdf()` — internal, returns raw bytes, raises `ApiError`.
* `invoices.invoice_pdf(invoice)` — base64 PDF + filename/mime/size.
  Base64 rather than a URL because the app authenticates with a session cookie,
  not a browser session, and the share sheet needs the bytes on-device anyway.
* `invoices.email_invoice(invoice, recipient?)` — billing staff only; emails the
  PDF to the patient. Returns a **4xx** (not 500) when the clinic has no
  outgoing Email Account or the patient has no address, so the client can fall
  back to sharing.
* `_assert_invoice_access()` — read guard shared with `get_invoice`.
* Draft invoices are refused: sharing an unsubmitted document would send the
  patient a figure the clinic has not committed to.
* `frappe.PermissionError` is re-raised rather than swallowed, so a caller
  without invoice permission gets **403**, not a 500.

**Mobile** — `src/api/invoices.ts`, `app/(app)/invoice/[id].tsx`:

* `invoicePdf()` / `emailInvoice()` client functions.
* A **Share invoice** button (secondary style, share icon) on the invoice
  screen, shown only for submitted invoices. It fetches the PDF, writes it to
  the cache directory via `expo-file-system`, and opens the OS share sheet via
  `expo-sharing`. Guarded against double-tap; failures surface as a toast.
* Added `expo-sharing` and `expo-file-system` at SDK-57-matched versions.

**Verified**

| Check | Result |
|---|---|
| Admin fetches PDF | **200**, 22,138 bytes, starts with `%PDF-` |
| Reception fetches PDF | **200** |
| Doctor (no billing perm) | **403 FORBIDDEN** (was a 500) |
| Guest | **403** |
| Unknown invoice | **404** |
| Draft invoice | **400** "Submit the invoice before sharing it." |
| Email with no mail account | **400 VALIDATION_ERROR** (was a 500) |
| **In the app** | Share button renders → native share sheet opens with `ACC-SINV-2026-00003.pdf` (screenshots `27`, `28`) |

## BUG-06 (P4) — `outstanding(patient?)` typed optional — **FIXED**

`src/api/invoices.ts`: the parameter is now required, matching the backend,
which rejects a call without it. No call site changed — both already passed one.

## BUG-07 (P3) — `.env` pins a hotspot IP — **FIXED**

**Was:** `EXPO_PUBLIC_API_URL=http://192.168.137.1:8000` is correct for the
physical test phone but unreachable from an Android emulator, and because the
value is explicit it overrode the automatic `10.0.2.2` fallback — every screen
showed "No internet connection" until someone hand-edited the file.

**Fix** — `src/config/env.ts`: an explicit override that is a loopback or
private-range address is now ignored **on an Android emulator specifically**
(detected via `isPhysicalDeviceSession()`, so a real device still honours it),
falling back to `10.0.2.2` with a dev-only warning explaining why.

**Verified in the app:** with the original `.env` restored and untouched, the
emulator now loads live data on every screen (screenshot `26`).

---

## Still open — deliberately not fixed

These need a product decision or are larger than a bug fix. They remain in
`03_BUGS.md` and the backend-gaps table.

| ID | Item | Why not now |
|---|---|---|
| BUG-04 | Schedule editing, blocked time, leave | Requirement 3's real gap. Needs three new backend write endpoints against Marley's Practitioner Schedule, plus a write UI — a feature, not a fix. Availability stays **display-only**. |
| BUG-05 | Staff slot endpoint returns raw windows | Mitigated and safe (client derives; backend re-validates with 409). Unifying it means moving the public slot logic into an authenticated variant — worth doing, but it changes a working path. |

## Score impact

Only requirement 4 changes materially: invoice share moves from **0** to
working, verified end-to-end.

| Requirement | Baseline | Now | What moved |
|---|---:|---:|---|
| Patient profiles | 92% | **98%** | clinical notes 60→95 (isolation), permissions 70→95 |
| Appointments + public booking | 97% | 97% | unchanged |
| Doctor availability | 58% | **58%** | unchanged — BUG-04 not fixed |
| Invoicing | 85% | **99%** | share/send 0→95, verified in the app |
| Role-based login | 97% | **98%** | backend permission consistency 90→100 |
| **OVERALL** | **88%** | **92%** | |

**Availability at 58% is now the single thing holding the total down** — and it
is a genuine missing capability (no schedule-write, blocked-time or leave
endpoints exist), not a defect. Fixing it is a feature decision, not a bug fix.

Invoice share scores 95 rather than 100 because `email_invoice` cannot be
exercised end-to-end on this deployment: no outgoing Email Account is
configured. The endpoint, its permission gate and its 4xx fallback are tested;
an actual send is not.
