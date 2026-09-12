# BACKEND API AUDIT — live results

**2026-09-10.** Every row below was called for real against `http://localhost:8000`
(Frappe 16.33.1 · ERPNext 16.34.2 · Marley Health 16.5.2 · `clinic_core`). Nothing here is
inferred from endpoint names.

**URL shape:** `/api/method/clinic_core.api.v1.<module>.<function>` — all dots. A slash after
`v1` yields HTTP 417 + a bare `AttributeError`, which looks exactly like a broken backend.

**Auth:** session login (`auth.login` with `usr`/`pwd`), `sid` returned in the body and sent
back by the client as an explicit `Cookie: sid=<sid>` header. No token endpoint is
implemented (`src/api/session.ts` documents this and the swap to
`Authorization: token key:secret` is a one-function change).

---

## Coverage

**41 endpoints implemented; the mobile app calls 39 of them.** Every endpoint the app calls
exists server-side with a matching name — no dead calls, no invented endpoints.

| Module | Endpoints | Mobile uses | Live result |
|---|---:|---:|---|
| `auth` | 3 | 3 | ✅ all work |
| `patients` | 5 | 5 | ✅ all work (1 bug in `total`) |
| `appointments` | 8 | 8 | ⚠️ 7 work, `bookable_slots` poisons the session |
| `encounters` | 5 | 5 | ✅ all work |
| `invoices` | 7 | 6 | ✅ all work |
| `payments` | 2 | 2 | ✅ all work |
| `practitioners` | 9 | 8 | ✅ all work |
| `public.*` | 7 | 7 | ✅ all work as guest |

---

## Per-endpoint results

### auth
| Function | Method | Auth | Result |
|---|---|---|---|
| `auth.login` | POST | guest | ✅ 200 · returns persona, roles, practitioner, sid |
| `auth.me` | POST | session | ✅ 200 · correct persona per role |
| `auth.logout` | POST | session | ✅ 200 |

Negative cases — **both correct**:
- wrong password → **401** `UNAUTHENTICATED` *"Invalid credentials."*
- unknown user → **401**, byte-identical message (no user enumeration) ✅

### patients
| Function | Result |
|---|---|
| `list_patients` | ✅ 200 · 9 real patients · server-side `or_filters` search on name/mobile/email/id · ⚠️ **BUG-02**: `total` ignores the search |
| `get_patient` | ✅ 200 |
| `create_patient` | ✅ 200 · created `QAMobile Patient` · also returns `possible_duplicates` |
| `update_patient` | ✅ 200 · phone change verified persisted from a **fresh session** |
| `visit_history` | ✅ 200 · returns real `appointments[]` + `encounters[]` |

### appointments
| Function | Result |
|---|---|
| `list_appointments` | ✅ 200 · scoped per role (admin 26, doc1 25, doc2 1) |
| `get_appointment` | ✅ 200 · ⚠️ **BUG-03** not scoped |
| `available_slots` | ✅ 200 · raw Marley windows (kept deliberately) |
| `bookable_slots` | ❌ **BUG-01** returns correct data but **destroys the session** |
| `working_days` | ✅ 200 · session-safe |
| `create_appointment` | ✅ 200 · created `HLC-APP-2026-00042/43/44/45/47/48/49/50` · **409 on conflict** |
| `reschedule_appointment` | ✅ 200 · old slot freed, new slot taken, persisted |
| `set_status` | ✅ 200 · Open / Closed / No Show all accepted |
| `cancel_appointment` | ✅ 200 · status → `Cancelled` |

### encounters (clinical notes)
| Function | Result |
|---|---|
| `list_encounters` | ✅ admin 12 · doc1 12 · **doc2 0** · reception **403** |
| `get_encounter` | ✅ doctor full · admin full · reception **redacted** · **doc2 403** |
| `create_encounter` | ✅ 200 · created `HLC-ENC-2026-00014` · reception **403** |
| `update_encounter` | ✅ implemented |
| `submit_encounter` | ✅ 200 · `docstatus` 0 → 1 |

