# Clinic Core

Frappe app providing the clinic API used by the mobile app: staff scheduling,
the patient portal (phone + OTP), and public/guest booking.

Built on top of **ERPNext** and **Healthcare (Marley)** — both are required and
declared in `hooks.py` as `required_apps`.

## What it adds

| Area | Detail |
|---|---|
| `api/v1` | Appointments, patients, practitioners, encounters, invoices, payments, slots |
| `api/v1/patient*` | Patient portal: auth, records, billing, appointments |
| `api/v1/public` | Guest booking — departments, practitioners, availability |
| Doctypes | `Patient OTP Request`, `Patient Phone Mapping` |

Permissions are enforced server-side on every endpoint. The mobile app hides
controls a role cannot use, but that is a usability choice, never the control.

## Install

```bash
bench get-app clinic_core <repo-url>
bench --site <site> install-app clinic_core
```

Then copy the keys you need from `site_config.example.json` into the site's real
`site_config.json`.

## Scheduled jobs

`purge_expired` runs daily to delete spent OTP rows (see `hooks.py`).
