# Known Limitations

Honest list. Nothing here is hidden behind a "coming soon" screen — where a
capability is missing, the app says so in place rather than pretending.

---

## 1. Session auth, not token auth

**What:** `auth.login` returns a Frappe session id (`sid`), which the app stores
in `expo-secure-store` and sends as a cookie.

**Why:** the token-issuing endpoint (`auth.generate_token`) is **not implemented
backend-side**. The design is decided (`docs/03_AUTH_ARCHITECTURE.md`) but the
code was never written.

**Impact:** sessions expire on the server's schedule rather than a token
lifetime the app controls. A 401 is handled cleanly (session cleared once, no
retry loop, redirect to login), so this degrades gracefully.

**Fix:** implement `auth.generate_token`, then change `api/session.ts`'s
`authHeaders()` — a one-function change, deliberately isolated for this reason.

---

## 2. No TLS in development

Traffic runs over plain HTTP to `http://<lan-ip>:8000`. A session cookie on a
cleartext link is a credential on the wire.

**Acceptable** against a local dev bench with entirely synthetic data.
**Mandatory before any real patient data:** TLS. `config/env.ts` already warns
when a production build is pointed at an `http://` URL.

Android requires `usesCleartextTraffic` (set via `expo-build-properties`) for
this to work at all; that flag must be removed when TLS lands.

---

## 3. Doctor availability — resolved (was: read-only)

**Previously:** the Availability screen could show the weekly working pattern but
not edit it, because `clinic_core` exposed no write endpoint (QA baseline BUG-04).

**Now editable.** `practitioners` gained `set_schedule`, `block_time`,
`set_leave`, `clear_unavailability` and `unavailability`, and the screen has edit
affordances for all of them:

* tap a weekday to change its hours (`ScheduleEditorSheet`)
* add leave for whole days, or block part of a day (`TimeOffSheet`)
* remove any leave / blocked entry from the list

All of it is written through **Marley's own doctypes** — Practitioner Schedule,
and Practitioner Availability of type `Unavailable` — so the scheduler, the
overlap checks and both booking flows see a change immediately. No new doctype,
no parallel store, no schema migration.

**Permissions:** `practitioners.availability` returns `can_manage`, decided by
the server (admin and reception manage anyone; a physician only themselves). The
UI gates the edit controls on it, but every write re-checks, so a stale `true`
is refused rather than honoured.

**Remaining constraints — these are Marley's rules, and correct:**

* blocking a window that already holds appointments is refused (**409**), so
  booked patients are never silently orphaned — move them first
* blocking time outside the working pattern is refused (**422**): there is
  nothing there to block
* the pattern is replaced as a whole, not patched; at least one range must
  remain (a doctor with no hours at all is expressed as leave)

Covered by `test_scheduling.py` (22 tests).

---

## 4. Slot lists are advisory, not authoritative

**One derivation, server-side** (this closes QA baseline BUG-05).

`appointments.available_slots` returns Marley's raw **schedule windows**
(09:00–17:00), not bookable times, and its `appointments[]` array is
service-unit scoped — empty for ordinary consultations. It is still exposed for
callers that want that raw payload, but nothing derives availability from it any
more.

Both flows now call the same server function
(`clinic_core.api.v1.slots.compute_slots`):

| Flow  | Endpoint                      |
|-------|-------------------------------|
| Staff | `appointments.bookable_slots` |
| Guest | `public.availability.slots`   |

The client-side derivation (`utils/slots.ts`, `deriveSlots`) has been **deleted**
— it was the second mechanism that let the staff and guest views disagree about
one calendar. `hooks/useStaffSlots` is now a thin fetch of the server's list.
`test_scheduling.py` asserts the two lists are identical, and
`src/api/__tests__/slotParity.test.ts` guards against a client deriving times
again.

**Still advisory, by design:** `create_appointment` re-validates and returns
**409 CONFLICT** if the slot went while the user was choosing. The app handles it
by refreshing the list and asking the user to pick again. Nothing is
optimistically shown as booked — that rejection, not the list, is the source of
truth.

---

## 5. Concurrency not stress-tested

Double-booking rejection is proven **sequentially** (a test books a slot, a
second guest is refused with 409). Marley's overlap check is a read-then-
validate, so a genuine parallel race has not been ruled out — that is an
upstream property, not something the app can fix. Worth a dedicated load test
before production.

---

## 6. Activity screen is derived, not an audit log

There is no audit/event endpoint. The Activity tab composes recent appointments
and encounters into a timeline. It shows what the backend can actually evidence
— no invented "payment received" or "patient checked in" events.

---

## 7. Invoicing is consultation-only

`invoices.create_consultation_invoice` creates a single-line consultation
charge. Multi-line invoices, discounts, taxes and credit notes exist in ERPNext
but have no `clinic_core` endpoint, so the Create Invoice screen offers exactly
what the API supports: patient, practitioner, optional rate.

The screen labels its total "Estimated" — ERPNext computes the authoritative
amount.

---

## 8. Invoice PDF / share not available

No print or PDF endpoint is exposed, and PDF generation was never exercised
backend-side. The invoice screen therefore has no Share or Download action
rather than a button that fails.

---

## 9. Upstream security issue still reachable

`healthcare...set_request_status` lets any authenticated user set `status` on an
arbitrary doctype (no permission check, ORM bypassed). `clinic_core` never calls
it and this app never calls it, but **the upstream endpoint remains callable**.

Mitigation is a backend concern: an `override_whitelisted_methods` hook, plus a
proxy rule denying `/api/method/healthcare.*`. Tracked in
`docs/FINAL_BACKEND_STATUS.md` §5.

---

## 10. Rate limiting is per-process, not distributed

The guest endpoints throttle per IP using Frappe's redis cache. That stops
casual scripted abuse and client retry storms. It is **not** a substitute for an
edge WAF, and it fails open if the cache is unavailable (deliberately — a cache
hiccup must not take patient booking offline).

---

## 11. Notifications, reminders and payments gateways

WhatsApp/SMS/email reminders and JazzCash/Easypaisa/PayFast are architecturally
reserved in `clinic_core` but nothing is built. The booking success screen says
details were sent to the patient's phone **only** because the clinic's existing
process does that — the app itself sends nothing.

> If that copy is not accurate for your deployment, change it in
> `app/(public)/book/success.tsx`. It is the one user-facing claim in the app
> that depends on a process outside it.

---

## 12. Expo SDK version

The brief specified SDK 54, and the app was built and verified on it. It was
then **upgraded to SDK 57 at the user's explicit request**, because the Expo Go
installed on the test device is an SDK 57 build and Expo Go supports only one
SDK at a time.

The upgrade re-pinned every Expo package to the versions in SDK 57's
`bundledNativeModules.json` (not guessed), and the result was re-verified:
expo-doctor 21/21, `tsc --noEmit` clean, 78/78 tests, Android bundle exports.

Three changes were required by the newer SDK, all mechanical:

* `newArchEnabled`, `splash` and `android.edgeToEdgeEnabled` were removed from
  `app.json` (SDK 57 rejects them); the splash config moved into the
  `expo-splash-screen` plugin.
* TypeScript 6 deprecated `baseUrl`, so `paths` are now config-relative.
* `TabBar` takes `BottomTabBarProps` from `expo-router`'s own bottom-tabs types
  rather than the standalone `@react-navigation/bottom-tabs` package — in SDK 57
  the two diverge (`ColorValue` vs `string` in header options).

To go back to SDK 54, revert `package.json` to the SDK 54 version set and undo
those three changes.
