# Architecture

## Layering

```
app/                     Expo Router routes. Screens only: layout, state wiring,
                         user interaction. No fetch calls, no business rules.
   ↓
src/hooks/               Composed data + derived view state (useDashboard,
                         useStaffSlots, useDebouncedValue).
   ↓
src/api/                 One module per backend domain. The ONLY place that
                         talks HTTP.
   ↓
src/api/client.ts        Single fetch entry point: dotted path building,
                         envelope unwrapping, error normalisation, auth header,
                         401 notification.
```

Screens never call `fetch`. A screen that needs data calls a typed function in
`src/api/`, usually through React Query.

## Directory map

| Path | Contents |
|---|---|
| `app/(public)/` | Welcome, login, and the 7-step guest booking flow |
| `app/(app)/` | Everything behind authentication |
| `app/(app)/(tabs)/` | The five tab screens |
| `src/api/` | Backend modules + client, errors, session, query config |
| `src/components/ui/` | Design-system primitives (Text, Card, Button, …) |
| `src/components/clinic/` | Domain cards (AppointmentCard, PatientCard, InvoiceCard) |
| `src/components/booking/` | Public booking pieces (DateStrip, DoctorCard, progress) |
| `src/components/form/` | FormInput, PickerField |
| `src/components/navigation/` | The custom floating TabBar |
| `src/hooks/` | Data composition |
| `src/stores/` | Auth provider (context) + booking wizard (Zustand) |
| `src/theme/` | colors, spacing, radius, typography, shadows |
| `src/types/` | Wire and domain types |
| `src/utils/` | date, currency, slots, permissions |
| `src/validation/` | Zod schemas |
| `src/config/` | Environment resolution |

## State

**Server state → React Query.** Nothing fetched is copied into a store.

**Client state → two small stores:**
* `stores/auth.tsx` — React context: current user, permissions, sign in/out.
* `stores/booking.ts` — Zustand: the guest wizard's in-progress choices. It
  deliberately holds **no availability data**; slots stay in React Query so they
  are refetched rather than remembered, since a cached slot list is exactly what
  must not go stale mid-flow.

### Query policy

`src/api/queryClient.ts`:

* **Never retry** `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`,
  `CONFLICT`, `RATE_LIMITED`. Retrying a 401 is how crash loops start; retrying a
  403 just repeats a refusal.
* **Never retry mutations at all.** Re-sending "record payment" after an
  ambiguous failure risks a duplicate financial record.
* `staleTime` 30s; slot queries override to 0.

## Authentication

```
launch → read credential from SecureStore
       → auth.me() to confirm it is still valid
       ├─ ok      → (app)
       └─ not ok  → clear, → (public)/welcome
```

The credential lives in `expo-secure-store` (Keychain / Android Keystore), never
AsyncStorage. `api/session.ts::authHeaders()` is the single place that decides
how it is attached, so moving from the current session cookie to
`Authorization: token …` is a one-function change once the backend supports it.

A 401 from any request calls `handleUnauthenticated` **once** (guarded by a ref),
which clears state and lets the router redirect. There is no retry.

## Error handling

`ApiError` carries a stable `code`, so screens branch on meaning rather than
string matching. `messageFor()` picks user-facing copy, and a server message is
only shown after passing a filter that rejects HTML, tracebacks, SQL and
framework internals — a Frappe traceback can never reach the UI.

## Why no optimistic updates

Bookings, cancellations, invoices and payments all wait for backend confirmation.
Showing an appointment as booked before the server agrees is a lie about a
medical record, and the 409-on-conflict path means the optimistic state would
frequently be wrong. The cost is a spinner; the benefit is that the screen never
disagrees with the clinic's records.

## Security posture

The UI does not trust itself. `utils/permissions.ts` decides what to *offer*;
the backend decides what is *allowed*, and re-checks every request. Hidden
buttons are a usability decision, never a security control.

Nothing sensitive is logged — no credentials, tokens, clinical notes or patient
identifiers. Test data is entirely synthetic.
