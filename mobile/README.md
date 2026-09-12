# Clinic Mobile — React Native (Expo)

A clinic/practice-management app for staff, plus a public appointment-booking
flow that works without an account. It is a client over the existing
Frappe / ERPNext / Marley backend and the custom `clinic_core` app — no business
rules are reimplemented here.

## Requirements

* Node 20+ (developed on 24.18.0)
* The clinic backend running and reachable (see below)
* Expo Go on your phone, **or** an Android emulator

## Install

```bash
cd mobile
npm install
```

## Start

```bash
npm start          # Metro + QR code
npm run android    # open on a connected device / emulator
npm run ios        # macOS only
```

## Backend URL — you usually do not need to configure this

The app reads the host Expo served the bundle from and calls port 8000 on that
same address. Scanning the QR code from a phone therefore targets your machine's
LAN IP automatically, with nothing to edit when the network changes.

Fallbacks when Expo cannot report a LAN host:

| Environment | URL |
|---|---|
| Android emulator | `http://10.0.2.2:8000` (`10.0.2.2` = the host's loopback) |
| iOS simulator | `http://localhost:8000` |

To point at a different backend, copy `.env.example` to `.env` and set:

```
EXPO_PUBLIC_API_URL=http://192.168.0.59:8000
```

### Physical device + backend in WSL

The backend runs inside WSL2, which has its own network namespace, so a phone
cannot reach it directly. Bridge it once (Administrator PowerShell):

```powershell
# forward every Windows interface on :8000 into the WSL distro
netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 `
  connectport=8000 connectaddress=<wsl-ip>

# allow the dev ports through the firewall
New-NetFirewallRule -DisplayName "Clinic Backend 8000 (dev)" -Direction Inbound `
  -LocalPort 8000 -Protocol TCP -Action Allow -Profile Private,Domain
New-NetFirewallRule -DisplayName "Expo Metro 8081 (dev)" -Direction Inbound `
  -LocalPort 8081 -Protocol TCP -Action Allow -Profile Private,Domain
```

Get `<wsl-ip>` with `wsl -d Ubuntu-24.04 -u fawwad -- hostname -I`. It changes
when WSL restarts, so re-run the `portproxy` line if the app stops connecting.

Verify from Windows before blaming the app:

```powershell
Invoke-WebRequest http://<your-lan-ip>:8000/api/method/ping
# expect: {"message":"pong"}
```

### Start the backend

```powershell
wsl -d Ubuntu-24.04 -u fawwad -- bash ~/scripts/start.sh
```

Test credentials are in `../docs/FINAL_BACKEND_STATUS.md` §10. All data is
synthetic.

## Verify

```bash
npm run typecheck    # tsc --noEmit
npm test             # jest
npx expo-doctor      # dependency + config validation
```

## Documentation

| Doc | Contents |
|---|---|
| `docs/IMPLEMENTATION_PLAN.md` | what was inspected, what was decided, why |
| `docs/01_ARCHITECTURE.md` | layering, state, auth, error handling |
| `docs/02_DESIGN_SYSTEM.md` | tokens, type scale, how the reference was translated |
| `docs/03_BACKEND_API_MAPPING.md` | every endpoint the app calls |
| `docs/04_ROLE_PERMISSIONS.md` | the verified role matrix |
| `docs/05_TEST_FLOWS.md` | manual QA scripts per role |
| `docs/06_KNOWN_LIMITATIONS.md` | honest gaps |
| `docs/07_SCREEN_MAP.md` | route graph |
| `docs/08_COMPONENT_LIBRARY.md` | reusable components |
| `docs/BACKEND_CHANGES.md` | the guest booking API added to `clinic_core` |
| `docs/MOCK_DATA_STATUS.md` | confirmation that no screen uses mock data |

## Notes

* **Expo Go must match the project's SDK.** The project targets SDK 57; Expo Go
  supports one SDK at a time.
* Development runs over plain HTTP. That is fine for a local bench with
  synthetic data and **must not** carry real patient data — see
  `docs/06_KNOWN_LIMITATIONS.md`.
