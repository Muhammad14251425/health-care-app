"""
clinic_core.api.v1.patient_appointments -- the patient's own appointments.

    list / upcoming / past / cancelled / get / create / reschedule / cancel

Booking security (the requirement's flow, in order):

    authenticated patient user
        -> resolve patient mapping        guard.me(), from the session only
        -> validate practitioner          must exist and be Active
        -> validate date                  not past, inside the booking horizon
        -> validate available slot        must appear in the server's own list
        -> check conflict again           Marley's validate_overlaps at insert
        -> create Marley Patient Appointment

`patient` is never read from the request. If a client sends one, the request is
rejected rather than quietly ignored -- see patient_guard.reject_patient_override.
"""

import frappe
from frappe import _
from frappe.utils import add_days, getdate, nowdate

from clinic_core.api.response import (
    ApiError, Code, clinic_api, as_int, parse_payload,
)
from clinic_core.api.v1 import patient_guard as guard

# What the patient sees about their own appointment. `notes` is the reason the
# patient themselves gave at booking; internal staff commentary is not here.
APPT_FIELDS = [
    "name", "appointment_date", "appointment_time", "duration",
    "practitioner", "practitioner_name", "department",
    "appointment_type", "status", "notes",
]

LIVE_STATUSES = ("Scheduled", "Open", "Checked In")
PAST_STATUSES = ("Closed", "No Show")

# How far ahead a patient may book. Matches the public booking horizon.
BOOKING_HORIZON_DAYS = 180

# How many live appointments one patient may hold. Mirrors the guest flow's cap
# so an authenticated account is not a way around it.
MAX_OPEN_APPOINTMENTS = 5


def _rows(patient, filters, limit=50, start=0, order="desc"):
    query = {"patient": patient}
    query.update(filters)
    return frappe.get_all(
        "Patient Appointment",
        filters=query,
        fields=APPT_FIELDS,
        order_by=f"appointment_date {order}, appointment_time {order}",
        limit_page_length=min(as_int(limit, 50), 200),
        limit_start=as_int(start, 0),
        ignore_permissions=True,
    )


@frappe.whitelist()
@clinic_api()
def list_appointments(scope="upcoming", limit=50, start=0):
    """The caller's appointments. `scope` selects the tab, not the patient."""
    patient = guard.me()
    today = getdate(nowdate())

    scope = (scope or "upcoming").lower()
    if scope == "upcoming":
        filters = {"appointment_date": [">=", today], "status": ["in", LIVE_STATUSES]}
        order = "asc"
    elif scope == "past":
        # Anything completed, plus live-status appointments whose date has gone.
        filters = {"status": ["in", PAST_STATUSES]}
        order = "desc"
    elif scope == "cancelled":
        filters = {"status": "Cancelled"}
        order = "desc"
    elif scope == "all":
        filters = {}
        order = "desc"
    else:
        raise ApiError(Code.VALIDATION, _("Unknown scope."))

    items = _rows(patient, filters, limit, start, order)
    total = frappe.db.count("Patient Appointment", {"patient": patient, **filters})
    return {"items": items, "total": total, "scope": scope}


@frappe.whitelist()
@clinic_api()
def upcoming(limit=10):
    patient = guard.me()
    return {
        "items": _rows(
            patient,
            {"appointment_date": [">=", getdate(nowdate())],
             "status": ["in", LIVE_STATUSES]},
            limit, 0, "asc",
        )
    }


@frappe.whitelist()
@clinic_api()
def get_appointment(appointment=None):
    """One appointment -- only if it is the caller's own.

    A stranger's id and a nonexistent id produce the same 404.
    """
    patient = guard.me()
    doc = guard.own("Patient Appointment", appointment, patient)

    data = {f: doc.get(f) for f in APPT_FIELDS}
    data["can_cancel"] = doc.status in LIVE_STATUSES
    data["can_reschedule"] = doc.status in LIVE_STATUSES

    if doc.get("practitioner"):
        data["practitioner_department"] = frappe.db.get_value(
            "Healthcare Practitioner", doc.practitioner, "department"
        )
    return data


def _assert_bookable_date(date):
    day = getdate(date)
    if day < getdate(nowdate()):
        raise ApiError(Code.VALIDATION, _("Please choose a date that is not in the past."))
    if day > getdate(add_days(nowdate(), BOOKING_HORIZON_DAYS)):
        raise ApiError(Code.VALIDATION, _("Please choose a date within the next six months."))
    return day


def _assert_slot_offered(practitioner, date, time):
    """The requested time must be one the server itself just offered.

    Without this a client could post any time at all -- 03:00, or a slot in the
    middle of another patient's appointment -- and rely on Marley's overlap check
    alone, which does not know the practitioner's working hours.
    """
    from clinic_core.api.v1 import slots as slot_engine

    payload = slot_engine.compute_slots(practitioner, str(date), None) or {}
    offered = {s.get("time") for s in payload.get("slots") or []}

    if time not in offered:
        raise ApiError(
            Code.CONFLICT,
            _("That time is no longer available. Please choose another time."),
        )
    return payload.get("duration") or 30


