# Patient context was lost when navigating from a profile — fixed

**2026-09-10.** Reported from the running app. From a patient profile:

- **Invoices** → dropped into the clinic-wide Billing tab, every patient's invoices
- **Book appointment** → showed a "Choose a patient" dropdown

In both cases the profile already knew who the patient was, and the app asked
again. **BUG-06 (P2)** — a usability defect, not a data one.

---

## What was actually wrong

Two different faults that looked like one:

| Route | Fault |
|---|---|
| `Invoices` | Pushed `/(app)/(tabs)/billing` with **no patient at all**. The billing screen had no `patient` parameter and fetched everything. |
| `Book appointment` | **Did** pass `?patient=`, and the screen **did** prefill it — but rendered it as an editable dropdown, so it looked like nothing had been passed. |

A third fault found while fixing it: `appointment/new` read the param **without
`decodeURIComponent`**, unlike every other screen. Patient IDs here are names
(`Syed Azaan`), so the percent-encoded value would not have matched any record —
latent, because the prefill was invisible anyway.

And a fourth, found by looking at the result: `invoice/new` read no params at all,
so "new invoice" from a patient's own list would still have asked who it was for.

The backend already supported the filter — `invoices.list_invoices(patient=…)`
was verified live (9 of 11 invoices for one patient). Only the client was wrong.

---

## Fixes

### 1. A patient's invoices are their own route

`app/(app)/patient/[id]/invoices.tsx` — new, and deliberately **outside** the
`(tabs)` group.

Filtering the Billing *tab* was the first attempt and was wrong: a tab is a
destination, not a step. The tab bar stayed visible with **Billing** lit up while
the user was conceptually still inside a patient, and Android back went to the
previous *tab* rather than back to the profile. Its own route gets a real back
stack and no tab chrome.

It **reuses** `BillingScreen` via a `patientOverride` prop rather than copying the
list, so the two cannot drift apart in how they render, filter or refresh.

`BillingScreen` in scoped mode:
- `BackHeader` titled **Invoices** with the patient's name beneath
- server-side filter (`listInvoices({ patient })`) — the 200-row cap cannot hide a
  patient's older invoices behind other patients' newer ones
- clinic-wide "Collected today / Outstanding" card hidden — meaningless for one patient
- empty state reads *"Syed Azaan has no invoices yet."*
- no tab-bar clearance, since there is no tab bar
- **the + button is kept**, and carries the patient into the invoice form

That last point was a bug in my own first cut: the + lived inside the non-scoped
branch, so scoping the screen silently removed the ability to raise an invoice
for that patient — the exact thing the screen is for.

### 2. A known patient is shown, not asked

`appointment/new.tsx` and `invoice/new.tsx`: when the patient arrives on the
route, the picker is replaced by a read-only field styled like the other inputs
(`colors.card` / `radius.card` / `colors.line`, matching `PickerField`).

Pre-filling a *dropdown* with one value still invites the user to re-answer a
settled question, and still renders as something to tap. The patient list query is
also skipped entirely (`enabled: !presetPatient`) — nothing to choose, no reason to
fetch 50 patients.

Both now `decodeURIComponent` the parameter.

### 3. Deliberately unchanged

"New appointment" from the **Appointments tab**, **dashboard** and **calendar**
still shows the patient picker. No patient is in context there, so asking is right.
The fix is about not discarding context that exists — not about removing choice.

---

## Files

| File | Change |
|---|---|
| `app/(app)/patient/[id]/invoices.tsx` | **new** — scoped route, reuses BillingScreen |
| `app/(app)/(tabs)/billing.tsx` | `patientOverride` prop + scoped header, filter, empty state, + button |
| `app/(app)/patient/[id]/index.tsx` | Invoices → the new route |
| `app/(app)/appointment/new.tsx` | decode param, read-only patient, skip query |
| `app/(app)/invoice/new.tsx` | accept `?patient=`, read-only patient, skip query |

## Verified on device

Android emulator, admin login, patient **Syed Azaan**:

- Profile → **Invoices** → header *"Invoices / Syed Azaan"*, back button, no tab
  bar, + present, empty state *"Syed Azaan has no invoices yet."* — matching the
  profile's own "Invoices 0"
- Profile → **Book appointment** → **Patient** is a fixed read-only field; only
  **Doctor** remains a picker

74 mobile tests · tsc clean. No backend change was needed.

---

# Follow-up: wrong invoice count, and a redundant name on every card

Both reported after the fixes above, from the same screens.

## BUG-07 (P2) — the profile's invoice count disagreed with the list

The profile showed **Invoices 1**; opening it listed **2**.

Two different sources were being counted:

| Source | Counts | Value |
|---|---|---|
| `invoices.outstanding` (profile badge) | submitted only — `docstatus: 1` | 1 |
| `invoices.list_invoices` (the screen) | everything, drafts included | 2 |

Neither is wrong on its own. `outstanding` filters to submitted invoices because
it is a **money** figure — a draft is not billed, so it must not count toward
"Due". But the badge is labelled **Invoices** and opens a list that *does* include
drafts, so counting differently made the app contradict itself one tap apart.

**Fix:** the badge now reads `list_invoices(patient).total` — the same call the
screen makes, so the two cannot disagree. `outstanding` is still used, unchanged,
for the **Due** figure where its stricter filter is correct.

Verified live: `QAMobile Patient130329` has 1 submitted (Rs 1,500, Paid) + 1 draft
(Rs 500) → badge now **2**, list **2**, Due still **Rs 0**.

## BUG-08 (P3) — the patient's name repeated on every card

In the scoped list each card's title was the patient's name — identical on every
row, and already in the header — while the actually distinguishing value, the
invoice number, sat in small grey subtitle text.

**Fix:** `InvoiceCard` takes a `hidePatient` prop. When set, the invoice number
becomes the title and the date the subtitle; the patient name is dropped. The
Billing **tab** is unchanged — there the name is the most useful identifier,
because the rows are different patients.

The accessibility label follows the same rule, so a screen reader is not told the
same name on every row either.

```
Billing tab      QAMobile Patient130329        (name = identifier)
                 ACC-SINV-2026-00010 · 9 Sep

Patient's list   ACC-SINV-2026-00010           (number = identifier)
                 9 Sep 2026
```

**Verified on device:** profile badge reads 2; the list shows
`ACC-SINV-2026-00010` (Paid, Rs 1,500) and `ACC-SINV-2026-00011` (Draft, Rs 500)
as titles, patient named once in the header.

74 mobile tests · tsc clean. Still no backend change.

---

## Notes on the emulator

Two things cost time here and are worth knowing:

1. **Two Metro bundlers were running** (8081 and 8082) and the app auto-attached
   to the wrong one, serving a stale bundle. If a change does not appear, check
   `netstat -ano | grep :808` and relaunch explicitly at the right port.
2. **`adb reverse` tunnels silently drop** when Expo Go is force-stopped often.
   The symptom is `java.io.IOException: Failed to download remote update` at
   launch — not a code fault. `adb reverse --list` shows them empty; re-add
   `tcp:8082` and `tcp:8000` before relaunching.

Relaunch command:
`adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8082" host.exp.exponent`
