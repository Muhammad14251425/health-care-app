# FINAL BACKEND STATUS

**Date:** 2026-09-09
**Verdict:** ✅ **Working, tested development backend.** Full clinic workflow proven end-to-end
over real HTTP. One P0 upstream vulnerability is documented and mitigated at our API layer but
**not yet neutralised at source** — see §5 and §13.

---

## 1. Installed versions

All read from the running system, not assumed.

| Component | Version | Branch @ commit | Verified |
|---|---|---|---|
| **Frappe** | **16.33.1** | `version-16` @ `988e54f` (tag v16.33.1) | ✅ |
| **ERPNext** | **16.34.2** | `version-16` @ `4048fb7` (tag v16.34.2) | ✅ |
| **Marley (healthcare)** | **16.5.2** | `version-16` @ `934d6c1` (tag v16.5.2) | ✅ |
| **clinic_core** | **0.0.1** | `mit` @ `8e30643` | ✅ |
| **Python** | **3.14.6** | — | ✅ satisfies frappe's hard pin `>=3.14,<3.15` |
| **Node** | **v24.20.0** | — | ✅ satisfies `engines.node >=24` |
| **npm / Yarn** | 11.19.0 / **1.22.22** | — | ✅ Yarn *must* be 1.x (classic) |
| **MariaDB** | **10.11.14** | utf8mb4 / utf8mb4_unicode_ci | ✅ |
| **Redis** | **7.0.15** | :6379 + bench :11000/:13000 | ✅ |
| **bench CLI** | 5.31.0 | — | ✅ |
| **wkhtmltopdf** | 0.12.6.1 (patched qt) | — | ✅ |
| **uv** | 0.11.33 | — | ✅ |
| **OS** | Ubuntu 24.04.4 LTS on WSL2 | kernel 6.18.33.2 | ✅ |

**Compatibility was verified from upstream manifests, not guessed:** ERPNext v16 requires
`frappe>=16.21.0` (satisfied by 16.33.1); Marley requires `frappe>=16.0.0,<17` **and**
`erpnext>=16.0.0,<17` (both satisfied). No `develop` branch anywhere.

**Footprint:** 2.0 GB bench, 8.3 GB total install.

---

## 2. Working features

### Platform
| Feature | Status |
|---|---|
| WSL2 Ubuntu 24.04 dev environment | ✅ Working |
| Source in Linux fs (`~/projects/...`, not `/mnt/c`) | ✅ Working |
| MariaDB + Redis as systemd services (survive reboot) | ✅ Working |
| Site `clinic.localhost` serving HTTP | ✅ Working |
| Developer mode enabled | ✅ Working |
| Reachable from Windows (`localhost:8000`) | ✅ Working |
| Backup / restore | ✅ Working (verified, 1.1 MB dump) |
| Docker Desktop left untouched | ✅ As required |

### Clinical workflow
| Feature | Status |
|---|---|
| Create / update / search patient | ✅ Working |
| Patient contact info, visit history | ✅ Working |
| Patient duplicate detection | ⚠️ Working — surfaced as `possible_duplicates`, not auto-merged (deliberate) |
| Practitioner + user linkage | ✅ Working |
| Departments, schedules (Mon–Fri 09:00–17:00) | ✅ Working |
| Appointment slot listing | 🛠 **Fixed locally** — needed a Service Unit + a real doc probe (see §4/U2) |
| Create / reschedule / cancel appointment | ✅ Working |
| **Double-booking rejection** | ✅ Working — Marley's `OverlapError` → HTTP **409** |
| Appointment status transitions | ✅ Working (allowlisted values, staff-only) |
| Encounter create / notes / symptoms / diagnosis | 🛠 **Fixed locally** — `Table MultiSelect` handling (§4/S10) |
| Encounter submit + immutability | ✅ Working |
| Consultation invoice create + submit | 🛠 **Fixed locally** — 4 setup defects (§4/L1,S6,S7,S9) |
| Partial payment | ✅ Working — 1000 → pay 400 → outstanding 600 |
| Full payment | ✅ Working — → outstanding 0, status `paid` |
| Overpayment rejection | ✅ Working |
| Invoice status (`unpaid`/`partially_paid`/`paid`) | ✅ Working |