def _assert_not_flooding(patient):
    count = frappe.db.count("Patient Appointment", {
        "patient": patient,
        "appointment_date": [">=", getdate(nowdate())],
        "status": ["in", LIVE_STATUSES],
    })
    if count >= MAX_OPEN_APPOINTMENTS:
        raise ApiError(
            Code.VALIDATION,
            _("You already have {0} upcoming appointments. "
              "Please contact the clinic to book another.").format(count),
        )


@frappe.whitelist()
@clinic_api()
def create(payload=None):
    """Book an appointment for the logged-in patient.

    The patient is taken from the session. Sending `patient` in the payload is a
    hard error -- a client has no business naming one.
    """
    from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
        OverlapError,
    )

    patient = guard.me()
    data = parse_payload(payload)
    guard.reject_patient_override(data)

    practitioner = (data.get("practitioner") or "").strip()
    if not practitioner:
        raise ApiError(Code.VALIDATION, _("Please choose a doctor."))
    if not frappe.db.exists("Healthcare Practitioner",
                            {"name": practitioner, "status": "Active"}):
        raise ApiError(Code.VALIDATION, _("Please choose a valid doctor."))

    date = _assert_bookable_date(data.get("date") or data.get("appointment_date"))

    from clinic_core.api.v1.public.guard import clean_text, clean_time
    time = clean_time(data.get("time") or data.get("appointment_time"))
    reason = clean_text(data.get("reason") or data.get("notes"),
                        _("Reason"), max_len=280, required=False)

    appointment_type = data.get("appointment_type") or "Consultation"
    if not frappe.db.exists("Appointment Type", appointment_type):
        appointment_type = frappe.db.get_value("Appointment Type", {}, "name")

    department = frappe.db.get_value("Healthcare Practitioner", practitioner, "department")

    _assert_not_flooding(patient)
    duration = _assert_slot_offered(practitioner, date, time)

    doc = frappe.get_doc({
        "doctype": "Patient Appointment",
        # From the session. Not from `data`, which was rejected above if it
        # carried a patient at all.
        "patient": patient,
        "practitioner": practitioner,
        "appointment_date": date,
        "appointment_time": time,
        "duration": duration,
        "department": department,
        "appointment_type": appointment_type,
        "appointment_for": "Practitioner",
        "notes": reason,
        "company": frappe.db.get_single_value("Global Defaults", "default_company"),
    })

    try:
        doc.insert(ignore_permissions=True)
    except OverlapError:
        frappe.db.rollback()
        raise ApiError(Code.CONFLICT,
                       _("That time was just booked. Please choose another time."))
    except frappe.ValidationError as e:
        frappe.db.rollback()
        from frappe.utils import strip_html
        raise ApiError(Code.VALIDATION,
                       strip_html(str(e)) or _("Unable to book this appointment."))

    frappe.db.commit()
    return {f: doc.get(f) for f in APPT_FIELDS}


@frappe.whitelist()
@clinic_api()
def reschedule(appointment=None, date=None, time=None, payload=None):
    """Move one of the caller's own appointments."""
    from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
        OverlapError,
    )

    patient = guard.me()
    data = parse_payload(payload) if payload else {}
    appointment = appointment or data.get("appointment")

    doc = guard.own("Patient Appointment", appointment, patient)
    if doc.status not in LIVE_STATUSES:
        raise ApiError(Code.VALIDATION,
                       _("This appointment can no longer be changed."))

    new_date = _assert_bookable_date(date or data.get("date"))

    from clinic_core.api.v1.public.guard import clean_time
    new_time = clean_time(time or data.get("time"))

    duration = _assert_slot_offered(doc.practitioner, new_date, new_time)

    doc.appointment_date = new_date
    doc.appointment_time = new_time
    doc.duration = duration

    try:
        doc.save(ignore_permissions=True)
    except OverlapError:
        frappe.db.rollback()
        raise ApiError(Code.CONFLICT,
                       _("That time was just booked. Please choose another time."))

    frappe.db.commit()
    return {f: doc.get(f) for f in APPT_FIELDS}


@frappe.whitelist()
@clinic_api()
def cancel(appointment=None, payload=None):
    """Cancel one of the caller's own appointments."""
    patient = guard.me()
    data = parse_payload(payload) if payload else {}
    appointment = appointment or data.get("appointment")

    doc = guard.own("Patient Appointment", appointment, patient)
    if doc.status == "Cancelled":
        return {f: doc.get(f) for f in APPT_FIELDS}
    if doc.status not in LIVE_STATUSES:
        raise ApiError(Code.VALIDATION,
                       _("This appointment can no longer be cancelled."))

    doc.status = "Cancelled"
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {f: doc.get(f) for f in APPT_FIELDS}
