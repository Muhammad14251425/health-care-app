# 00 — Machine Audit

**Date:** 2026-09-09
**Auditor:** backend engineering session
**Purpose:** Establish the true state of the host machine *before* installing anything, so that no
existing program, database, container or user data is disturbed, and so that version choices are
driven by evidence rather than assumption.

---

## 1. Host machine (Windows)

| Property | Value |
|---|---|
| OS | Microsoft Windows 11 Home |
| Version / Build | 10.0.26200 (build 26200) |
| Architecture | 64-bit |
| Model | HP Pavilion x360 Convertible 14m-dw1xxx |
| Logical processors | 8 |
| Physical RAM | 21,096,763,392 bytes (~19.6 GiB) |
| Free RAM at audit | ~8.2 GiB |
| Disk C: used / free | 443.2 GB used / **32.5 GB free** |

### ⚠️ Risk: disk space
Only **32.5 GB free** on `C:`. A full Frappe v16 bench (frappe + erpnext + healthcare source,
python venv, `node_modules`, built assets, MariaDB data) typically consumes **8–15 GB**. The install
fits, but headroom is limited. The WSL ext4 virtual disk reports ~955 GB "available" internally —
**this figure is misleading**; the VHDX grows dynamically and is ultimately bounded by the 32.5 GB
of real free space on `C:`.

**Mitigation:** monitor with `wsl -d Ubuntu-24.04 -- df -h /`, and periodically
`bench --site clinic.localhost clear-cache`. Avoid keeping many database backups locally.

---

## 2. Pre-existing tooling on the Windows host

Detected by direct interrogation (`Get-Command` + `--version`), not assumed:

| Tool | Present | Version | Notes |
|---|---|---|---|
| Git | ✅ | 2.46.0.windows.1 | Host-side only; WSL has its own git |
| Docker Desktop | ✅ (installed) | 27.1.1, Compose v2.29.1 | **Daemon STOPPED** — see below |
| Python | ✅ | 3.12.6 | Host-side; irrelevant to the Linux bench |
| Node.js | ✅ | v24.18.0 | Host-side; bench uses its own nvm-managed Node |
| npm | ✅ | 11.16.0 | Host-side |
| pnpm | ✅ | 9.15.4 | Host-side |
| yarn | ❌ | — | Not needed on host |
| MariaDB / MySQL | ❌ | — | Not on host — **no conflict** |
| Redis | ❌ | — | Not on host — **no conflict** |
| bench CLI | ❌ | — | Correctly absent from host (Windows unsupported) |

### Docker Desktop — deliberately left untouched
`docker info` fails with `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file
specified`, i.e. the Docker daemon is **not running**. The `docker-desktop` WSL distribution exists
in `Stopped` state.

**Decision: do not start, modify, or remove Docker.** This project uses a *native WSL2 bench* install
(required for source-level debugging of Marley), not containers. Docker is left exactly as found.
Container/volume inventory could not be enumerated because the daemon is down — and it was not
started, because starting it is a system-state change that the audit rules forbid without cause.

---

## 3. WSL status

| Property | Value |
|---|---|
| WSL version | 2.7.13.0 |
| Kernel | 6.18.33.2-microsoft-standard-WSL2 |
| WSLg | 1.0.73.2 |
| Default version | 2 |

### Distributions **before** this work
```
NAME              STATE      VERSION
docker-desktop    Stopped    2         <- Docker Desktop's internal utility VM (NOT ours)
```

**Finding: there was no Linux distribution suitable for development.** `docker-desktop` is an
internal appliance owned by Docker Desktop and must never be used as a dev environment.

### Distributions **after** this work
```
NAME              STATE      VERSION
docker-desktop    Stopped    2         <- untouched
Ubuntu-24.04      Running    2         <- ADDED by us
```

`Get-WindowsOptionalFeature` required elevation and could not be queried, but this is immaterial:
WSL2 demonstrably works (it is already hosting `docker-desktop` and now Ubuntu), which proves the
`VirtualMachinePlatform` and `Microsoft-Windows-Subsystem-Linux` features are enabled.
`Win32_Processor.VirtualizationFirmwareEnabled` reported `False`; this is a known WMI
misreport on this HP model and is contradicted by the fact that WSL2 VMs boot successfully.

---

## 4. Port usage (host, before install)

Listening ports observed. Relevant finding: **Microsoft SQL Server is running** (`sqlservr` on
`1433`, `4663`, `58191`; `sqlbrowser` on `2382`; `msmdsrv` on `4662`).

