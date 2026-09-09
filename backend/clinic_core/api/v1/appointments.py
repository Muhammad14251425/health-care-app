"""
clinic_core.api.v1.appointments

Booking rules are NOT reimplemented here. Marley already validates overlaps
(PatientAppointment.validate_overlaps -> OverlapError) and practitioner
unavailability. clinic_core adds:
  * authorization (who may see/act on which appointment)
  * a stable response envelope
  * translation of Marley's OverlapError into a 409 CONFLICT
"""

import frappe
from frappe import _
from frappe.utils import getdate, nowdate

from clinic_core.api.response import (
    ApiError, Code, clinic_api, assert_patient_access, current_patient,
    current_practitioner, is_staff, parse_payload, pick, as_int, ok,
)

STAFF = ["Healthcare Administrator", "Physician", "Nursing User"]
BOOKING_ROLES = ["Healthcare Administrator", "Nursing User", "Physician", "Patient"]

APPT_FIELDS = [
    "name", "patient", "patient_name", "practitioner", "practitioner_name",
    "department", "appointment_date", "appointment_time", "duration",
    "status", "appointment_type", "company", "notes",
]


def _scope_filters(patient=None, practitioner=None):
    """Restrict the visible set according to the caller's persona.

    Patients see only their own appointments. Practitioners default to their own
    but may query wider if they are also staff. Admin/reception see everything.
    """
    filters = {}
    my_patient = current_patient()
    my_practitioner = current_practitioner()

    if not is_staff():
        # Lowest trust: patient-only view, ignore any client-supplied patient.
        if not my_patient:
            raise ApiError(Code.FORBIDDEN, _("No patient record linked to this user."))
        filters["patient"] = my_patient
        return filters

    if patient:
        assert_patient_access(patient)
        filters["patient"] = patient
    if practitioner:
        filters["practitioner"] = practitioner
    elif my_practitioner and not set(frappe.get_roles()) & {
        "Administrator", "System Manager", "Healthcare Administrator", "Nursing User"
    }:
        # A pure Physician defaults to their own calendar.
        filters["practitioner"] = my_practitioner
    return filters


@frappe.whitelist()
@clinic_api()
def list_appointments(patient=None, practitioner=None, status=None,
                      from_date=None, to_date=None, limit=50, start=0):
    filters = _scope_filters(patient, practitioner)
    if status:
        filters["status"] = status
    if from_date and to_date:
        filters["appointment_date"] = ["between", [getdate(from_date), getdate(to_date)]]
    elif from_date:
        filters["appointment_date"] = [">=", getdate(from_date)]
    elif to_date:
        filters["appointment_date"] = ["<=", getdate(to_date)]

    limit = min(as_int(limit, 50), 200)
    rows = frappe.get_list(
        "Patient Appointment",
        filters=filters,
        fields=APPT_FIELDS,
        limit_page_length=limit,
        limit_start=as_int(start, 0),
        order_by="appointment_date desc, appointment_time desc",
    )
    return {"items": rows, "total": frappe.db.count("Patient Appointment", filters)}


@frappe.whitelist()
@clinic_api()
def get_appointment(appointment):
    if not frappe.db.exists("Patient Appointment", appointment):
        raise ApiError(Code.NOT_FOUND, _("Appointment not found."))

    doc = frappe.get_doc("Patient Appointment", appointment)
    # Horizontal guard: a patient may only read their own appointment.
    if not is_staff():
        assert_patient_access(doc.patient)

    return {f: doc.get(f) for f in APPT_FIELDS}


@frappe.whitelist()
@clinic_api()
def available_slots(practitioner, date=None, appointment_type=None):
    """Delegate to Marley's own slot computation -- do not reimplement."""
    from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
        get_availability_data,
    )

    if not frappe.db.exists("Healthcare Practitioner", practitioner):
        raise ApiError(Code.NOT_FOUND, _("Practitioner not found."))

    date = date or nowdate()

    # Marley's get_availability_data() needs a real appointment-shaped object:
    #   * frappe's typing_validations rejects None (str | dict | PatientAppointment)
    #   * get_appointment_doc() feeds a dict to frappe.get_doc(), which strips the
    #     dict through pydantic coercion first -- the "doctype" key does not
    #     survive, giving ValueError: "doctype" is a required key
    #   * it then reads appointment.appointment_type
    # Passing an actual (unsaved) Document instance sidesteps the coercion entirely.
    probe = frappe.new_doc("Patient Appointment")
    probe.practitioner = practitioner
    probe.appointment_date = date
    probe.appointment_type = (appointment_type
                              or frappe.db.get_value("Appointment Type", {}, "name"))

    try:
        data = get_availability_data(date=date, practitioner=practitioner, appointment=probe)
    except frappe.ValidationError as e:
        from frappe.utils import strip_html
        # Marley throws "Healthcare Practitioner not available on <weekday>" and
        # "Practitioner Schedule Not Found" as validation errors. Those are normal
        # answers to "what is free?", not failures -- return an empty slot list.
        return ok({"practitioner": practitioner, "date": date,
                   "slot_details": [], "available": False,
                   "message": strip_html(str(e))})

    return {"practitioner": practitioner, "date": date, "available": True,
            "slot_details": data.get("slot_details", []),
            "fee_validity": data.get("fee_validity")}


