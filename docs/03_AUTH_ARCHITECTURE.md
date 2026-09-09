# 03 — Authentication Architecture

**Decision date:** 2026-09-09
**Applies to:** React Native (Expo SDK 54) first, Next.js later
**Backend:** Frappe v16.33.1 on `clinic.localhost`

---

## 1. Decision

| Client | Mechanism | Credential storage |
|---|---|---|
| **React Native (Expo 54)** | **Frappe API key/secret** — `Authorization: token <api_key>:<api_secret>`, issued per user after a password login | `expo-secure-store` (Keychain / Keystore) |
| **Next.js (web)** | **Frappe session cookie** (`sid`), `HttpOnly` + `Secure` + `SameSite=Lax` | Browser cookie jar — never JS-readable |
| **Server-to-server** | API key/secret of a dedicated service user | Server env vars only |

**Rationale for the split:** cookies are the right answer in a browser (HttpOnly defeats
XSS token theft, and same-site posture is enforced by the browser). Cookies are the *wrong*
answer in React Native — see §3.

---

## 2. Why not the obvious alternatives

| Option | Verdict | Reason |
|---|---|---|
| Session cookie on React Native | ❌ | RN's `fetch` cookie handling is inconsistent across iOS/Android; no `HttpOnly` protection benefit outside a browser; cookie persistence across app restarts is unreliable; CSRF tokens must be threaded manually. |
| OAuth2 (Frappe supports it) | ⚠️ Later | Frappe ships an OAuth2 provider, and it is the right destination for third-party or multi-tenant access. It is **over-engineered for a first-party clinic app** and adds a redirect/PKCE flow before there is a product. Revisit if we add third-party integrations or SSO. |
| Long-lived JWT minted by us | ❌ | Frappe has no native JWT session concept; we would be building a parallel auth system and a revocation story from scratch. API key/secret already gives per-user, individually-revocable credentials. |
| Administrator API key in the app | ❌ **Never** | Explicitly prohibited by the brief and correct: a shipped binary is not a secret store. Any user could extract it and act as Administrator. |

---

## 3. Why token auth for mobile, concretely

1. **No CSRF surface.** Frappe enforces CSRF on cookie-authenticated write requests. A
   token-authenticated request carries no ambient credential, so CSRF does not apply and we
   never need to weaken `ignore_csrf` globally (the brief forbids this, rightly).
2. **Explicit, inspectable.** The `Authorization` header is set by our API client; there is no
   hidden cookie-jar state to debug across platforms.
3. **Per-user revocation.** Clearing `api_secret` on the User record instantly kills exactly
   that device's access, without touching other users or other sessions.
4. **Survives app restarts** deterministically via `expo-secure-store`.

---

## 4. Flow

### 4.1 Login (mobile)
```
POST /api/method/clinic_core.api.v1.auth.login
{ "usr": "...", "pwd": "..." }
      │
      ├─ password verified by Frappe's LoginManager
      ▼
{ "success": true, "data": { user, full_name, roles, persona, patient, practitioner, sid } }
```
The app then requests a token pair (endpoint to be added — see §7), stores it in
`expo-secure-store`, and **discards the password**.

Every subsequent call:
```
Authorization: token <api_key>:<api_secret>
```

### 4.2 Login (web, later)
Next.js posts the same `auth.login`; the browser retains the `sid` cookie. Server components
forward the cookie; client components rely on `credentials: "include"`. CSRF token is read
from `frappe.csrf_token` on the bootstrapped page.

### 4.3 Session validation
`GET|POST /api/method/clinic_core.api.v1.auth.session_valid` → `{"valid": true, "user": ...}`
Cheap probe used on app resume. A `401` means the stored credential is dead → route to login.

### 4.4 Current identity
`clinic_core.api.v1.auth.me` returns roles **and a resolved `persona`**
(`admin` | `reception` | `practitioner` | `patient`), plus the linked `patient` /
`practitioner` record ids. The client uses `persona` to choose its navigation stack.

> ⚠️ `persona` and `roles` are **UI hints only**. Every endpoint independently enforces its own
> authorization server-side. Hiding a button is not a security control — see
> `docs/02_API_SECURITY_AUDIT.md`.

### 4.5 Logout
`clinic_core.api.v1.auth.logout` clears the server session. On mobile, the app **must also**
delete the stored token from `expo-secure-store` — the token outlives the session and is the
real credential.

---

## 5. Expiry, rotation, revocation

| Concern | Approach |
|---|---|
| Session lifetime | `System Settings.session_expiry` (default `06:00`). Affects cookie sessions only. |
| Token lifetime | API key/secret do **not** expire by default. |
| Rotation | Re-issue on demand; a new secret invalidates the old one. |
| Revocation | Clear `api_secret` on the User, or disable the User. Immediate. |
| Compromise response | Disable user → rotate secret → re-login on trusted devices. |
| Brute force | Frappe rate-limits failed logins; `auth.login` returns a **generic** "Invalid credentials." for both unknown-user and wrong-password, so the endpoint cannot be used to enumerate accounts. |

---

## 6. Network / CORS / CSRF posture

- **CSRF is left ENABLED.** It was never disabled to make development easier. Token-auth
  requests are not subject to it; cookie-auth web clients will send the token properly.
- **CORS:** not required today — the dev app talks to the API directly with no browser origin.
  When Next.js arrives, set an explicit allowlist of origins in `site_config.json`.
  **`Access-Control-Allow-Origin: *` is never acceptable** with credentialed requests, and the
  browser refuses that combination anyway.
- **Transport:** development is plain HTTP on the LAN. **TLS is mandatory before any real
  patient data exists** — a bearer token over cleartext HTTP is a credential on the wire.

### Reaching the backend from a device

| Client | URL | Note |
|---|---|---|
| Windows host browser | `http://localhost:8000` | WSL2 localhost forwarding — **verified working** |
| Windows host (alt) | `http://172.19.208.178:8000` | WSL IP — **verified working**; changes on WSL restart |
| Android emulator | `http://10.0.2.2:8000` | `10.0.2.2` is the emulator's alias for the host loopback |
| iOS simulator | `http://localhost:8000` | Shares the host network stack |
| **Physical device** | `http://<windows-lan-ip>:8000` | Needs a `netsh portproxy` rule from the Windows LAN IP into WSL **and** a firewall allow rule. Same Wi-Fi network required. |

`clinic.localhost` does **not** resolve from Windows (the hosts file needs admin rights, which
were unavailable). This is not a blocker: `serve_default_site` is enabled, so plain
`localhost:8000` serves the site correctly. To use the hostname, add as Administrator:
```
127.0.0.1 clinic.localhost
```

---

## 7. Not yet implemented

1. **Token-issuing endpoint.** `auth.login` currently establishes a session and returns the
   profile + `sid`. `clinic_core.api.v1.auth.generate_token` (authenticated, returns
   `api_key`/`api_secret` for the *calling* user, never another) still needs to be added.
   Until then, mobile can work against session auth in the simulator, but **token auth is the
   shipping design**.
2. **TLS.** Required before any non-synthetic data.
3. **CORS allowlist.** Add when Next.js work starts.
4. **Rate limiting on `auth.login`** beyond Frappe's defaults.
