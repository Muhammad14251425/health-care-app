# MOCK / FAKE DATA AUDIT

**2026-09-10.** Result: **no mock data anywhere in the mobile app.**

This was the single most important thing to disprove, because a screen that looks finished
while rendering a hardcoded array is the most common way an app appears more complete than
it is.

## Method

1. Case-insensitive scan of `src/` and `app/` for
   `mock`, `dummy`, `fake`, `sampleData`, `testData`, `placeholder = [`.
2. Regex scan for hardcoded domain arrays:
   `const|let (patients|appointments|invoices|doctors|availableSlots|practitioners|slots) = [`
3. Per-screen check that every data-bearing route calls a query hook or API module.
4. Cross-check: the records shown in the running app were matched against records returned
   by direct API calls.

## Findings

### Hardcoded domain arrays

```
(none)
```

Zero matches across every `.ts`/`.tsx` file in `src/` and `app/`.

### Keyword matches — all benign

| File | Match | Real mock data? | Assessment |
|---|---|:--:|---|
| `src/components/ui/Screen.tsx:6` | "fake phone frame is deliberately NOT reproduced" | **No** | Comment about the design reference mockup |
| `src/theme/spacing.ts:4` | "renders inside a 300px-wide fake phone" | **No** | Comment explaining how reference pixel values were scaled |
| `src/api/__tests__/slotParity.test.ts` | test fixtures | **No** | A unit-test file; fixtures never ship to a screen |

No `mock`, `dummy`, `sampleData` or `testData` identifier exists in application code.

## Per-screen data source

Every route that displays data resolves it through TanStack Query or an API module. Counts of
`useQuery|useMutation|useInfiniteQuery|Api\.|useAuth|useDashboard|useStaffSlots` per file:

| Screens with real data calls | 26 of 34 routes |
|---|---|
| Routes with 0 calls | 8 — all legitimately static |

The 8 with no data calls: `_layout.tsx` × 4 (navigation containers), `(public)/welcome`
(static marketing copy), `book/details` (a form reading the booking store),
`book/success` (renders the confirmation passed from the previous step), and
`app/_layout.tsx` (fonts/providers). None of these should call an API.

## Corroboration — data is genuinely live

Not just "an API is called", but the same records appear on both sides:

- The emulator dashboard showed **"Today's appointments 8"** with patients *Ayesha Khan*,
  *Sana*, *Blocked Attempt*, *Ali Khan* — all present in the `list_appointments` API response.
- Records **created during this audit** appeared in the app's data: patient
  `QAMobile Patient`, appointment `HLC-APP-2026-00041`, invoice `ACC-SINV-2026-00012`,
  encounter `HLC-ENC-2026-00014`.
- IDs follow real ERPNext/Marley naming series (`HLC-APP-`, `HLC-ENC-`, `ACC-SINV-`,
  `ACC-PAY-`), which a hand-written fixture would not produce.
- Values changed correctly in response to writes (invoice outstanding 3000 → 2000 → 0;
  slot list 15 → 14 after a booking).

## Previously removed

`src/utils/slots.ts` — the client-side slot derivation — **was deleted**, and slot generation
moved server-side (`api/v1/slots.compute_slots`) so the staff and guest flows share one
calendar. Verified: both now return identical slot lists. This was real logic rather than
mock data, but it was the last place where the client invented data the backend should own.

## Conclusion

**No feature in this app is faked.** Where something does not work (BUG-01), it fails against
a real backend — it does not silently succeed against a fixture. Screens marked incomplete
elsewhere in this audit are incomplete for functional reasons, never because they render
fabricated data.
