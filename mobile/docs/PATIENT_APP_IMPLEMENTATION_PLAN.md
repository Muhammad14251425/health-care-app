# Patient Mobile Account — Implementation Plan

Status: **plan** (written before any code, from live backend inspection)
Date: 2026-09-10
Backend probed: `clinic.localhost` on WSL Ubuntu-24.04, frappe 16.33.1 / erpnext 16.34.2 /
healthcare (Marley) 16.5.2.

This plan covers the fourth role — **Patient** — as a first-class mobile account with phone+OTP
login, alongside the existing Admin / Receptionist / Doctor staff app and the public guest booking
flow. Nothing existing is removed.

---

## 1. What the live backend actually contains

These are probed facts, not assumptions. They drive every decision below.

### 1.1 `Patient.user_id` exists but cannot be trusted alone

```
Patient.user_id  →  fieldtype: "Read Only", options: "User", unique: 0
```

* It **is** the Frappe-native Patient↔User link, and Marley itself writes it:
  `patient.py` does `self.db_set("user_id", user.name)` when `invite_user` is set.
* It is `Read Only` (so the desk UI will not let staff edit it) and, critically,
  **not unique** — nothing at the database level stops two Patients pointing at one User.

**Consequence:** `user_id` is the right link to use, but uniqueness must be enforced by
`clinic_core` on every write, and login must fail closed if it is ever violated.

### 1.2 Marley's `Patient` role exists and has ZERO DocPerms

```
Role "Patient" exists: True
DocPerms for role "Patient" on Patient, Patient Appointment, Patient Encounter,
Sales Invoice, Lab Test, Medication Request, Diagnostic Report, Observation,
Patient Medical Record  →  [] (empty, every one)
```

This is the single most important finding, and it is *good news*:

* We must **not** create a new role — Marley already ships `Patient`.
* A patient user has no ORM read access to anything. `frappe.get_list("Patient Appointment")`
  as a patient returns nothing at all.
* Therefore **every** patient-visible byte must flow through a `clinic_core` endpoint that
  scopes the query itself. There is no "accidentally readable" surface to close.
* Endpoints that read on the patient's behalf will use targeted, field-limited queries with
  `ignore_permissions=True` **only after** the patient identity has been resolved from the
  session — never from a client-supplied id.

We will **not** grant the `Patient` role DocPerms. Granting `read` on `Patient Appointment`
would open every patient's appointments to every patient (Frappe DocPerms are doctype-wide;
narrowing needs User Permissions per record, which is unmanageable at clinic scale and is
exactly the IDOR class this project already avoids elsewhere).

### 1.3 Phone numbers are stored unnormalized — matching on raw text is unsafe

Live data today:

| Patient | mobile |
|---|---|
| Final Check | `+923005551234` |
| Syed Azaan | `03009332202` |

Same country, two formats, and `Patient.mobile` is a free-text `Data` field with no uniqueness.
`03009332202` and `+923009332202` are the same human being and would not match each other.

**Consequence:** login must never do `get_value("Patient", {"mobile": input})`. A normalized
column is required (§3.2).

### 1.4 Patient Encounter has a clean patient-safe / internal split

Real fieldnames on this install:

* Patient-safe candidates: `encounter_date`, `practitioner_name`, `medical_department`,
  `symptoms`, `diagnosis`, `drug_prescription` (child table), `lab_test_prescription`
* Internal / staff-only: `clinical_notes`, `encounter_comment`, `physical_examination`,
  `source`, `referring_practitioner`, `insurance_*`, `codification_table`, `invoiced`

This gives a genuine field-level allowlist rather than a guess. Note `symptoms` and `diagnosis`
have sibling `*_in_print` flags — Marley's own signal for "this is intended to reach the patient" —
which we honour.

### 1.5 Existing security scaffolding to reuse, not rebuild

`clinic_core/api/response.py` already provides the exact primitives this feature needs:

* `clinic_api(roles=…)` — envelope + role gate + traceback suppression
* `current_patient()` — `Patient` where `user_id == frappe.session.user` and status Active
* `assert_patient_access(patient)` — the horizontal guard, already refusing to distinguish
  "missing" from "forbidden" for non-staff (no id-enumeration oracle)
* `is_staff()`, `pick()`, `parse_payload()`

`public/guard.py` provides a redis fixed-window rate limiter and input cleaners.
The OTP endpoints will reuse both patterns rather than inventing a second style.

**A dedicated `Patient` persona already exists** in `auth.me` (`persona: "patient"`), and
`appointments.create_appointment` **already** forces `data["patient"] = current_patient()` for
non-staff callers. Much of the booking security requirement is satisfied by existing code; the
plan below verifies it rather than duplicating it.

