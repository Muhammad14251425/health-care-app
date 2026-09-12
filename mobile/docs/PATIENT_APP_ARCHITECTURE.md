# Patient Mobile App — Architecture

Status: implemented and verified against the live backend on 2026-09-11.
Stack: React Native 0.86 / Expo 57 / Expo Router / TanStack Query / Zustand-free
(auth is a React context) — the same stack, theme and component library as the
staff app.

---

## 1. Where the patient app sits

The mobile bundle now serves **four** roles across **two** navigators, plus the
unchanged guest flow:

```
                       app/index.tsx  (entry gate)
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
   no session            kind=patient           kind=staff
        │                     │                      │
  (public)/welcome     (patient)/(tabs)         (app)/(tabs)
   ├ Patient login      ├ Home                   ├ Home
   ├ Book as guest      ├ Appointments           ├ Appointments
   └ Staff sign in      ├ Records                ├ Patients
                        ├ Billing                ├ Billing / Activity
                        └ Me                     └ Me
```

Routing by role is a **usability** decision, never a security control. The
backend refuses staff endpoints to a patient session and vice versa regardless
of which navigator is on screen — proven in PATIENT_SECURITY_TESTS.md.

## 2. Route tree (new files only)

```
app/
  (patient-auth)/
    _layout.tsx          stack, no header
    phone.tsx            enter mobile number
    otp.tsx              6-digit code + resend countdown
    register.tsx         first login for an unknown number (Case B)

  (patient)/
    _layout.tsx          guards: no session → welcome; staff → staff app;
                         unregistered → register
    (tabs)/
      _layout.tsx        five fixed tabs, PatientTabBar
      index.tsx          Home
      appointments.tsx   Upcoming / Past / Cancelled
      records.tsx        Visits / Prescriptions / Lab results
      billing.tsx        Outstanding hero + invoice list
      profile.tsx        identity, contact, account, logout
    appointment/
      new.tsx            authenticated booking
      [id]/index.tsx     detail, cancel, reschedule entry
      [id]/reschedule.tsx
    record/
      visit/[id].tsx       patient-safe visit record
      diagnostic/[id].tsx  lab result
    invoice/
      [id].tsx           invoice detail + share PDF
    profile/
      edit.tsx           email + secondary phone
      phone.tsx          OTP-verified login-number change
```

Staff routes under `app/(app)/` and the guest flow under `app/(public)/book/`
are untouched.

## 3. Session handling

`src/api/session.ts` stores three values in **expo-secure-store** (Keychain /
Android Keystore), never AsyncStorage:

| key | purpose |
|---|---|
| `clinic.session.sid` | the Frappe session id, sent as a `Cookie` header |
| `clinic.session.user` | the User the session belongs to |
| `clinic.session.kind` | `"staff"` or `"patient"` — lets a cold start route before the network answers |

`kind` is a routing hint only. Tampering with it grants nothing: the server
decides what the session may read.

Cold start (`src/stores/auth.tsx`):

```
load credential → probe the server (patient_auth.session_valid / auth.me)
   ├ valid   → set user + kind → route by persona
   └ invalid → clear everything → welcome
```

A stored credential is never trusted on its own; it is always re-confirmed.

## 4. Cache isolation — a security requirement, not hygiene

`queryClient.clear()` runs on **every** sign-out and on **every** sign-in, in
`clearLocalSession` / `signIn` / `signInWithPatientSession`.

With two patients sharing one handset, a surviving TanStack Query cache would
show Patient B the rows fetched for Patient A — a medical-records leak. The
patient query keys are all namespaced under `['patient', …]` so a targeted
eviction is possible, but sign-out deliberately uses the blunt `clear()`,
because a *different* person may be next.

Verified end-to-end: TEST 14/15 in PATIENT_SECURITY_TESTS.md.

## 5. Data layer

* `src/api/patientAuth.ts` — request/verify OTP, register, logout, phone change
* `src/api/patient.ts` — every self-scoped read and write
* `src/types/patient.ts` — response types mirroring what the server really returns

**No function in either module accepts a patient identifier**, because no
endpoint does. This is enforced by a test
(`src/api/__tests__/patientApiShape.test.ts`) that walks every outgoing request
payload and fails if `patient`, `patient_id`, `patientId` or `patient_name`
appears anywhere in it.

## 6. Design

The patient app reuses the staff app's design system verbatim — there is no
separate "patient portal" theme:

* Poppins throughout (`src/theme/typography.ts`)
* warm off-white ground `#F3F2ED`, white cards, `#EBE9E2` hairlines
* dark-green hero card with the gold branch arc (`HeroCard`)
* peach / mint / pale-yellow quick tiles (`StatCard`)
* floating rounded bottom nav, inset from the edges (`PatientTabBar`)

`PatientTabBar` is a separate component from the staff `TabBar` only because the
staff bar branches on staff permissions (`canViewBilling`, `canViewPatients`)
which have no meaning for a patient. Visually they are the same bar.

## 7. Notifications (structure only)

No push service is wired. The shape is ready for one: every mutation
invalidates `['patient']`, so a push-triggered refetch is a one-line addition,
and the events worth sending (appointment confirmed / reminder / rescheduled /
cancelled, new invoice, new result) all correspond to existing query keys.

## 8. Known limits

* Lab/diagnostics are an **optional module**. `patient_records.diagnostics`
  reports `enabled: false` when the clinic has no Lab Test doctype data, and the
  Records tab hides the section rather than showing an error.
* Payment is view-only. A patient can see what they owe and share the invoice
  PDF; they cannot pay in-app (no gateway integration) and cannot alter the
  ledger.
* Emergency contact is read-only, and only appears when the install records
  those fields on `Patient`.
