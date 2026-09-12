# Patient Mobile Account — Status

Assessed 2026-09-11 against the running backend. A row is ✅ only when it was
exercised end-to-end with real Frappe/Marley/ERPNext data — never because a
screen renders.

| feature | status | evidence |
|---|---|---|
| Phone login | ✅ | national / E.164 / spaced / `0092…` all reach one account |
| OTP (generation & verification) | ✅ | hashed + salted, 5-min expiry, single use, 5-attempt cap, rate limited, uniform failures |
| OTP **delivery** | ⚠️ | Evolution API (WhatsApp) provider implemented and self-tested (21/21) incl. number validation, but **credentials not yet configured**, so the active provider is still `console` — codes print to the bench log |
| Patient mapping | ✅ | `Patient Phone Mapping`, real UNIQUE indexes on phone/patient/user |
| Session | ✅ | SecureStore, server-confirmed on cold start, persona routing |
| Home | ✅ | `patient.home` — next appointment, counts, recent visits |
| Profile | ✅ | `patient.me`; identity fields read-only by design |
| Contact info | ✅ | `patient.update_me`, allowlist = email + secondary phone |
| Appointments | ✅ | Upcoming / Past / Cancelled, own records only |
| Book appointment | ✅ | `HLC-APP-2026-00072` booked with no patient id sent |
| Reschedule | ✅ | re-validated against the server's own slot list |
| Cancel | ✅ | ownership re-checked; A cannot cancel B's |
| Visit history | ✅ | completed appointments + linked encounters |
| Clinical records | ✅ | patient-safe projection; notes never serialised |
| Prescriptions | ⚠️ | endpoint verified and scoped, but this site has **0 `Drug Prescription` rows / 0 `Medication` masters**, so only the empty state has rendered |
| Diagnostics | ⚠️ | implemented + `enabled:true`, but this site has **0 `Lab Test` rows**, so only the empty state has rendered |
| Invoices | ✅ | own invoices, summary, detail, PDF share |
| Security isolation | ✅ | every cross-patient attempt denied; 404 ≡ 403 |
| Logout | ✅ | server session killed, credential wiped, query cache cleared |

Legend: ✅ verified end-to-end · ⚠️ built and reachable, not fully exercised · ❌ missing

## Score

16 of 19 verified end-to-end, 3 partial (0.5 each):

**PATIENT MOBILE ACCOUNT COMPLETION: 92%**

## OTP delivery — no SMS is being sent yet

The app says *"Verification code sent"* on every request, because that response
is deliberately identical whether the number exists or not (§3 of
PATIENT_AUTH.md — it must not become an account-existence oracle). It is **not**
a claim that an SMS reached the handset.

The active provider is `console` (`site_config.json` → `clinic_otp_provider`),
which prints the code to the bench log. `SmsOtpProvider` and
`WhatsAppOtpProvider` are written and selectable, but neither has credentials on
this site, so nothing is dispatched to a real phone.

**WhatsApp now goes through Evolution API**, not Meta's Cloud API. It validates
the number first (`POST /chat/whatsappNumbers/{instance}`) and refuses a
non-WhatsApp number with *"This number is not registered on WhatsApp. Please use
a number that has WhatsApp."* rather than swallowing the code. Verified by
`clinic_core.otp.evo_selftest.run` — 21 assertions against a stub server,
covering the happy path, refusal, fail-open when the checker errors, and the
credentials-missing case. Fill in the four `clinic_evolution_*` keys (see
`backend/site_config.example.json`) and run
`clinic_core.otp.diagnose.check` to confirm the instance is connected.

To read a code while testing on a device:

```bash
bench --site clinic.localhost execute \
  clinic_core.api.v1.dev_otp.peek \
  --kwargs "{'phone_number': '03451110001'}"
```

To go live, set `clinic_otp_provider` to `sms` (with Frappe SMS Settings
configured) or `whatsapp` (with `clinic_whatsapp_token`,
`clinic_whatsapp_phone_id` and an approved template). No code change is needed —
that is what the abstraction is for. `ConsoleOtpProvider` refuses to run at all
once `developer_mode` is off, so a production site cannot silently keep logging
codes instead of sending them.