@frappe.whitelist()
@clinic_api(roles=BOOKING_ROLES)
def create_appointment(payload=None):
    """Book an appointment.

    Marley's validate_overlaps() enforces double-booking protection; we surface
    that as a 409 CONFLICT rather than a generic validation error so clients can
    react (e.g. refresh the slot list).
    """
    from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
        OverlapError,
    )

    data = pick(parse_payload(payload), [
        "patient", "practitioner", "appointment_date", "appointment_time",
        "duration", "department", "appointment_type", "company", "notes",
        "appointment_for", "service_unit",
    ])

    # A patient booking for themselves may not book for anyone else.
    if not is_staff():
        mine = current_patient()
        if not mine:
            raise ApiError(Code.FORBIDDEN, _("No patient record linked to this user."))
        data["patient"] = mine
    else:
        if not data.get("patient"):
            raise ApiError(Code.VALIDATION, _("patient is required."))
        assert_patient_access(data["patient"])

    for req in ("practitioner", "appointment_date"):
        if not data.get(req):
            raise ApiError(Code.VALIDATION, _("{0} is required.").format(req))

    # Sensible defaults so mobile clients need not know ERPNext internals.
    data.setdefault("appointment_type", "Consultation")
    data.setdefault("appointment_for", "Practitioner")
    data.setdefault("company", frappe.defaults.get_user_default("Company")
                    or frappe.db.get_single_value("Global Defaults", "default_company"))
    if not data.get("department"):
        data["department"] = frappe.db.get_value(
            "Healthcare Practitioner", data["practitioner"], "department")

    doc = frappe.get_doc({"doctype": "Patient Appointment", **data})
    try:
        doc.insert()
    except OverlapError as e:
        from frappe.utils import strip_html
        raise ApiError(Code.CONFLICT, strip_html(str(e)) or _("Slot already booked."))

    frappe.db.commit()
    return {f: doc.get(f) for f in APPT_FIELDS}


@frappe.whitelist()
@clinic_api(roles=BOOKING_ROLES)
def reschedule_appointment(appointment, appointment_date=None, appointment_time=None):
    from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
        OverlapError,
    )

    if not frappe.db.exists("Patient Appointment", appointment):
        raise ApiError(Code.NOT_FOUND, _("Appointment not found."))

    doc = frappe.get_doc("Patient Appointment", appointment)
    if not is_staff():
        assert_patient_access(doc.patient)

    if appointment_date:
        doc.appointment_date = getdate(appointment_date)
    if appointment_time:
        doc.appointment_time = appointment_time

    try:
        doc.save()
    except OverlapError as e:
        from frappe.utils import strip_html
        raise ApiError(Code.CONFLICT, strip_html(str(e)) or _("Slot already booked."))

    frappe.db.commit()
    return {f: doc.get(f) for f in APPT_FIELDS}


@frappe.whitelist()
@clinic_api(roles=BOOKING_ROLES)
def cancel_appointment(appointment):
    if not frappe.db.exists("Patient Appointment", appointment):
        raise ApiError(Code.NOT_FOUND, _("Appointment not found."))

    doc = frappe.get_doc("Patient Appointment", appointment)
    if not is_staff():
        assert_patient_access(doc.patient)

    doc.status = "Cancelled"
    doc.save()
    frappe.db.commit()
    return {f: doc.get(f) for f in APPT_FIELDS}


@frappe.whitelist()
@clinic_api(roles=STAFF)
def set_status(appointment, status):
    """Staff-only status transition.

    Deliberately allowlisted -- contrast with Marley's set_request_status(), which
    accepts an arbitrary doctype and performs no permission check (issue #1063).
    """
    allowed = {"Scheduled", "Open", "Closed", "Cancelled", "No Show", "Checked In"}
    if status not in allowed:
        raise ApiError(Code.VALIDATION, _("Invalid status."))
    if not frappe.db.exists("Patient Appointment", appointment):
        raise ApiError(Code.NOT_FOUND, _("Appointment not found."))

    doc = frappe.get_doc("Patient Appointment", appointment)
    doc.status = status
    doc.save()
    frappe.db.commit()
    return {f: doc.get(f) for f in APPT_FIELDS}
