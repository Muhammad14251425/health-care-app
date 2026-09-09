# 04 — Development Commands

Everything runs **inside WSL Ubuntu-24.04**, never on Windows directly.

## The two commands you actually need

```powershell
# START the backend
wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/start.sh

# RUN ALL TESTS
wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/test-backend.sh
```

Then open **http://localhost:8000**

---

## Quick reference

| I want to… | Command (from PowerShell) |
|---|---|
| **Start** backend | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/start.sh` |
| **Stop** backend | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/stop.sh` |
| **Stop everything** (incl. DB) | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/stop.sh --all` |
| **Restart** backend | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/_restart_serve.sh` |
| **Run all tests** | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/test-backend.sh` |
| **Backup** | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/backup.sh` |
| **Restore** | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/restore.sh <file.sql.gz>` |
| **Sync my clinic_core edits** | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/sync_clinic_core.sh` |
| **View live logs** | `wsl -d Ubuntu-24.04 -u fawwad -- tail -f /tmp/bench_serve.log` |
| **See recent API errors** | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/_read_errors.sh` |
| **Re-seed test data** | `wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/_run_seed.sh` |
| **Open a Linux shell** | `wsl -d Ubuntu-24.04 -u fawwad` |

> **Why the `wsl … -- bash ~/scripts/…` shape?** Passing inline shell with `$HOME`, quotes or
> `&&` from PowerShell into WSL mangles the quoting. Script files avoid the problem entirely.
> Once inside a WSL shell (`wsl -d Ubuntu-24.04 -u fawwad`) you can just run `bash ~/scripts/start.sh`.

---

## Inside WSL (after `wsl -d Ubuntu-24.04 -u fawwad`)

All bench commands must run from:
```bash
cd ~/projects/clinic-platform/backend/frappe-bench
```

| Task | Command |
|---|---|
| Run migrations | `bench --site clinic.localhost migrate` |
| Build assets | `bench build` |
| Build one app | `bench build --app clinic_core` |
| Clear cache | `bench --site clinic.localhost clear-cache && bench --site clinic.localhost clear-website-cache` |
| Python console | `bench --site clinic.localhost console` |
| MariaDB shell | `bench --site clinic.localhost mariadb` |
| Run a function | `bench --site clinic.localhost execute clinic_core.seed.run` |
| Install masters | `bench --site clinic.localhost execute clinic_core.setup_masters.run` |
| List installed apps | `bench --site clinic.localhost list-apps` |
| Show config | `bench --site clinic.localhost show-config` |
| Set a config value | `bench --site clinic.localhost set-config <key> <value>` |
| Run one test module | `bench --site clinic.localhost run-tests --app clinic_core --module clinic_core.tests.test_security_marley` |

> ⚠️ **`bench console` is an IPython REPL.** Piping a `.py` file into it silently breaks
> function definitions (a blank line inside a function ends the block). **Always use
> `bench execute module.function` to run scripted logic.** This cost real debugging time.

---

## Updating

### Update our app (`clinic_core`)
```bash
cd ~/projects/clinic-platform/backend/frappe-bench/apps/clinic_core
git status                      # review first
git add -A && git commit -m "..."
cd ../..
bench --site clinic.localhost migrate
bench --site clinic.localhost clear-cache
bash ~/scripts/_restart_serve.sh
bash ~/scripts/test-backend.sh  # prove nothing broke
```

### Update Marley safely
```bash
cd ~/projects/clinic-platform/backend/frappe-bench/apps/healthcare

# 1. confirm we have not modified upstream source
git status --porcelain --untracked-files=no    # MUST be empty

# 2. see what is coming
git fetch upstream
git log --oneline HEAD..upstream/version-16

# 3. back up BEFORE updating
bash ~/scripts/backup.sh

# 4. update
git pull upstream version-16

# 5. reinstall deps, migrate, retest
cd ../..
bench setup requirements
bench --site clinic.localhost migrate
bash ~/scripts/test-backend.sh   # the security tests re-check issue #1063
```
If `git status` is **not** empty, stop: someone has edited upstream source. See
`docs/BUG_FIXES.md` for the required process.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| `Connection refused ... :11000` on any bench command | bench's own redis is down. `bash ~/scripts/_start_redis.sh`. Needed for `migrate`/`run-tests`, not just `bench start`. |
| `ModuleNotFoundError: No module named 'clinic_core'` | Server started before the app was installed. `bash ~/scripts/_restart_serve.sh`. |
| `Testing is disabled for the site` | `bench --site clinic.localhost set-config allow_tests true` |
| API returns `INTERNAL_ERROR` | By design — the real traceback is server-side. `bash ~/scripts/_read_errors.sh`. |
| `clinic.localhost` won't resolve in Windows | Expected. Use `http://localhost:8000`. To fix, add `127.0.0.1 clinic.localhost` to `C:\Windows\System32\drivers\etc\hosts` **as Administrator**. |
| Port 8000 already in use | `bash ~/scripts/stop.sh`, or `PORT=8001 bash ~/scripts/start.sh` |
| Disk filling up | Host had only ~32 GB free. `df -h /` inside WSL; prune `sites/clinic.localhost/private/backups/`. |
| Everything is broken | `bash ~/scripts/restore.sh <latest-backup.sql.gz>` |
