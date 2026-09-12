# Patient Authentication — Phone + OTP

Implemented in `clinic_core/api/v1/patient_auth.py`, `phone.py`, `clinic_core/otp/`
and the `Patient Phone Mapping` / `Patient OTP Request` DocTypes.

---

## 1. The account model

```
   what the patient types:  "0345 122 0001"
                │
                ▼  clinic_core.api.v1.phone.normalize()   (SERVER side)
        +923451220001
                │
                ▼  Patient Phone Mapping   (UNIQUE on phone_e164, patient AND user)
   patient: HLC-PAT-2026-00042
   user:    p3f9a…@patient.clinic.internal
                │
                ▼  OTP verified → Frappe session
   every later request resolves the patient from frappe.session.user
```

### Why a mapping DocType rather than matching `Patient.mobile`

`Patient.mobile` is free text with no uniqueness, and the live database already
held the same country's numbers in two shapes (`+923005551234` beside
`03009332202`). Four concrete reasons:

1. **Uniqueness is enforceable.** `phone_e164`, `patient` and `user` each carry a
   real UNIQUE index in MariaDB (verified with `SHOW INDEX`). One phone → one
   patient → one user, guaranteed by the database, not by convention.
2. **Auth identity is separate from a contact detail.** A receptionist fixing a
   patient's contact number must not silently move their login.
3. **Ambiguity becomes detectable** rather than "first row wins" — see §5.
4. It is a proper Frappe relationship (Link fields), not a workaround.

`Patient.user_id` is kept in step by the mapping's `on_update` (via `db_set`,
which is what Marley's own `invite_user` path uses), because `current_patient()`
reads it. It is a `Read Only`, non-unique field, so it is a *mirror*, never the
source of truth.

## 2. Endpoints

| endpoint | guest | purpose |
|---|---|---|
| `patient_auth.request_otp` | yes | send a login code |
| `patient_auth.verify_otp` | yes | verify and start a session |
| `patient_auth.register` | session, unlinked | first-login profile (Case B) |
| `patient_auth.logout` | session | end the session server-side |
| `patient_auth.request_phone_change` | session | code to a NEW number |
| `patient_auth.confirm_phone_change` | session | move the mapping |
| `patient_auth.session_valid` | session | cold-start probe |
| `patient_auth.clear_rate_limit` | operator (bench) | unblock a locked-out number |

## 3. OTP policy

| control | value | why |
|---|---|---|
| length | 6 digits, `secrets.randbelow` | never `random` |
| expiry | 5 minutes | `OTP_TTL_SECONDS` |
| verify attempts | 5, then the code dies | 1-in-200,000 per issuance |
| single use | `consumed` set before a session is issued | no replay |
| storage | `sha256(salt + code)`, per-row salt | a table dump grants nothing |
| comparison | `hmac.compare_digest` | not timing-distinguishable |
| resend cooldown | 45 s | matches the app's countdown |
| issuance cap | 5 per number/hour, 20 per IP/hour | abuse + SMS cost |
| logging | never in production | console provider is developer-mode only |

### No account oracle

`request_otp` returns an identical envelope — same `success`, same message, same
keys — whether the number belongs to a patient, to nobody, to a blocked account,
or to an ambiguous one. An attacker cannot ask "is Ali Khan a patient here?".

`verify_otp` collapses **every** rejection into one message:

> "That code is not valid or has expired. Please request a new one."

wrong code · expired · already used · attempt cap reached · no code ever issued ·
unknown number — all identical. Each distinction would be a free bit about an
account the caller does not own. Asserted by
`test_wrong_and_unknown_phone_give_identical_messages`.

Rate-limit refusals are likewise uniform: saying "you hit the *per-number* cap"
would itself confirm the number is in use
(`test_rate_limited_message_does_not_reveal_which_limit`).

## 4. Provider abstraction

```python
class OtpProvider:
    def send(self, phone_e164, code, purpose="login"): ...
```

Selected by `site_config.json` → `clinic_otp_provider`:

| value | class | notes |
|---|---|---|
| `console` | `ConsoleOtpProvider` | dev only — **refuses to run unless `developer_mode`** |
| `null` | `NullOtpProvider` | tests |
| `sms` | `SmsOtpProvider` | Frappe SMS Settings gateway |
| `whatsapp` *(alias `evolution`)* | `WhatsAppOtpProvider` | self-hosted **Evolution API** |

Credentials live in `site_config.json` on the server. **No gateway key is ever
shipped in the mobile bundle** — it would be extractable, and any holder could
send messages billed to the clinic.

A provider that cannot deliver raises `OtpDeliveryError`; `_issue_otp` then rolls
back the challenge row, so a failed send does not consume the patient's quota or
leave a code that was never delivered.

### WhatsApp via Evolution API

Evolution is a WhatsApp Web bridge, not Meta's Cloud API, so there is **no
template approval step** — the code goes out as plain text from the linked
account.

Configure in `sites/<site>/site_config.json` (full template with comments:
`backend/site_config.example.json`):

```json
{
  "clinic_otp_provider":            "whatsapp",
  "clinic_evolution_url":           "https://evo.example.com",
  "clinic_evolution_api_key":       "<instance apikey>",
  "clinic_evolution_instance":      "clinic",
  "clinic_evolution_verify_number": 1,
  "clinic_evolution_timeout":       10
}
```

The apikey travels in the `apikey` **header**, never in a URL, so it does not
leak into request logs or tracebacks.

**Each send makes two calls:**

```
1. POST /chat/whatsappNumbers/{instance}   does this number have WhatsApp?
2. POST /message/sendText/{instance}       send the code
```

Step 1 exists because Evolution accepts an unregistered number and reports
success while the message goes nowhere. Without the check a patient would sit on
the verify screen waiting for a code that can never arrive. With it they get an
immediate, actionable error:

> This number is not registered on WhatsApp. Please use a number that has WhatsApp.

**The check fails *open*.** `has_whatsapp()` returns `True`/`False` when Evolution
answers and **`None`** when it cannot (network error, unexpected shape). `None`
falls through to attempting the send — telling a patient their number is invalid
because the *checker* broke would lock them out of their own records.

Note the deliberate privacy trade-off: every other OTP response is identical
regardless of the number, so the endpoint cannot be used to probe who has an
account here. This one reveals whether a number is on WhatsApp — a fact about
WhatsApp, not about this clinic, and one anyone can learn from WhatsApp directly.

**Verify the setup before relying on it:**

```bash
# config + reachability + instance connection state (never prints the apikey)
bench --site clinic.localhost execute clinic_core.otp.diagnose.check

# ...and whether one number has WhatsApp
bench --site clinic.localhost execute clinic_core.otp.diagnose.check \
  --kwargs "{'phone_number': '03001234567'}"

# send a real message with an obviously-fake code (no OTP row is created)
bench --site clinic.localhost execute clinic_core.otp.diagnose.send_test \
  --kwargs "{'phone_number': '03001234567'}"

# offline self-test of the whole provider against a stub server (21 assertions)
bench --site clinic.localhost execute clinic_core.otp.evo_selftest.run
```

`diagnose.check` reports the instance's `connectionState`, so "the QR was never
scanned" is caught before a patient hits it.

## 5. First login

**Case A — the number matches exactly one Active Patient.**
Link it: create the User, write `user_id`, create the mapping, sign in.
No duplicate Patient is created (`test_login_links_existing_patient_without_duplicating`).

Matching tolerates legacy free-text spellings via `phone.variants()`, then
**re-normalises every candidate** before accepting it, so a lookalike that merely
shares a substring cannot slip through.

**Case B — the number matches no Patient.**
The OTP still verifies (otherwise the response would leak that the number is
unknown). The session comes back flagged `needs_registration`, and only
`patient_auth.register` is usable until it completes: full name (required),
gender (required — Marley makes `Patient.sex` mandatory, and
`"Prefer not to say"` is offered), DOB and email optional. Patient + User +
mapping are then created together.