| Port | Owner | Conflict with Frappe? |
|---|---|---|
| 1433, 4663, 58191 | `sqlservr` (MS SQL Server) | ❌ No — different engine/port from MariaDB |
| 2382 | `sqlbrowser` | ❌ No |
| 4662 | `msmdsrv` (Analysis Services) | ❌ No |
| 135, 139, 445 | Windows RPC/SMB | ❌ No |
| 2291 | `EpsonPH` (printer) | ❌ No |
| 1257, 5993, 7041, 30484, 55186 | VS Code | ❌ No |

**Ports required by Frappe are all FREE:** `8000` (web), `9000` (socketio), `3306` (MariaDB),
`6379` (Redis), `11000`/`12000`/`13000` (bench redis cache/queue/socketio).

> Note: MariaDB and Redis are installed **inside WSL** bound to `127.0.0.1` within the WSL network
> namespace, so they do not contend with the host's MS SQL Server at all.

---

## 5. Missing requirements identified

Everything below was absent and had to be installed inside Ubuntu:

- A development Linux distribution (Ubuntu 24.04 LTS)
- Python 3.14 (Ubuntu 24.04 ships only 3.12.3 — **insufficient**, see §6)
- Node.js 24
- Yarn
- MariaDB 10.11 (+ Frappe's utf8mb4 / barracuda configuration)
- Redis
- wkhtmltopdf (patched Qt)
- bench CLI
- Build toolchain and native headers (`build-essential`, `libmysqlclient-dev`, `libssl-dev`,
  `libffi-dev`, imaging/pango/cairo libs for Pillow + WeasyPrint, etc.)

---

## 6. Version compatibility research (evidence-based)

Versions were **not** guessed. Each was read from the upstream manifest of the exact branch to be
installed.

### Branch existence — confirmed via GitHub API
| Repo | Branch | Latest tag | Head commit date |
|---|---|---|---|
| `frappe/frappe` | `version-16` | v16.33.1 | 2026-09-08 |
| `frappe/erpnext` | `version-16` | v16.34.2 | 2026-09-08 |
| `earthians/marley` | `version-16` | v16.5.2 | 2026-08-13 |

All three `version-16` branches exist and are actively maintained. Marley additionally maintains
`version-16-hotfix` backport branches, confirming v16 is a supported line (not abandoned).

### Constraints read from upstream manifests

**`frappe/frappe@version-16` → `pyproject.toml`**
```toml
requires-python = ">=3.14,<3.15"
```
**This is the single most consequential finding of the audit.** It is a *hard upper and lower bound*,
not a minimum. Ubuntu 24.04's default Python 3.12.3 **cannot** run Frappe v16.

**`frappe/frappe@version-16` → `package.json`**
```json
"engines": { "node": ">=24" }
```

**`frappe/erpnext@version-16` → `pyproject.toml`**
```toml
requires-python = ">=3.14"
dependencies = [ "frappe>=16.21.0,<17.0.0", ... ]
```
ERPNext v16 requires **frappe >= 16.21.0**; the current `version-16` head (16.33.1) satisfies this.

**`earthians/marley@version-16` → `pyproject.toml`**
```toml
requires-python = ">=3.10"
dependencies = [
  "frappe>=16.0.0,<17.0.0",
  "erpnext>=16.0.0,<17.0.0",
  "responses==0.23.1",
  "python-barcode~=0.15.1",
]
```
Marley pins itself to the **v16 line of both** frappe and erpnext. Its Python floor (3.10) is
looser than Frappe's, so **Frappe's `>=3.14,<3.15` governs**.

**`earthians/marley@version-16` → `hooks.py`**
```python
app_name  = "healthcare"
app_title = "Marley Health"
required_apps = ["frappe/erpnext"]
```
Confirms the Python package name is `healthcare` (as expected) and that ERPNext is a hard
prerequisite.

### ✅ Resolved compatible version set
```
Python      3.14.6        (satisfies >=3.14,<3.15)
Node        24.20.0       (satisfies >=24)
frappe      version-16    (v16.33.1)
erpnext     version-16    (v16.34.2, needs frappe>=16.21.0 ✓)
healthcare  version-16    (v16.5.2, needs frappe & erpnext ^16 ✓)
```
No mixing of `develop` with `version-16`. All three apps sit on the same major line.

---

## 7. Installation method chosen

```
Windows 11
  └── WSL2  (already enabled, v2.7.13)
        └── Ubuntu 24.04.4 LTS   [NEW]
              └── native frappe-bench (source install, NOT Docker)
                    └── MariaDB 10.11 + Redis 7.0 as systemd services
```

**Rationale**
- **Not native Windows:** Frappe is unsupported on Windows (relies on POSIX process
  management, `honcho`, unix sockets, `supervisor`).
- **Not Docker:** the brief requires editable local source for debugging Marley, adding tests and
  patching bugs. A native bench gives direct, editable `apps/` checkouts. It also avoids touching
  the user's existing (stopped) Docker installation.
- **Source lives in the Linux filesystem** at `/home/fawwad/projects/clinic-platform/`, **not**
  `/mnt/c/...`, because the 9p/drvfs bridge is ~10–40× slower for the many-small-file I/O that
  `node_modules`, git and Python imports generate, and it cannot represent Linux permissions
  correctly (breaks venv executables and `bench` file ownership).

### Configuration applied to Ubuntu
- `/etc/wsl.conf`: default user `fawwad`, `systemd=true`, `appendWindowsPath=false`
  (the last prevents Windows `python.exe`/`node.exe` leaking into the Linux `PATH` and confusing bench).
- Dev user `fawwad` with passwordless sudo (**development machine only**).
- `/etc/mysql/mariadb.conf.d/99-frappe.cnf`: utf8mb4 charset, `utf8mb4_unicode_ci` collation,
  barracuda/file-per-table, `bind-address = 127.0.0.1`.

---

## 8. Risks & conflicts register

| # | Risk | Severity | Assessment / mitigation |
|---|---|---|---|
| R1 | **Only 32.5 GB free on C:** | 🔴 High | Install fits but headroom thin. Monitor `df -h`. Prune backups & build caches. Consider moving the WSL VHDX to another drive if space runs out. |
| R2 | Frappe v16 hard-pins Python `>=3.14,<3.15` | 🟠 Medium | **Resolved** — Python 3.14.6 installed from deadsnakes PPA. Ubuntu's 3.12 left as the system default so apt/system tooling is unaffected. |
| R3 | `api.launchpad.net` unreachable on this network | 🟠 Medium | **Resolved** — `add-apt-repository` timed out (it needs the API only for key lookup). Worked around by fetching the deadsnakes signing key from `keyserver.ubuntu.com` and writing the sources entry manually against `ppa.launchpadcontent.net` (which *is* reachable, HTTP 200). |
| R4 | Docker Desktop present but stopped | 🟢 Low | **Left untouched by design.** Native bench chosen, so no interaction. If Docker is started later it will not contend — its ports/daemon are separate. |
| R5 | MS SQL Server occupies 1433 | 🟢 Low | No conflict. MariaDB uses 3306 inside the WSL namespace. Untouched. |
| R6 | Passwordless sudo for `fawwad` | 🟠 Medium | Acceptable for an isolated dev VM; **must not** be replicated in production. |
| R7 | Dev DB credentials are weak/known | 🟠 Medium | Intentional — development only. Documented as test credentials; must never reach production. |
| R8 | Host has Node 24.18 / Python 3.12 | 🟢 Low | Irrelevant — `appendWindowsPath=false` isolates the Linux toolchain. |
| R9 | WSL reports 955 GB free (misleading) | 🟢 Low | Documented in §1; real bound is the host's 32.5 GB. |

---

## 9. Verified end state of prerequisites

Each verified by executing the tool, not by assuming installation succeeded:

| Component | Version | Required | Verdict |
|---|---|---|---|
| Ubuntu | 24.04.4 LTS (Noble) | supported LTS | ✅ |
| Python | 3.14.6 | `>=3.14,<3.15` | ✅ |
| Node.js | v24.20.0 | `>=24` | ✅ |
| npm | 11.19.0 | — | ✅ |
| Yarn | 4.18.0 | — | ✅ |
| MariaDB | 10.11.14 | 10.6+ | ✅ |
| — charset | `utf8mb4` | `utf8mb4` | ✅ |
| — collation | `utf8mb4_unicode_ci` | `utf8mb4_unicode_ci` | ✅ |
| Redis | 7.0.15 (PONG) | 6+ | ✅ |
| wkhtmltopdf | 0.12.6.1 (patched qt) | patched Qt build | ✅ |
| bench CLI | 5.31.0 | — | ✅ |
| systemd in WSL | PID 1, `running` | needed for services | ✅ |

Databases present after install: `information_schema`, `mysql`, `performance_schema`, `sys` —
i.e. **stock only, no pre-existing user data was touched or destroyed.**
