# Role Permissions

## The rule that matters

**UI hiding is not security.** Every `clinic_core` endpoint enforces its own
authorization server-side. The helpers in `src/utils/permissions.ts` decide what
the app *offers*; if a user reaches a forbidden action anyway, the backend
refuses and the app renders a clean permission message.

`auth.me` returns `persona` and `roles`. These are UI hints. Nothing is ever
inferred from an email address.

---

## Verified matrix

Probed against the running backend on 2026-09-09 with the seeded test accounts —
not inferred from role names. **It is not a hierarchy**: admin is not a superset
of doctor.

| Endpoint group | `admin` | `reception` | `practitioner` (doctor) |
|---|---|---|---|
| `patients.*` | ✅ | ✅ | ✅ |
| `appointments.*` | ✅ | ✅ | ✅ (own calendar by default) |
| `practitioners.*` | ✅ | ✅ | ✅ |
| **`encounters.*`** | **403** | **403** | ✅ |
| **`invoices.*`** | ✅ | ✅ | **403** |
| `payments.*` | ✅ | ✅ | 403 |

The two surprises, both confirmed by live probe:

* **Clinic Admin cannot read clinical notes.** `Healthcare Administrator` has no
  `Patient Encounter` permission — `list_encounters` returns
  `Insufficient Permission for Patient Encounter`.
* **Doctors cannot touch billing.** A pure `Physician` has no `Sales Invoice`
  permission.

## Frappe roles behind each persona

| Persona | Roles |
|---|---|
| `admin` | Healthcare Administrator, System Manager, Accounts Manager, Item Manager, Stock User |
| `reception` | Nursing User, Accounts User, Item Manager |
| `practitioner` | Physician |
| `patient` | Patient |

Marley ships **no** "Healthcare Receptionist" role; reception is `Nursing User`
plus accounts roles.

---

## Permission helpers

Defined in `src/utils/permissions.ts` and consumed via `usePermissions()`.

| Helper | True for |
|---|---|
| `canViewPatients` | any staff role |
| `canCreatePatient` | admin, reception, doctor |
| `canEditPatient` | admin, reception |
| `canViewAppointments` | any staff role |
| `canCreateAppointment` | admin, reception, doctor |
| `canManageAppointmentStatus` | admin, reception, doctor |
| `canManageAvailability` | admin, reception, doctor — "can edit *some* calendar". The per-practitioner answer (a doctor may edit only their own) comes from the server as `can_manage` on `practitioners.availability`; gate the controls on that |
| `canViewClinicalNotes` | **Physician only** (+ Administrator/System Manager) |
| `canCreateEncounter` | Physician, Healthcare Administrator |
| `canViewBilling` | admin, reception (Healthcare Administrator, Accounts \*, Nursing User) |
| `canCreateInvoice` | same as billing |
| `canRecordPayment` | same as billing |

---

## How the UI changes

### Tab bar

| Persona | Tabs |
|---|---|
| Admin | Home · Appointments · Patients · **Billing** · Me |
| Reception | Home · Appointments · Patients · **Billing** · Me |
| Doctor | Home · Appointments · Patients · **Activity** · Me |

The doctor's fourth tab is Activity precisely because Billing would 403.
Implemented in `app/(app)/(tabs)/_layout.tsx` by setting `href: null` on the tab
the role cannot use.

### Dashboard

| Persona | Hero | Actions | Billing summary |
|---|---|---|---|
| Admin | "Today's appointments" | New · Patients · Calendar | shown |
| Reception | "Appointments today" | Book · Check in · Patients | shown |
| Doctor | "Today's patients" | Start visit · Schedule · Patients | **hidden** |

### Patient profile

Clinical notes row appears only when `canViewClinicalNotes`. The Invoices row
appears only when `canViewBilling`; doctors get a Records count instead.

### Clinical content

The backend **omits** `symptoms`, `diagnosis` and `encounter_comment` from the
payload entirely for callers without clinical access, and flags this with
`clinical_access: false`. The encounter screen honours that distinction: absent
means "not shown", never "shown as empty".

---

## Public (guest) surface

No session at all. A guest may only:

* list bookable departments and doctors
* read available days and times
* submit one booking

A guest cannot reach patient records, visit history, clinical notes, invoices,
or any staff endpoint. This is asserted by
`clinic_core/tests/test_public_booking.py::TestGuestStillLockedOut`, which
re-checks every protected endpoint as `Guest` and requires each to refuse.
