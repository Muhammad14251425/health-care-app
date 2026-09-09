# Mobile — React Native (Expo SDK 54)

**Status:** placeholder. Not started, deliberately — the backend was the first deliverable and
is now working and tested.

## When you start

```bash
npx create-expo-app@latest . --template blank-typescript
```
Target: **Expo SDK 54**, TypeScript.

## Backend contract

Base URL depends on where the app runs:

| Environment | Base URL |
|---|---|
| iOS simulator | `http://localhost:8000` |
| **Android emulator** | `http://10.0.2.2:8000` ← `10.0.2.2` is the emulator's alias for the host loopback |
| Physical device | `http://<windows-lan-ip>:8000` (needs a `netsh portproxy` rule into WSL + a firewall allow rule; same Wi-Fi) |

All endpoints: `POST /api/method/clinic_core.api.v1.<module>.<function>`
Full reference: [`../docs/API.md`](../docs/API.md).

### Response envelope

Frappe wraps every response in `message`:

```ts
type ApiEnvelope<T> = {
  message: {
    success: boolean;
    data: T | null;
    message?: string | null;
    error?: { code: ErrorCode; message: string };
  };
};

type ErrorCode =
  | "UNAUTHENTICATED"   // 401 -> route to login
  | "FORBIDDEN"         // 403 -> show "not allowed"
  | "NOT_FOUND"         // 404
  | "VALIDATION_ERROR"  // 400 -> show field errors
  | "CONFLICT"          // 409 -> e.g. slot taken; refresh the slot list
  | "INTERNAL_ERROR";   // 500 -> generic retry
```

Always unwrap `res.message`, then branch on `success`.

### Auth

Use **API token auth**, not cookies — see [`../docs/03_AUTH_ARCHITECTURE.md`](../docs/03_AUTH_ARCHITECTURE.md).

```
Authorization: token <api_key>:<api_secret>
```
Store with `expo-secure-store` (Keychain/Keystore). **Never** bundle Administrator
credentials or an ERPNext API secret in the app.

> ⚠️ The token-issuing endpoint (`auth.generate_token`) is **not yet implemented**. Until it
> is, `auth.login` establishes a session you can use in the simulator. Token auth is the
> shipping design.

### Personas

`auth.me` returns `persona`: `admin` · `reception` · `practitioner` · `patient`.
Use it to choose the navigation stack — but treat it as a **UI hint only**. Every endpoint
enforces its own authorization server-side; hiding a button is not a security control.

## First screens worth building

1. Login → store token → `auth.me`
2. Receptionist: patient search → practitioner list → `available_slots` → `create_appointment`
   (handle `CONFLICT` by refreshing slots)
3. Doctor: today's appointments → patient → create encounter
4. Billing: invoice → record payment (supports partial)

## Testing against the backend

```powershell
wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/start.sh
```
Test credentials are in [`../docs/FINAL_BACKEND_STATUS.md`](../docs/FINAL_BACKEND_STATUS.md) §10.
Import [`../docs/clinic-api.postman_collection.json`](../docs/clinic-api.postman_collection.json)
to explore the API before writing client code.