`register` re-checks for a match at commit time, in case reception created the
patient between the OTP and the form.

**Case C — the number matches two or more Active Patients.**
**Refused.** A neutral "we could not verify this number automatically, please
contact the clinic" plus an admin-visible log entry. Never a guess —
`frappe.db.get_value` returns an arbitrary row, and picking one means signing
someone into a stranger's medical record.

## 6. Changing the login number

Phone is the credential, so it is never a text edit:

```
authenticated patient → enter new number → OTP sent TO THE NEW NUMBER
   → verify → mapping.phone_e164 updated → Patient.mobile kept in step
```

Sending the code to the new number is what proves control of it. A number
already mapped to another account is refused with neutral wording, which
prevents both takeover and using the endpoint to discover who else is a patient.
The `change_phone` purpose is stored on the challenge, so a login code can never
authorise a phone change.

## 7. Sessions

`_start_session` uses `LoginManager.login_as()` — Frappe's own supported
"sign in as this user without a password" path, so the resulting session is
indistinguishable from a password login downstream.

`LoginManager.__init__` reads `frappe.local.request.path`, which does not exist
outside an HTTP request; in a console, background job or test it raises
`AttributeError: request`. `_start_session` catches that and falls back to
`frappe.set_user()`, so non-HTTP callers get a working session instead of an
opaque 500.

## 8. Operating notes

**A patient locked out by the hourly cap** is cleared with:

```bash
bench --site clinic.localhost execute \
  clinic_core.api.v1.patient_auth.clear_rate_limit \
  --kwargs "{'phone_number': '03451220001'}"
```

This exists because the counters are built on `get_value`/`set_value` rather
than redis `INCR`: `INCR` writes a bare integer that Frappe's pickle-based
`get_value`/`delete_value` cannot read or delete, which would have made the
limiter impossible to clear without flushing the entire site cache.

**Blocking an account** without deleting it: set the mapping's `status` to
`Blocked`. `request_otp` then issues no code while still returning the normal
response, and `verify_otp` refuses with a neutral message.

## 9. Testing on a real phone

### Reaching the backend over Wi-Fi

The bench runs inside WSL2 on a private NAT address the phone cannot route to,
so the chain is:

```
phone ──wifi──> <windows-wifi-ip>:8000 ──netsh portproxy──> <wsl-ip>:8000
```

Both addresses move — the Wi-Fi one via DHCP, the WSL one on every WSL restart —
which is the usual reason the app "suddenly can't reach the backend". Repair all
of it with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-lan-access.ps1
```

It re-derives both addresses, fixes the portproxy and firewall rule, rewrites
`mobile/.env`, and probes the URL. It reports accurately when run unelevated,
but needs an **admin prompt** to actually change the portproxy or firewall.

Then restart Expo so it picks up the new env: `npx expo start -c`.

Three things to check if the phone still cannot connect:

* bench must bind `0.0.0.0`, not loopback (`bench serve --port 8000`)
* the phone and laptop must be on the same network
* a **Public** Wi-Fi profile applies the strictest filtering; the script prints
  the exact command to switch it to Private

Confirm the path from the phone's browser: `http://<ip>:8000/api/method/ping`
should return `{"message":"pong"}`.

### Reading the OTP

Codes are only ever stored hashed, so there is nothing to look up in the
database. In development, recover one with:

```bash
bench --site clinic.localhost execute \
  clinic_core.api.v1.dev_otp.peek \
  --kwargs "{'phone_number': '03451110001'}"
```

It brute-forces the 6-digit space against the stored hash — the same work an
attacker would face, which is why the implementation is not weakened to expose
codes. The helper is guarded twice (developer_mode **and** Administrator) and is
not whitelisted, so it returns 403 over HTTP and does nothing at all on a
production site.

`dev_otp.reset` clears issued codes and rate limits for a number that has got
stuck during testing.