---

## 2. Architecture decision: how a phone number becomes a session

```
   phone "+92 300 1234567"
        │
        ▼  normalize → E.164
   +923001234567
        │
        ▼  Patient Phone Mapping (new DocType, UNIQUE on phone_e164)
   patient: HLC-PAT-2026-00042   user: patient.<hash>@clinic.internal
        │
        ▼  OTP verified
   Frappe session (sid) issued for that User
        │
        ▼  every later request
   current_patient()  ← reads session.user, never a request parameter
```

### Why a mapping DocType instead of just matching `Patient.mobile`

1. **Uniqueness is enforceable.** A `unique: 1` field on the mapping gives a database-level
   guarantee that one phone → one account. `Patient.mobile` cannot carry that: it is existing
   free-text data with known duplicates, and adding a unique constraint to it would break
   legitimate staff workflows (families sharing a contact number).
2. **The auth identity is separate from the contact detail.** A receptionist editing a patient's
   contact phone must not silently move that patient's login. Changing the login phone is its own
   OTP-verified flow (§7).
3. **Ambiguity is detectable.** If two Patients carry the same phone, the mapping's uniqueness
   forces a deliberate resolution rather than "first row wins" (`get_value` returns an arbitrary
   row — precisely the "DO NOT blindly use the first matching text field" failure).
4. It is a proper Frappe relationship (Link fields to `Patient` and `User`), not a workaround.

---

## 3. Backend work

### 3.1 New DocTypes

**`Patient Phone Mapping`** — the auth anchor.

| field | type | notes |
|---|---|---|
| `phone_e164` | Data | **unique: 1**, the normalized login identity |
| `patient` | Link → Patient | **unique: 1** — one login per patient record |
| `user` | Link → User | the Frappe User that owns the session |
| `status` | Select | `Active` / `Blocked` |
| `verified_on` | Datetime | when the phone was last OTP-proven |

Permissions: no role gets read/write. Only server-side code touches it.

**`Patient OTP Request`** — OTP state, hashed.

| field | type | notes |
|---|---|---|
| `phone_e164` | Data | indexed |
| `otp_hash` | Data | **sha256(otp + per-row salt)** — never the plain code |
| `salt` | Data | per-row random |
| `purpose` | Select | `login` / `change_phone` |
| `expires_at` | Datetime | issued + 5 min |
| `attempts` | Int | incremented per wrong guess, max 5 |
| `consumed` | Check | single-use flag |
| `requested_ip` | Data | for abuse triage |

### 3.2 Phone normalization (`clinic_core/api/v1/phone.py`)

Pakistan-aware, server-side, total:

```
03001234567    → +923001234567
3001234567     → +923001234567
923001234567   → +923001234567
+92 300 1234567→ +923001234567
00923001234567 → +923001234567
```

Rules: strip spaces/dashes/parens → convert `00` prefix to `+` → if no `+`, apply default
country (`+92`, configurable) by stripping a single leading `0` → validate the result is
`+` followed by 10–15 digits. Never trust the client's formatting; the client may format for
display only.

A backfill patch normalizes existing `Patient.mobile` values into mappings where they are
unambiguous, and **reports** (does not guess) where they are not.

### 3.3 OTP provider abstraction (`clinic_core/otp/`)

```python
class OtpProvider:                    # base
    def send(self, phone_e164, code, purpose): ...

class ConsoleOtpProvider(OtpProvider) # dev: logs, never in prod
class NullOtpProvider(OtpProvider)    # tests
# later: TwilioOtpProvider, WhatsAppOtpProvider — drop-in
```

Selected by site config key `clinic_otp_provider`. Secrets live in `site_config.json`,
never in the app bundle. The dev provider refuses to run when
`developer_mode` is off, so a real deployment cannot accidentally ship "OTP printed to log".

### 3.4 Auth endpoints (`clinic_core/api/v1/patient_auth.py`)

| endpoint | guest? | behaviour |
|---|---|---|
| `request_otp(phone_number)` | yes | Always returns the *same* generic success. Never reveals whether the number is known. Rate limited per phone **and** per IP. |
| `verify_otp(phone_number, otp)` | yes | Constant-ish work regardless of outcome; on success issues a session; increments attempts on failure; marks consumed on success. |
| `register(payload)` | authenticated, unlinked | First-login profile completion (Case B, §4). |
| `logout()` | yes | Kills the Frappe session server-side. |
| `request_phone_change` / `confirm_phone_change` | authenticated | §7. |

Failure responses are deliberately uniform: wrong OTP, expired OTP, consumed OTP and unknown
phone all produce one message ("That code is not valid or has expired.") so the endpoint is not
an account-existence oracle.

