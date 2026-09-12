# Deployment runbook

Deploying `api.health-care.phyntech.com` to Coolify.

The image is built by GitHub Actions and pulled by Coolify — **nothing is built
on the server**. A Frappe image build compiles assets for four apps and would
compete for the ~3.5GB free on a box already running Supabase and Coolify.

---

## 0. Before you start

| Need | Value |
|---|---|
| Domain | `api.health-care.phyntech.com` |
| DNS | `A` record → the server's IP, **created and propagated** |
| Repo | `github.com/Muhammad14251425/health-care-app` (private) |
| Coolify | GitHub App already connected |

DNS must resolve *before* deploying, or Let's Encrypt cannot issue the
certificate and Traefik will serve a self-signed one.

```bash
nslookup api.health-care.phyntech.com
```

---

## 1. Build the image

Push to `main`, or run the workflow manually:

**Actions → build image → Run workflow**

It pushes `ghcr.io/muhammad14251425/health-care-app:latest` plus a SHA tag.
First build takes ~15–25 minutes; later builds are cached.

### Make the package readable by Coolify

GHCR packages default to private. Either:

- **Make it public** — GitHub → Packages → `health-care-app` → Package settings
  → Change visibility. Simplest; the image contains no secrets, only code that
  is already in a private repo you control.
- **Or keep it private** and add registry credentials in Coolify (a PAT with
  `read:packages`).

---

## 2. Create the application in Coolify

1. **+ New** → **Docker Compose**
2. Source: the GitHub App → `health-care-app`, branch `main`
3. **Compose file path**: `deploy/docker-compose.yml`
4. **Domain**: `https://api.health-care.phyntech.com` — note **https**

### Environment variables

| Name | Value |
|---|---|
| `IMAGE_NAME` | `ghcr.io/muhammad14251425/health-care-app:latest` |
| `SITE_NAME` | `api.health-care.phyntech.com` |
| `DB_ROOT_PASSWORD` | generate: `openssl rand -base64 32` |

**Store `DB_ROOT_PASSWORD` somewhere durable** — step 3 needs it, and so does
every future backup restore.

Deploy. Wait for `db` to report healthy before continuing.

---

## 3. Create the site

Once only. Run from the server:

```bash
ssh clinic
docker ps --format '{{.Names}}' | grep backend    # find the container name
docker exec -it <backend-container> bash
```

Inside:

```bash
cd /home/frappe/frappe-bench

bench new-site api.health-care.phyntech.com \
  --db-root-password '<DB_ROOT_PASSWORD>' \
  --admin-password '<choose-a-strong-one>' \
  --install-app erpnext \
  --install-app healthcare \
  --install-app clinic_core

bench use api.health-care.phyntech.com
```

Order matters: `erpnext` and `healthcare` are `required_apps` for `clinic_core`
and must exist first.

> **Destructive-command warning.** `bench new-site` on a name that already exists
> will offer to drop the existing database. On a live site that destroys every
> patient record. Read the prompt before answering.

---

## 4. Configure the site

Still inside the container:

```bash
cd /home/frappe/frappe-bench

# PDFs fail with HostNotFoundError without this — the renderer resolves asset
# URLs against host_name.
bench --site api.health-care.phyntech.com set-config host_name https://api.health-care.phyntech.com

# MUST be 0 in production. At 1, the console OTP provider is permitted, which
# writes login codes to the log.
bench --site api.health-care.phyntech.com set-config -p developer_mode 0

# WhatsApp OTP (values from the project .env)
bench --site api.health-care.phyntech.com set-config clinic_otp_provider whatsapp
bench --site api.health-care.phyntech.com set-config clinic_evolution_url '<EVOLUTION_API_URL>'
bench --site api.health-care.phyntech.com set-config clinic_evolution_api_key '<EVOLUTION_API_KEY>'
bench --site api.health-care.phyntech.com set-config clinic_evolution_instance '<EVOLUTION_INSTANCE>'

bench --site api.health-care.phyntech.com clear-cache
```

Then restart the app in Coolify so every worker picks up the new config.

---

## 5. Seed clinic masters

ERPNext ships without the departments, practitioners and service units this
clinic needs:

```bash
bench --site api.health-care.phyntech.com execute clinic_core.setup_masters.run
```

Check the function name first — `setup_masters.py` may expose a different entry
point.

---

## 6. Verify

```bash
# Certificate and redirect
curl -sI http://api.health-care.phyntech.com | head -3     # expect 301 → https
curl -sI https://api.health-care.phyntech.com | head -3    # expect 200

# The API answers. list_departments is guest-accessible (it backs the public
# booking flow), so it needs no login and makes a good health check.
curl -s https://api.health-care.phyntech.com/api/method/clinic_core.api.v1.public.departments.list_departments
```

Check every endpoint is importable and correctly whitelisted — catches a typo
that would otherwise leave a route silently unreachable:

```bash
docker exec -it <backend-container> \
  bench --site api.health-care.phyntech.com execute clinic_core.api.selftest.run
```

Then point the mobile app at it:

```
# mobile/.env
EXPO_PUBLIC_API_URL=https://api.health-care.phyntech.com
```

---

## 7. Backups — do this before real patient data

Not optional for a system holding medical records.

In Coolify: **Databases → the `db` service → Backups** — schedule daily, and set
a retention period. Then **test a restore**; an untested backup is a guess.

---

## Operations

**Logs**
```bash
docker logs -f <backend-container>
docker exec <backend-container> tail -f /home/frappe/frappe-bench/logs/worker.error.log
```

**Memory** — the stack is capped at ~3.0GB; watch for anything sitting at its
limit:
```bash
docker stats --no-stream
```

**Update** — push to `main`, wait for the build, then redeploy in Coolify.
Schema changes need a migrate:
```bash
docker exec -it <backend-container> bench --site api.health-care.phyntech.com migrate
```

**Rollback** — set `IMAGE_NAME` to a previous SHA tag and redeploy.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Site does not exist` | Step 3 not run, or `SITE_NAME` ≠ the site's actual name |
| 502 from Traefik | `backend` still starting, or OOM-killed — check `docker stats` |
| Self-signed certificate | DNS did not resolve when Traefik asked Let's Encrypt |
| PDFs fail | `host_name` unset (step 4) |
| OTP never arrives | Evolution instance not connected, or `developer_mode 0` with provider `console` |
| Worker killed | Raise that service's limit; swap is the backstop, not the fix |