## The other two ⚠️, honestly

**Prescriptions and Diagnostics.** Both are implemented, both are scoped to the
caller, and both refuse another patient's records — the ownership guard is the
same `guard.own` used by the endpoints that *are* proven, so the security
property is not in doubt. What is unproven is the **display of real content**:
this clinic's database contains

```
Lab Test rows          : 0
Drug Prescription rows : 0
Medication masters     : 0
```

so those two screens have only ever rendered their empty state. Marking them ✅
would be marking a screen complete because the UI exists, which the brief
explicitly rules out. They move to ✅ once a submitted encounter carries a real
`Drug Prescription` row, and a submitted, approved `Lab Test` exists to open.

Nothing blocks the MVP on this: diagnostics are an optional module by design, and
the prescription path is exercised structurally by
`test_clinical_notes_never_leave_the_server` (which reads an encounter's child
tables through the same projection).

## Not built (deliberate, out of scope)

* **Push notifications** — no service wired. The code is structured for it: every
  mutation invalidates `['patient']`, and each event worth sending maps to an
  existing query key.
* **In-app payment** — a patient may view balances and share an invoice PDF.
  Paying would need a real gateway integration; a patient must never be able to
  mark an invoice paid or touch a Payment Entry.
* **Emergency contact editing** — read-only, and only shown when the install
  records those fields.

## Fixes made after the first device test

Three things surfaced only once the app ran on a real phone:

1. **Backend unreachable over Wi-Fi.** `mobile/.env` was pinned to the old
   hotspot gateway (`192.168.137.1`). Repaired, and `scripts/setup-lan-access.ps1`
   now re-derives the Wi-Fi and WSL addresses, fixes the portproxy/firewall and
   rewrites `.env` — both addresses drift, which is what breaks this repeatedly.

2. **"We sent a code to your number" was untrue in development.** The active
   provider is `console`, which prints to the server log; nothing was dispatched.
   `request_otp` now reports the transport (developer_mode only), and the OTP
   screen says *"Development mode — no SMS was sent"* with the command to read
   the code, instead of implying a message is in flight.

3. **`₹` shown instead of `Rs`.** `patient_billing.summary` fell back to
   `Global Defaults.default_currency`, which is `INR` on this site (ERPNext's
   `_Test Company` fixtures set it), even though the clinic and every invoice are
   `PKR`. It now reads the company's own currency. `InvoiceCard` separately
   derived its badge with `currency.slice(0, 2)` — rendering "IN"/"US" for other
   currencies — and now uses the shared `currencySymbol`.

Also replaced the free-text `YYYY-MM-DD` date-of-birth input with a
`DateOfBirthField` picker (day/month/year wheels in the existing BottomSheet, no
new dependency) on both the patient registration and staff patient-creation
screens. A typed DOB invites `1990-13-45` and, worse, plausible-but-wrong dates
in a medical record.

## Regression check on existing roles

| suite | result |
|---|---|
| All backend modules (Admin, Doctor, Reception, public booking, security) | **132 passed, 0 failed** |
| Mobile Jest (74 pre-existing + 10 new) | **84 passed, 0 failed** |
| `tsc --noEmit` | clean |

Admin, Receptionist, Doctor and public guest booking are unchanged and passing.

---

## Updated MVP feature scoring

The sixth category joins the five from `docs/qa/01_FEATURE_COVERAGE.md`:

| # | category | completion |
|---|---|---|
| 1 | Admin | 92% |
| 2 | Receptionist | 92% |
| 3 | Doctor | 92% |
| 4 | Public / guest booking | 95% |
| 5 | Cross-cutting (auth, theme, errors, offline) | 92% |
| 6 | **Patient mobile account** | **92%** |

Categories 1–5 are carried forward from the previous QA baseline and were not
re-assessed in this pass; only their test suites were re-run (all passing).
