"""
clinic_core.api.v1.patient -- the logged-in patient's own profile.

    GET clinic_core.api.v1.patient.me
    GET clinic_core.api.v1.patient.home
    POST clinic_core.api.v1.patient.update_me

There is no `patient` parameter anywhere in this module. The record is resolved
from the session (see patient_guard.me), which is the whole point: an endpoint
that cannot be told which patient to load cannot be tricked into loading the
wrong one.
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate

from clinic_core.api.response import (
    ApiError, Code, clinic_api, parse_payload, pick,
)
from clinic_core.api.v1 import patient_guard as guard
from clinic_core.api.v1.phone import display, normalize

# What a patient may see about themselves. Deliberately narrower than the staff
# view: no `customer` (accounting linkage), no `user_id`, no inpatient state.
PROFILE_FIELDS = [
    "name", "patient_name", "sex", "dob", "blood_group",
    "mobile", "phone", "email", "status",
]

# What a patient may CHANGE about themselves.
#
# `mobile` is absent on purpose -- it is the login identity, and moving it
# requires proving control of the new number through patient_auth's OTP change
# flow. Everything identifying or clinical (name, dob, sex, blood group, status,
# patient id) is absent too: those are corrected by staff against evidence, not
# self-asserted from a phone.
EDITABLE_FIELDS = ["email", "phone"]

# Emergency contact + address live on the linked Contact/Address records in
# Frappe rather than on Patient itself.
EMERGENCY_FIELDS = ["emergency_contact_name", "emergency_phone", "relation"]

LIVE_STATUSES = ("Scheduled", "Open", "Checked In")


def _counts(patient):
    """The three numbers the Home quick-cards show. All scoped to `patient`."""
    today = getdate(nowdate())

    upcoming = frappe.db.count("Patient Appointment", {
        "patient": patient,
        "appointment_date": [">=", today],
        "status": ["in", LIVE_STATUSES],
    })

    # A "visit" is a completed appointment; encounters exist only when a doctor
    # wrote notes, so counting those would under-report.
    visits = frappe.db.count("Patient Appointment", {
        "patient": patient,
        "status": "Closed",
    })

    outstanding = frappe.db.sql(
        """
        SELECT COALESCE(SUM(outstanding_amount), 0)
        FROM `tabSales Invoice`
        WHERE patient = %s AND docstatus = 1
        """,
        (patient,),
    )
    due = flt(outstanding[0][0]) if outstanding else 0.0

    unpaid = frappe.db.count("Sales Invoice", {
        "patient": patient,
        "docstatus": 1,
        "outstanding_amount": [">", 0],
    })

    return {
        "upcoming": upcoming,
        "visits": visits,
        "outstanding": due,
        "unpaid_invoices": unpaid,
    }


def _next_appointment(patient):
    """The soonest live appointment, or None."""
    rows = frappe.get_all(
        "Patient Appointment",
        filters={
            "patient": patient,
            "appointment_date": [">=", getdate(nowdate())],
            "status": ["in", LIVE_STATUSES],
        },
        fields=["name", "appointment_date", "appointment_time", "duration",
                "practitioner", "practitioner_name", "department",
                "appointment_type", "status"],
        order_by="appointment_date asc, appointment_time asc",
        limit_page_length=1,
        ignore_permissions=True,
    )
    return rows[0] if rows else None


@frappe.whitelist()
@clinic_api()
def me():
    """The caller's own profile. Takes no arguments -- by design."""
    patient = guard.me()

    row = frappe.db.get_value("Patient", patient, PROFILE_FIELDS, as_dict=True) or {}
    data = dict(row)
    data["patient_id"] = patient
    data["mobile_display"] = display(row.get("mobile") or "")

    mapping = frappe.db.get_value(
        "Patient Phone Mapping", {"patient": patient},
        ["phone_e164", "verified_on"], as_dict=True,
    )
    data["login_phone"] = display(mapping.phone_e164) if mapping else None
    data["phone_verified_on"] = mapping.verified_on if mapping else None

    data.update(_counts(patient))
    return data


@frappe.whitelist()
@clinic_api()
def home():
    """Everything the Home screen needs, in one round trip.

    Bundled deliberately: a patient on mobile data should not pay four request
    latencies to see one screen.
    """
    patient = guard.me()

    row = frappe.db.get_value(
        "Patient", patient, ["patient_name", "mobile"], as_dict=True
    ) or {}

    recent = frappe.get_all(
        "Patient Appointment",
        filters={"patient": patient, "status": ["in", ("Closed", "No Show")]},
        fields=["name", "appointment_date", "appointment_time",
                "practitioner", "practitioner_name", "department", "status"],
        order_by="appointment_date desc, appointment_time desc",
        limit_page_length=5,
        ignore_permissions=True,
    )

    return {
        "patient_id": patient,
        "patient_name": row.get("patient_name"),
        "counts": _counts(patient),
        "next_appointment": _next_appointment(patient),
        "recent_visits": recent,
    }


@frappe.whitelist()
@clinic_api()
def update_me(payload=None):
    """Update the caller's own contact details.

    Anything outside EDITABLE_FIELDS is dropped by `pick` -- silently, because a
    client sending extra fields is usually just sending back the whole object it
    was given. A client naming a PATIENT, though, is doing something else, and
    that is rejected outright.
    """
    patient = guard.me()

    raw = parse_payload(payload)
    guard.reject_patient_override(raw)

    data = pick(raw, EDITABLE_FIELDS)
    if not data:
        raise ApiError(Code.VALIDATION, _("No permitted fields to update."))

    if data.get("email"):
        from clinic_core.api.v1.public.guard import clean_email
        data["email"] = clean_email(data["email"])

    if data.get("phone"):
        # A secondary landline, not the login identity -- normalised for
        # consistency but not treated as an authentication factor.
        data["phone"] = normalize(data["phone"], _("Phone"))

    doc = frappe.get_doc("Patient", patient)
    doc.update(data)
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {f: doc.get(f) for f in PROFILE_FIELDS}


@frappe.whitelist()
@clinic_api()
def emergency_contact():
    """The patient's emergency contact, if the install records one."""
    patient = guard.me()

    fields = {}
    meta = frappe.get_meta("Patient")
    for f in EMERGENCY_FIELDS:
        if meta.get_field(f):
            fields[f] = frappe.db.get_value("Patient", patient, f)

    return {"available": bool(fields), "contact": fields}
