# Web — Next.js (TypeScript)

**Status:** placeholder. Not started. Mobile comes first; the backend is frontend-independent
and ready for both.

## When you start

```bash
npx create-next-app@latest . --typescript --app
```

## Backend contract

Same API as mobile: `POST /api/method/clinic_core.api.v1.<module>.<function>`
Full reference: [`../docs/API.md`](../docs/API.md) · envelope described in
[`../mobile/README.md`](../mobile/README.md).

Dev backend: **http://localhost:8000**

## Auth — differs from mobile

Web uses the **Frappe session cookie** (`sid`), not a token:

- `HttpOnly` + `Secure` + `SameSite=Lax` — not readable from JavaScript, so XSS cannot steal it.
- Client fetches must send `credentials: "include"`.
- Server Components/Route Handlers must forward the incoming cookie.
- **CSRF stays enabled.** Read the token from `frappe.csrf_token` on the bootstrapped page and
  send it as `X-Frappe-CSRF-Token` on writes. Do **not** disable CSRF to make development easier.

Rationale: [`../docs/03_AUTH_ARCHITECTURE.md`](../docs/03_AUTH_ARCHITECTURE.md).

## CORS — must be configured before this starts

Not needed today (no browser origin calls the API yet). When Next.js runs on its own origin,
add an **explicit allowlist** to `sites/clinic.localhost/site_config.json`:

```json
{ "allow_cors": ["http://localhost:3000"] }
```

**Never `Access-Control-Allow-Origin: *`.** It is unsafe with credentialed requests, and
browsers reject that combination anyway.

## Likely scope

An admin/reception dashboard:
- Appointment calendar (day/week per practitioner)
- Patient records and visit history
- Practitioner schedule management
- Invoices, payments, outstanding balances
- User/role administration

Reuse the same API contract as mobile so business logic stays server-side in `clinic_core`.
