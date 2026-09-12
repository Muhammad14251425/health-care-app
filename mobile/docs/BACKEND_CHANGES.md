# Backend Changes

Changes made to `clinic_core` as part of this work, approved explicitly before
being written. **No staff endpoint was weakened.**

---

## Why any backend change was needed

Public appointment booking is a core MVP requirement, and it was impossible:
every endpoint the flow needs (departments, practitioners, slots, create
appointment) required an authenticated session. Only `auth.login` allowed
guests. Verified by probing the live backend as an unauthenticated caller —
all four returned `PermissionError`.

---

## 1. New guest API — `clinic_core/api/v1/public/`

A separate package, so the guest surface is greppable and cannot be widened by
accident.

| File | Purpose |
|---|---|
| `__init__.py` | Package invariants, eager submodule import |
| `guard.py` | `public_api` decorator: rate limiting + envelope; input sanitisers |
| `departments.py` | `list_departments` |
| `practitioners.py` | `list_practitioners`, `get_practitioner` |
| `availability.py` | `days`, `slots` |
| `booking.py` | `create`, `appointment_types` |

### Design invariants

1. **Read-mostly.** The only write is `booking.create`, producing one
   `Patient Appointment` (plus, if needed, one minimal `Patient`).
2. **No client-supplied doctype, fieldname or filter.** Guests choose from
   server-supplied enumerations; `assert_choice()` verifies every id against a
   server-defined set.
3. **Minimal field exposure.** The doctor payload deliberately omits `user_id`,
   email and phone. The booking response carries no internal patient id.
4. **Rate limited per IP** — 60/min reads, 5 per 10 min bookings, via Frappe's
   redis cache. Fails open on cache failure (a cache hiccup must not take
   patient booking offline).
5. **Server-side slot re-check** before insert, then Marley's own
   `validate_overlaps()` → 409 CONFLICT.
6. **Per-phone cap** of 3 upcoming appointments, to blunt scripted spam.

### Discrete slots

`public.availability.slots` converts Marley's schedule windows into bookable
times **server-side**. Doing this on the client would make availability a client
opinion, with different clients disagreeing about the same calendar.

Marley's `get_availability_data()` needs permissions a guest lacks, so that one
call runs elevated (`_elevated()`) and only the derived free times are returned —
nothing it reads is exposed.

---

## 2. `Code.RATE_LIMITED` added to `api/response.py`

Additive: a new error code mapped to HTTP 429. Existing codes untouched.

---

## 3. Package `__init__.py` files populated

`clinic_core/api/__init__.py` and `clinic_core/api/v1/__init__.py` were empty, so
`clinic_core.api.v1` was not bound as an attribute of `clinic_core.api` until
something happened to import it first — verified: `hasattr(api, 'v1')` was
`False` on a cold interpreter and `True` after any import.

Frappe resolves whitelisted paths with successive `getattr()`, so endpoint
availability depended on request order on a cold worker. Both now import their
submodules eagerly, making resolution deterministic.

> Honest note: this was found while chasing an `AttributeError` that turned out
> to be a malformed URL in my own test script, not a server fault. The binding
> issue is real and worth fixing, but it was not the cause of that symptom.

---

## 4. Bugs found and fixed while testing

Each was caught by a failing test, not by inspection.

| # | Problem | Fix |
|---|---|---|
| 1 | `fields=["distinct department as name"]` — Frappe v16 rejects that SELECT form | de-duplicate in Python |
| 2 | `default_duration` read from `Healthcare Practitioner` — no such column | it lives on `Appointment Type` |
| 3 | Flood check filtered `Patient Appointment.contact_phone_number` — no such column in Marley 16 | count via the linked `Patient` records |
| 4 | Booked slots still showed as free | Marley's `slot_details[].appointments` is service-unit scoped and empty for ordinary consultations; read the day's appointments directly |
| 5 | **Security:** Marley invites every new `Patient` as a portal **User** by default | `invite_user = 0`, with a regression test |

Bug 5 is the significant one: left as-is, an anonymous booking form would have
been a User-creation endpoint, and would hard-fail whenever the email already
belonged to somebody.

---

## 5. Tests — `clinic_core/tests/test_public_booking.py`

**28 tests, all passing.** Covering the ten required scenarios:

| Requirement | Test |
|---|---|
| guest can list departments | `test_guest_can_list_departments` |
| guest can list bookable doctors | `test_guest_can_list_bookable_doctors` |
| guest can get available slots | `test_guest_can_get_available_slots` |
| guest can create a valid appointment | `test_guest_can_create_a_valid_appointment` |
| guest cannot book an unavailable slot | `test_guest_cannot_book_an_unavailable_slot` |
| two people cannot book the same slot | `test_two_people_cannot_book_the_same_slot` |
| guest cannot access patient records | `test_guest_cannot_list_patients`, `test_guest_cannot_read_a_patient_record` |
| guest cannot access clinical notes | `test_guest_cannot_access_clinical_notes` |
| guest cannot access invoices | `test_guest_cannot_access_invoices` |
| bad input is rejected | 8 tests in `TestInputValidation` |

Plus: no-User-creation, patient reuse on rebooking, booked slots disappearing
from the public list, and field-smuggling rejection.

### No regressions

The pre-existing suite still passes in full:

```
[1/4] sync + syntax check ......... all files compile OK
[2/4] API surface ................. 32/32 endpoints importable and whitelisted
[3/4] security unit tests ......... Ran 9 tests ... OK
[4/4] end-to-end HTTP scenario .... passed: 41   failed: 0
RESULT: ALL SUITES PASSED
```

---

## Deploying these changes

The files live in `backend/clinic_core/` in this repo and are copied into the
bench. To sync:

```powershell
$src = "…\clinic-platform\backend\clinic_core"
$dst = "\\wsl.localhost\Ubuntu-24.04\home\fawwad\projects\clinic-platform\backend\frappe-bench\apps\clinic_core\clinic_core"
Copy-Item "$src\api\v1\public\*.py" "$dst\api\v1\public\" -Force
Copy-Item "$src\api\response.py"    "$dst\api\response.py" -Force
Copy-Item "$src\tests\test_public_booking.py" "$dst\tests\" -Force
```

Then run the tests:

```powershell
wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/test-backend.sh
```

---

## Still outstanding (not addressed here)

* `auth.generate_token` for proper mobile token auth
* The upstream `set_request_status` IDOR — `clinic_core` avoids it, but the
  Marley endpoint is still directly callable
* TLS