### Security
| Control | Status |
|---|---|
| Patient A cannot read Patient B | ✅ Working (HTTP 403) |
| Patient A cannot modify Patient B | ✅ Working |
| Patient A cannot list Patient B's appointments | ✅ Working |
| Patient cannot use staff endpoints | ✅ Working |
| Patient cannot record payments | ✅ Working |
| Receptionist gets scheduling data, **not** clinical notes | ✅ Working (fields omitted, not hidden) |
| Receptionist cannot create encounters | ✅ Working |
| Doctor cannot reach admin-only settings | ✅ Working |
| Unauthenticated calls blocked | ✅ Working (401/403) |
| No stack traces / SQL leaked to clients | ✅ Working (verified during development) |
| Login does not enable account enumeration | ✅ Working (generic failure message) |
| **Marley `set_request_status` IDOR** | ❌ **Broken upstream — see §5** |

### Not implemented (out of scope by instruction)
Inpatient, insurance, laboratory, therapy, complex procedures, non-English installs — ❌ not
worked on, per Step 17.

---

## 3. Test results

Single command: `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/test-backend.sh`

```
[1/4] sync + syntax check ................. all files compile OK
[2/4] API surface .......................... 32/32 endpoints importable and whitelisted
[3/4] security unit tests .................. Ran 9 tests ... OK
[4/4] end-to-end HTTP scenario ............. passed: 41   failed: 0
RESULT: ALL SUITES PASSED
```
The E2E scenario was run repeatedly and is **idempotent** (41/41 on consecutive runs).

---

## 4. Bugs found

| ID | Severity | Summary | Where fixed |
|---|---|---|---|
| **U3 / #1063** | **P0** | `set_request_status` lets any authenticated user mutate any doctype | ⚠️ **Not fixed upstream** — avoided in `clinic_core` |
| **#943** | **P0** | 160 whitelisted endpoints, 0 `only_for`, 4 `has_permission` | Gateway policy: only `clinic_core` is exposed |
| U2 / #1107-class | P1 | `get_availability_data` type-validation failure | `clinic_core` call site |
| L1 | P1 | `Unknown column 'tabContact.is_billing_contact'` — all billing broken | Ran official ERPNext v16 patch |
| S1–S8 | P1 | Missing setup-wizard masters (Gender, UOM, Fiscal Year, Price List, Round Off, Service Unit…) | `clinic_core/setup_masters.py` |
| S9 | P1 | Billing users lacked `Item` read → bare `PermissionError` | Seed grants `Item Manager` |
| S10 | P1 | `symptoms`/`diagnosis` are `Table MultiSelect`; `Complaint` field is `complaints` (plural) | `clinic_core/api/v1/encounters.py` |

Full detail: `docs/BUG_FIXES.md`, `docs/01_MARLEY_GITHUB_ISSUE_AUDIT.md`.

---

## 5. Open security concerns

### 🔴 P0 — `healthcare...set_request_status` is exploitable and still reachable
```python
@frappe.whitelist()
def set_request_status(doctype, request, status):
	frappe.db.set_value(doctype, request, "status", status)
```
Attacker-controlled doctype **and** record name, no permission check, ORM bypassed.
**Reproduced by a passing automated test**: a `Patient`-role user disabled another patient's
record.

- **Mitigated:** `clinic_core` never calls it; our `set_status` is hardened by construction.
- **NOT mitigated:** the upstream endpoint is still directly callable by any authenticated user.
- **Required before untrusted users:** an `override_whitelisted_methods` hook (§13, item 1).

### 🟠 P1 — 160 unguarded Marley endpoints
Only `clinic_core.api.v1.*` may be exposed publicly. Add a reverse-proxy deny rule for
`/api/method/healthcare.*`.

### 🟠 P1 — No TLS
Development is plain HTTP. **Mandatory before any real patient data** — a bearer token over
cleartext is a credential on the wire.

### 🟡 P2 — Dev credentials are weak and known
`admin123`, `TestPass123!`, `devroot123`. Development only; must never reach production.

### 🟡 P2 — Passwordless sudo for `fawwad`
Acceptable on an isolated dev VM; not for production.

---

## 6. APIs ready for React Native

**32 endpoints**, all verified whitelisted. Full reference: `docs/API.md`.
Postman collection (45 requests with assertions): `docs/clinic-api.postman_collection.json`.

| Module | Endpoints |
|---|---|
| `auth` | `login`, `logout`, `me`, `session_valid` |
| `patients` | `list_patients`, `get_patient`, `create_patient`, `update_patient`, `visit_history` |
| `practitioners` | `list_practitioners`, `get_practitioner`, `list_departments`, `availability` |
| `appointments` | `list_appointments`, `get_appointment`, `available_slots`, `create_appointment`, `reschedule_appointment`, `cancel_appointment`, `set_status` |
| `encounters` | `list_encounters`, `get_encounter`, `create_encounter`, `update_encounter`, `submit_encounter` |
| `invoices` | `list_invoices`, `get_invoice`, `create_consultation_invoice`, `submit_invoice`, `outstanding` |
| `payments` | `payment_history`, `record_payment` |

