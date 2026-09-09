# Clinic Platform

Development backend for a clinic management system, built on
**Frappe v16 + ERPNext v16 + Marley Healthcare v16**, with all custom logic isolated in our own
Frappe app, **`clinic_core`**.

Status: ✅ **working, tested development backend** — see [docs/FINAL_BACKEND_STATUS.md](docs/FINAL_BACKEND_STATUS.md).

---

## Quick start

```powershell
# Start
wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/start.sh

# Test (32 endpoints + 9 security tests + 41 E2E HTTP checks)
wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/test-backend.sh
```

Then open **http://localhost:8000** · login `Administrator` / `admin123` *(dev only)*

---

## Architecture

```
React Native (Expo 54)  ─┐
                         ├─►  clinic_core API  ─►  Marley ─► ERPNext ─► Frappe ─► MariaDB
Next.js (later)         ─┘    /api/method/clinic_core.api.v1.*
```

Frontends **never** touch MariaDB, and never call Marley's endpoints directly — Marley exposes
160 whitelisted endpoints with almost no permission enforcement
(see [docs/02_API_SECURITY_AUDIT.md](docs/02_API_SECURITY_AUDIT.md)).

### Where things live

| Path | What |
|---|---|
| **WSL** `~/projects/clinic-platform/backend/frappe-bench/` | The live bench (authoritative) |
| `└─ apps/frappe`, `apps/erpnext`, `apps/healthcare` | Upstream — **never edited** |
| `└─ apps/clinic_core` | **All our code** |
| **Windows** `clinic-platform/backend/clinic_core/` | Editable mirror of our Python sources |
| `clinic-platform/docs/` | Documentation |
| `clinic-platform/scripts/` | Operational scripts |
| `clinic-platform/mobile/` | React Native (Expo 54) — placeholder |
| `clinic-platform/web/` | Next.js — placeholder |

> The backend runs in **WSL2 Ubuntu 24.04**, not on Windows and not in Docker.
> Source lives in the Linux filesystem (never `/mnt/c`) for filesystem performance and correct
> permissions. Edit on Windows, then `bash ~/scripts/sync_clinic_core.sh`.

---

## Versions (verified compatible v16 set)

| Component | Version |
|---|---|
| Frappe | 16.33.1 (`version-16`) |
| ERPNext | 16.34.2 (`version-16`) |
| Marley / healthcare | 16.5.2 (`version-16`) |
| clinic_core | 0.0.1 |
| Python | 3.14.6 *(frappe v16 hard-pins `>=3.14,<3.15`)* |
| Node / Yarn | 24.20.0 / 1.22.22 *(must be Yarn 1 classic)* |
| MariaDB / Redis | 10.11.14 / 7.0.15 |

---

## Documentation

| Doc | Contents |
|---|---|
| [00_MACHINE_AUDIT.md](docs/00_MACHINE_AUDIT.md) | Machine state before install, version research, risk register |
| [01_MARLEY_GITHUB_ISSUE_AUDIT.md](docs/01_MARLEY_GITHUB_ISSUE_AUDIT.md) | 69 open upstream issues triaged; 10 local defects found |
| [02_API_SECURITY_AUDIT.md](docs/02_API_SECURITY_AUDIT.md) | **Read this.** 160 endpoints, 0 `only_for`, a reproduced P0 |
| [03_AUTH_ARCHITECTURE.md](docs/03_AUTH_ARCHITECTURE.md) | Token auth for mobile, cookies for web, and why |
| [04_DEVELOPMENT_COMMANDS.md](docs/04_DEVELOPMENT_COMMANDS.md) | Every command you need + troubleshooting |
| [05_GIT_STRATEGY.md](docs/05_GIT_STRATEGY.md) | How to take upstream updates without losing our work |
| [API.md](docs/API.md) | All 32 endpoints: request, response, roles, errors |
| [BUG_FIXES.md](docs/BUG_FIXES.md) | Every defect found and where it was fixed |
| [FINAL_BACKEND_STATUS.md](docs/FINAL_BACKEND_STATUS.md) | Status, test results, credentials, next steps |
| [clinic-api.postman_collection.json](docs/clinic-api.postman_collection.json) | 45 requests with assertions |

---

## ⚠️ Before exposing this to anyone

1. **Upstream P0 unfixed:** Marley's `set_request_status` lets any authenticated user modify any
   record of any doctype ([#1063](https://github.com/earthians/marley/issues/1063)) —
   reproduced by a passing test. `clinic_core` avoids it, but the endpoint is still reachable.
   Add the override hook first (FINAL_BACKEND_STATUS §13).
2. **No TLS.** Development is plain HTTP.
3. **Credentials are weak and public** (`admin123`, `TestPass123!`, `devroot123`).
4. **Only expose `clinic_core.api.v1.*`** — deny `/api/method/healthcare.*` at the proxy.

All test data is synthetic. No real patient information exists in this system.
