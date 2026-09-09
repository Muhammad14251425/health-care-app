# 05 — Git Strategy

**Goal:** keep receiving upstream updates from Frappe, ERPNext and Marley **without** losing our
work or fighting merge conflicts.

---

## The rule

```
          UPSTREAM (never edited)                     OURS
  ┌───────────────────────────────┐        ┌────────────────────────┐
  │  apps/frappe      version-16  │        │                        │
  │  apps/erpnext     version-16  │  ◄───  │   apps/clinic_core     │
  │  apps/healthcare  version-16  │  hooks │   ~all custom logic    │
  └───────────────────────────────┘        └────────────────────────┘
```

**Everything we write goes in `clinic_core`.** Upstream apps stay byte-identical so
`git pull` is always a fast-forward.

### Current state — verified
```
apps/frappe      version-16  988e54f  v16.33.1   pristine
apps/erpnext     version-16  4048fb7  v16.34.2   pristine
apps/healthcare  version-16  934d6c1  v16.5.2    pristine  ← git status: clean
apps/clinic_core mit         8e30643             our work
```

Every problem hit during the build was solved **without editing upstream** — via `clinic_core`,
an official ERPNext patch, or seed/master data. See `docs/BUG_FIXES.md`.

---

## What belongs where

### ✅ `clinic_core` — put these here
- All API endpoints (`clinic_core/api/v1/…`)
- Permission hardening, role checks, ownership guards
- Custom DocTypes and custom fields (via fixtures)
- Document event hooks (`doc_events` in `hooks.py`)
- Method overrides (`override_whitelisted_methods`, `override_doctype_class`)
- Scheduled jobs
- **WhatsApp, SMS, email reminders**
- **JazzCash, Easypaisa, PayFast/Safepay**
- Pakistan-specific logic (CNIC validation, PKR formatting, local holidays)
- Anything frontend-specific

### ❌ Never in `apps/frappe`, `apps/erpnext`, `apps/healthcare`
The only justification is a genuine upstream bug that **cannot** be worked around by a hook —
and then only via the documented process in `docs/BUG_FIXES.md`.

---

## Extension mechanisms (use these instead of editing)

| Need | Mechanism |
|---|---|
| Change what a whitelisted endpoint does | `override_whitelisted_methods` in `hooks.py` |
| Change DocType behaviour | `override_doctype_class` |
| React to save/submit/cancel | `doc_events` |
| Add fields to a Marley doctype | Custom Field, exported as a fixture |
| Change permissions | Custom DocPerm / `permission_query_conditions` / `has_permission` hooks |
| Add an API | A new module under `clinic_core/api/v1/` |

**Worked example — the `set_request_status` P0 (§13 of the final report):** rather than editing
`healthcare/controllers/service_request_controller.py`, register
`override_whitelisted_methods` pointing at a guarded wrapper in `clinic_core`. Upstream stays
clean, and when Marley ships a fix we simply delete our override.

---

## Remotes

```bash
cd apps/healthcare
git remote -v
# upstream  https://github.com/earthians/marley (fetch/push)
```

A `clinic-dev` branch already exists on `healthcare`, created from the pristine v16.5.2
baseline. It is **currently unused** — it exists so that *if* an unavoidable upstream fix is
ever needed, there is a clean place for it that never diverges silently from `version-16`.

---

## Updating upstream safely

```bash
cd ~/projects/clinic-platform/backend/frappe-bench/apps/healthcare

# 1. prove we have not modified upstream
git status --porcelain --untracked-files=no      # MUST be empty

# 2. inspect what is coming
git fetch upstream
git log --oneline HEAD..upstream/version-16

# 3. back up first
bash ~/scripts/backup.sh

# 4. update
git pull upstream version-16

# 5. rebuild, migrate, and PROVE nothing broke
cd ../..
bench setup requirements
bench --site clinic.localhost migrate
bash ~/scripts/test-backend.sh
```

Step 5 matters: the security suite re-checks issue **#1063** on every run, so an upstream fix
(or regression) shows up immediately as a changed test result.

> ⚠️ Untracked build artifacts (`node_modules/`, `public/frontend/`, `yarn.lock`) appear in
> `git status` after a build. They are **not** source modifications — always check with
> `--untracked-files=no`.

### Staying on the v16 line
Never mix branches. All four apps must remain on their `version-16` line; ERPNext requires
`frappe>=16.21.0` and Marley requires both at `^16`. Moving one app to `develop` breaks the set.

---

## Commit conventions

- One logical change per commit; small and reviewable.
- Conventional prefixes: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Bug fixes touching upstream get their **own** commit plus a `docs/BUG_FIXES.md` entry.
- Never bundle a security fix with unrelated refactoring.

---

## Repository layout note

`clinic_core` currently lives at `apps/clinic_core` inside the bench, with a mirror of its
Python sources on the Windows side for editing
(`clinic-platform/backend/clinic_core/`), synced by `scripts/sync_clinic_core.sh`.
**The bench copy is authoritative for running.** Before shipping, `clinic_core` should be
pushed to its own remote git repository so it is backed up independently of this machine.
