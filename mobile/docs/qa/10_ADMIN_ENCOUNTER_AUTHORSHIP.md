# Admin could not write a consultation note — fixed

**2026-09-10.** Reported from the running app: signed in as Admin, filling in the
Consultation note screen and tapping **Save note** produced

> practitioner is required.

with no field anywhere on the form to satisfy it. **BUG-05 (P1)** — a permitted
action with no way to complete it.

Missed by the baseline audit because notes were only ever tested as a Doctor,
where the practitioner resolves automatically.

---

## Three faults, not one

| # | Layer | Fault |
|---|---|---|
| 1 | Mobile form | Never collected a `practitioner`, so it could not be sent |
| 2 | Backend message | Said `practitioner is required` — a field name the user could not see or fill |
| 3 | **Marley doctype** | Patient Encounter ships a DocPerm for **`Physician` only** — so even a correct payload died at `doc.insert()` with a bare `PermissionError` |

Fault 3 is the deep one. Verified directly:

```
--- Patient Encounter DocPerm (as shipped) ---
  Physician    read=1 write=1 create=1 submit=1
admin.clinic@test.local: create=False read=False
doctor@test.local:       create=True  read=True
```

So the action was permitted at **every layer except the doctype itself**:
`clinic_core.CLINICAL_ROLES` lists Healthcare Administrator, and the app's
`canCreateEncounter` is `clinical || isHealthcareAdmin`. Only Marley disagreed.

---

## The rule now implemented

A note is **attributed** to a clinician and **attributable** to whoever typed it.

- `practitioner` — the clinician the note belongs to
- `entered_by` / `entered_by_name` — the account that actually recorded it
- `entered_on_behalf` — true only when those two differ

An admin may record on a doctor's behalf. The record never pretends the admin was
the clinician, and never hides who entered it.

### Who supplies the practitioner

| Signed in as | Source | Picker shown? |
|---|---|---|
| Doctor | Their own linked practitioner | No |
| Admin, note opened **from an appointment** | Inherited from that appointment | No |
| Admin, standalone note | **Chosen from a list of active practitioners** | **Yes** |
| Receptionist | — | Cannot create notes at all (403) |

Inheriting from the appointment means a note cannot be filed against a different
doctor than the one who actually held the consultation.

---

## Changes

**`backend/clinic_core/setup_masters.py`** — new `_ensure_encounter_permissions()`
grants Healthcare Administrator create/write/submit on Patient Encounter via
**`Custom DocPerm`**, Frappe's supported override. Marley's shipped DocPerm is not
patched, so an upgrade cannot silently revert it and no vendor code is touched.
`amend`/`cancel` are deliberately withheld — correcting a signed clinical record is
the clinician's call. Because Custom DocPerm replaces the shipped permissions
wholesale, the Physician row is restated or doctors would lose their own access.

**`backend/clinic_core/api/v1/encounters.py`**
- New `ON_BEHALF_ROLES`, deliberately **wider** than `CLINICAL_SUPERVISOR_ROLES`.
  The two answer different questions: *"may I read every doctor's notes?"* (kept
  narrow, admin excluded) versus *"may I file this note under Dr X?"* (admin
  included). Reusing the existing constant would have blocked a pure Healthcare
  Administrator from the very thing being fixed.
- Practitioner inherited from `appointment` when not supplied.
- Missing practitioner → `Select the doctor this consultation note belongs to.`
- The named practitioner must exist and be **Active**.
- A physician passing a colleague's practitioner is **refused**, not silently
  rewritten (see the test note below).
- `owner` exposed as `entered_by` via `_with_audit()`, applied to all six return
  paths so the audit travels with the record everywhere it is read.

**Mobile**
- `validation/schemas.ts` — `practitioner` required, with a message aimed at the
  person reading it rather than the API.
- `encounter/new.tsx` — inherits from appointment, falls back to a searchable
  `PickerField` of real practitioners, and explains that the note is being recorded
  on the doctor's behalf.
- `encounter/[id].tsx` — shows **Entered by** only when it differs from the
  clinician; on a doctor's own note that row is noise.
- `types/domain.ts`, `api/encounters.ts` — audit fields and payload.

---

## A real bug the tests caught

`test_a_doctor_cannot_file_under_another_doctor` **failed on first run**. The
original code assigned `data["practitioner"] = mine` for any physician, which
meant a doctor sending a colleague's practitioner had it **silently rewritten to
their own** — the note was created, under the wrong name, with no error.

Silent correction is worse than refusal in a clinical record. The check now runs
*before* the assignment and returns 403.

## Tests — `backend/clinic_core/tests/test_encounter_authorship.py`

13 new tests covering every case in the brief:

| Scenario | Result |
|---|---|
| Admin selects Doctor A → succeeds | ✅ |
| Admin selects no practitioner → validation error | ✅ |
| Admin opens note from Doctor A's appointment → Doctor A auto-selected | ✅ |
| Doctor creates note → auto-assigned to themselves | ✅ |
| Doctor tries to file under another doctor → 403 | ✅ |
| Receptionist cannot create a note | ✅ |
| Reception still cannot read clinical content | ✅ |
| Note appears in the patient's visit history | ✅ |
| Treating doctor sees a note recorded for them | ✅ |
| Stored doctype carries the right practitioner **and** `owner` | ✅ |
| Audit shows the real logged-in user | ✅ |
| A doctor's own note is *not* flagged on-behalf | ✅ |
| Non-existent practitioner rejected | ✅ |

Encounters are cleaned up in `tearDown` (create commits, so rollback alone leaks
rows — see `[[clinic-test-data-traps]]`).

**Suite: 109 backend tests** (was 96) · 74 mobile · tsc clean.

## Live verification

The exact reported scenario, against the real backend:

```
BEFORE  400  practitioner is required.          <- what you saw
NOW     400  Select the doctor this note belongs to.   (no doctor chosen)
NOW     200  HLC-ENC-2026-00019
             practitioner = Dr Test Doctor
             entered_by   = Clinic Admin
             on_behalf    = True
```

Patient **Syed Azaan**, the real record from the screenshot. The note is in his
visit history.

## Not done

Marley validation was **not** weakened, no fake Healthcare Practitioner was created
for the admin, and `owner` is left to Frappe rather than being written by hand.