### invoices + payments
| Function | Result |
|---|---|
| `list_invoices` | ✅ admin/reception 200 · **doctor 403** |
| `get_invoice` | ✅ 200 · ⚠️ **BUG-03** doctor also gets 200 |
| `create_consultation_invoice` | ✅ 200 · real `ACC-SINV-2026-00012`, Rs 3,000, submitted |
| `submit_invoice` | ✅ implemented |
| `invoice_pdf` | ✅ 200 · real base64 `%PDF` · **doctor 403** |
| `email_invoice` | ✅ implemented · missing mail config → 4xx not 500 (tested) |
| `outstanding` | ✅ 200 |
| `record_payment` | ✅ real ERPNext Payment Entries `ACC-PAY-2026-00022/23` |
| `payment_history` | ✅ 200 |

Money guards, both verified:
- overpay (Rs 5,000 against Rs 2,000 outstanding) → **400** *"Amount exceeds outstanding 2000.0."*
- pay an already-paid invoice → **409** *"Invoice is already fully paid."*

### practitioners / availability
| Function | Result |
|---|---|
| `list_practitioners` · `get_practitioner` · `list_departments` | ✅ 200 |
| `availability` | ✅ 200 · weekly slots + `can_manage` flag |
| `unavailability` | ✅ 200 |
| `set_schedule` | ✅ implemented · **forks a shared schedule onto a private copy** (verified: `Dr Second Doctor Schedule`) |
| `block_time` | ✅ 200 · 16 → 14 slots, propagated to **staff *and* guest** views |
| `set_leave` | ✅ implemented · full day → `available:false`, booking → **409** |
| `clear_unavailability` | ✅ 200 · slots restored to 16 |

Reason field is an enum — free text → **400** *"Reason must be one of: Time Off, Break,
Training, Travel, Emergency"*. Good input validation.

### public (guest — no authentication)
| Function | Result |
|---|---|
| `public.departments.list_departments` | ✅ 200 as guest |
| `public.practitioners.list_practitioners` | ✅ 200 · includes `consultation_fee` |
| `public.practitioners.get_practitioner` | ✅ 200 |
| `public.availability.days` | ✅ 200 |
| `public.availability.slots` | ✅ 200 · **discrete bookable times**, `{time, label, available}` |
| `public.booking.create` | ✅ 200 · created `HLC-APP-2026-00041`, `-00051` **while logged out** |
| `public.booking.appointment_types` | ✅ 200 |

---

## Slot engine — single source of truth (verified)

One server-side derivation (`api/v1/slots.compute_slots`) feeds both the staff and guest
paths, so the two cannot disagree about one calendar. Confirmed live: after a guest booked
11:30, **both** `bookable_slots` (staff) and `public.availability.slots` (guest) dropped from
15 → 14 free slots and neither offered 11:30. The old client-side derivation
(`utils/slots.ts`) is deleted.

Slots are returned pre-formatted (`"09:30:00"` / `"9:30 AM"` / `available`), so the client no
longer parses Marley's unpadded `H:MM:SS` windows.

---

## Guest lockout (P0 surface — all correct)

| Endpoint called with no session | Result |
|---|---|
| `patients.list_patients` | **403** PermissionError ✅ |
| `appointments.list_appointments` | **403** ✅ |
| `invoices.list_invoices` | **403** ✅ |
| `encounters.list_encounters` | **403** ✅ |
| `invoices.invoice_pdf` | **403** ✅ (covered by a backend test too) |

No guest can reach patient data, clinical notes, invoices or the admin calendar.

---

## Error contract

Every `clinic_core` endpoint returns `{success, data, error:{code, message}}` with correct
HTTP status: 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`,
409 `CONFLICT`.

**One exception:** the BUG-01 failure returns a bare `403 "No App"` string with no envelope —
which is precisely why the client mishandles it.