Consistent envelope, stable error codes, no internal leakage.

---

## 7. Features not yet implemented

| Item | Note |
|---|---|
| Token-issuing endpoint (`auth.generate_token`) | **Highest-value gap** for mobile — design is decided (`docs/03_AUTH_ARCHITECTURE.md`), code not written |
| TLS | Required before real data |
| CORS allowlist | Needed when Next.js starts |
| `set_request_status` override hook | §13 item 1 |
| WhatsApp / SMS / email reminders | Architecture reserved in `clinic_core`; nothing built |
| JazzCash / Easypaisa / PayFast | Same |
| Push / Expo notifications | Same |
| Public booking page, Next.js dashboard, RN apps | Deliberately not started |

---

## 8. Exact command to start the backend

```powershell
wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/start.sh
```

## 9. Local URL

**http://localhost:8000**

> `http://clinic.localhost:8000` does **not** resolve from Windows — the hosts file needs
> Administrator rights, which were unavailable. Not a blocker: `serve_default_site` makes plain
> `localhost:8000` serve the site. To enable the hostname, add as Administrator to
> `C:\Windows\System32\drivers\etc\hosts`:
> ```
> 127.0.0.1 clinic.localhost
> ```
> Also reachable at `http://172.19.208.178:8000` (WSL IP; changes on WSL restart).
> Android emulator: `http://10.0.2.2:8000`.

## 10. Test credentials

> ⚠️ **DEVELOPMENT ONLY. Entirely synthetic — no real patient information.**

| Role | Username | Password |
|---|---|---|
| Administrator | `Administrator` | `admin123` |
| Clinic Admin | `admin.clinic@test.local` | `TestPass123!` |
| Receptionist | `reception@test.local` | `TestPass123!` |
| Doctor | `doctor@test.local` | `TestPass123!` |
| Doctor 2 | `doctor2@test.local` | `TestPass123!` |
| Patient A | `patienta@test.local` | `TestPass123!` |
| Patient B | `patientb@test.local` | `TestPass123!` |
| MariaDB root | `root` | `devroot123` |

Test data: `Dr Test Doctor` & `Dr Second Doctor` (General Medicine, Mon–Fri 09:00–17:00),
`Test Patient A` & `Test Patient B`, company **Test Clinic** (PKR, Pakistan).

## 11. Test command

```powershell
wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/test-backend.sh
```

## 12. Git branches / commits

| Repo | Branch | Commit | State |
|---|---|---|---|
| `apps/frappe` | `version-16` | `988e54f` | pristine |
| `apps/erpnext` | `version-16` | `4048fb7` | pristine |
| `apps/healthcare` | `version-16` | `934d6c1` | **pristine — verified clean** |
| `apps/healthcare` | `clinic-dev` | `934d6c1` | branch ready, unused so far |
| `apps/clinic_core` | `mit` | `8e30643` | our work |

`upstream` remote configured on `healthcare` → `https://github.com/earthians/marley.git`,
so `git pull upstream version-16` stays conflict-free.

---

## 13. Recommended next steps

1. **🔴 Neutralise `set_request_status`** — add to `clinic_core/hooks.py`:
   ```python
   override_whitelisted_methods = {
       "healthcare.controllers.service_request_controller.set_request_status":
           "clinic_core.overrides.service_request.set_request_status_guarded",
   }
   ```
   The wrapper should allowlist the doctype, enforce `frappe.has_permission(doctype, "write", doc=request)`,
   and validate the status value. The existing test in
   `clinic_core/tests/test_security_marley.py` will then need inverting to assert the attack
   **fails** — that inversion is the proof the fix works.
2. **Add `auth.generate_token`** so React Native can move to token auth (design already decided).
3. **Report #1063 findings upstream** and track a fix rather than carrying a permanent override.
4. **Enable TLS** before any non-synthetic data.
5. Then start `mobile/` (Expo SDK 54 + TypeScript) against the documented API contract.

---

## 14. Honest limitations

- Concurrency was **not** stress-tested with genuinely parallel requests. Double-booking
  rejection is proven sequentially; Marley's check is a read-then-validate, so a true race
  under load has not been ruled out. Worth a dedicated test before production.
- Only the **happy paths plus the listed security paths** are covered. Deep edge cases in
  billing (credit notes, taxes, discounts, multi-currency) are untested.
- Print/PDF generation was not exercised.
- Disk headroom on the host is limited (~32 GB free at install). Monitor it.
- The E2E scenario creates real records each run; the site accumulates test data. Use
  `backup.sh`/`restore.sh` to reset if it becomes noisy.