### 3.5 Data endpoints — all self-scoped, no id parameter for identity

```
patient.me                        profile + counts for Home
patient.update_me                 allowlisted contact fields only
patient_appointments.list         upcoming / past / cancelled
patient_appointments.create       patient comes from session, never payload
patient_appointments.reschedule   ownership re-checked
patient_appointments.cancel       ownership re-checked
patient_records.visits            patient-safe encounter summaries
patient_records.visit(id)         ownership re-checked, fields filtered server-side
patient_records.prescriptions     from Drug Prescription child rows
patient_records.diagnostics       Lab Test / Diagnostic Report — optional module
patient_billing.summary           outstanding / paid totals
patient_billing.invoices          own invoices only
patient_billing.invoice(id)       ownership re-checked
```

Every endpoint that takes a record id re-derives the owning patient from the document and
compares it to `current_patient()` — the id is a *lookup key*, never a claim of identity.
Records the caller does not own return the same shape as records that do not exist.

### 3.6 Patient-safe projection is a backend concern

`patient_records.visit` builds its response from an explicit allowlist (§1.4). The full
`Patient Encounter` document is never serialized and never leaves the server. Hiding a field
in React Native would leave it in the JSON on the wire — which is not hiding it at all.

---

## 4. First-login policy

**Case A — phone already belongs to exactly one Active Patient.**
Link it: create the User, write `user_id`, create the mapping, log in. No duplicate Patient.

**Case B — phone matches no Patient.**
OTP still verifies (so we do not leak that the number is unknown). The client is issued a
session flagged `needs_registration`, and only `patient_auth.register` is usable until it
completes: full name (required), gender (required — Marley makes `Patient.sex` mandatory, and
`"Prefer not to say"` is offered, matching the existing public-booking stance), DOB and email
optional. Then Patient + User + mapping are created atomically.

**Case C — phone matches two or more Active Patients.**
**Refuse.** Return a neutral account-resolution error telling the caller to contact the clinic,
and log an admin-visible flag. Never pick one. This is the case the requirement explicitly calls
out, and today's live data (§1.3) shows it is reachable.

---

## 5. Mobile work

Routes (new group, staff routes untouched):

```
app/(patient-auth)/phone.tsx · otp.tsx · register.tsx
app/(patient)/(tabs)/index · appointments · records · billing · profile
app/(patient)/appointment/new · [id]/index · [id]/reschedule
app/(patient)/record/visit/[id] · prescription/[id] · diagnostic/[id]
app/(patient)/invoice/[id]
```

* Root `app/index.tsx` gains persona routing: `patient → /(patient)/(tabs)`, staff → `/(app)/(tabs)`.
* Session continues to live in `expo-secure-store` (already the pattern — `src/api/session.ts`).
* Theme is reused verbatim from `src/theme/` — same Poppins, `#F3F2ED` ground, `#124F3D` hero,
  gold/peach/mint/paleYellow tiles. No separate patient palette.
* Existing `src/components/ui/*` (HeroCard, StatCard, Card, StatusPill, Screen) are reused;
  the patient app should look like the same product because it is built from the same parts.

**Cache isolation on logout** is treated as a security requirement, not hygiene:
`queryClient.clear()` already runs in `clearLocalSession`; the patient flow adds a test that
proves Patient B never sees Patient A's cached rows.

---

## 6. Security tests (`clinic_core/tests/test_patient_portal.py`)

Two real patients, created through the real flow, then:

* every `*.me`-style endpoint returns only the caller's own data
* Patient A passing Patient B's patient / appointment / encounter / invoice / prescription /
  lab id → denied, with the same response shape as a nonexistent id
* `create` with `patient` injected in the payload → the appointment still belongs to A
* wrong OTP, expired OTP, reused OTP, 6th attempt, unknown phone, duplicate-phone patient
* phone format equivalence: `0300…`, `+92300…`, `92300…`, spaced — all resolve to one account
* staff endpoints (`patients.list_patients`, admin surfaces) → 403 for a patient session

---

## 7. Changing the login phone

Phone is identity, so it is never a text edit: authenticated patient → enter new phone →
OTP to the **new** number → verify → mapping updated in one transaction. The new number is
rejected if it already maps to another account, which prevents takeover of a number that
belongs to someone else.

---

## 8. Explicitly out of scope

* Push notifications — code is structured so they can be added (§ notification hooks), but no
  push service is wired.
* Online payment — patients may **view** invoices and balances; they cannot create Payment
  Entries or alter accounting.
* Lab/diagnostics are treated as an **optional module**: if the clinic has no Lab Test data the
  section is absent, and that is not counted as a failure.
