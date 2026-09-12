"""
clinic_core.api.v1.patients

Every endpoint that addresses a patient by name calls assert_patient_access(),
which is the horizontal-access guard Marley does not consistently apply.

Field exposure is whitelisted: we never return `frappe.get_doc(...).as_dict()`
wholesale, because that leaks internal/administrative fields to mobile clients.
"""

import frappe
from frappe import _

from clinic_core.api.response import (
    ApiError, Code, clinic_api, assert_patient_access, current_patient,
    is_staff, parse_payload, pick, as_int,
)

STAFF = ["Healthcare Administrator", "Physician", "Nursing User"]

# Fields safe to return to any authorised caller.
PATIENT_FIELDS = [
    "name", "patient_name", "sex", "dob", "blood_group",
    "mobile", "email", "status", "creation",
]

# Fields a client may set on create.
CREATE_FIELDS = [
    "first_name", "last_name", "sex", "dob", "blood_group",
    "mobile", "email", "phone",
]

# Fields a client may change on update -- deliberately excludes user_id, status,
# customer and anything else that would let a client re-link or escalate.
UPDATE_FIELDS = ["mobile", "email", "phone", "blood_group"]


@frappe.whitelist()
@clinic_api(roles=STAFF)
def list_patients(search=None, limit=20, start=0):
    """Staff-only patient list/search."""
    limit = min(as_int(limit, 20), 100)
    start = as_int(start, 0)

    filters = {"status": "Active"}
    or_filters = None
    if search:
        like = f"%{search}%"
        or_filters = [
            ["patient_name", "like", like],
            ["mobile", "like", like],
            ["email", "like", like],
            ["name", "like", like],
        ]

    rows = frappe.get_list(
        "Patient",
        filters=filters,
        or_filters=or_filters,
        fields=PATIENT_FIELDS,
        limit_page_length=limit,
        limit_start=start,
        order_by="modified desc",
    )

    # `total` drives both the "N registered" label and the infinite-scroll
    # stop condition in the mobile list (loaded < total => fetch another page).
    # frappe.db.count() takes `filters` but NOT `or_filters`, so counting with
    # it ignored the search terms entirely: a search matching 2 patients still
    # reported the full active-patient count, which showed the wrong number and
    # made the list request a page that could only come back empty.
    # get_list() honours or_filters, so count through it instead.
    # Frappe rejects raw SQL strings in `fields`; {"COUNT": "*"} is the
    # supported aggregate form.
    count_rows = frappe.get_list(
        "Patient",
        filters=filters,
        or_filters=or_filters,
        fields=[{"COUNT": "*"}],
    )
    total = next(iter(count_rows[0].values())) if count_rows else 0

    return {"items": rows, "total": total, "limit": limit, "start": start}


@frappe.whitelist()
@clinic_api()
def get_patient(patient=None):
    """Patient details.

    A Patient-role caller may omit `patient` to fetch their own record; passing
    someone else's id is rejected by assert_patient_access().
    """
    if not patient:
        patient = current_patient()
        if not patient:
            raise ApiError(Code.NOT_FOUND, _("No patient record linked to this user."))

    assert_patient_access(patient)

    doc = frappe.get_doc("Patient", patient)
    return {f: doc.get(f) for f in PATIENT_FIELDS}


@frappe.whitelist()
@clinic_api(roles=STAFF)
def create_patient(payload=None):
    """Create a patient. Staff only."""
    data = pick(parse_payload(payload), CREATE_FIELDS)

    if not data.get("first_name"):
        raise ApiError(Code.VALIDATION, _("first_name is required."))
    if not data.get("sex"):
        raise ApiError(Code.VALIDATION, _("sex is required."))

    # Soft duplicate detection -- surfaced, not silently merged.
    dupes = []
    if data.get("mobile"):
        dupes = frappe.get_all("Patient",
                               filters={"mobile": data["mobile"], "status": "Active"},
                               fields=["name", "patient_name"])

    doc = frappe.get_doc({"doctype": "Patient", **data})
    doc.insert()
    frappe.db.commit()

    return {
        "name": doc.name,
        "patient_name": doc.patient_name,
        "possible_duplicates": dupes,
    }


@frappe.whitelist()
@clinic_api()
def update_patient(patient=None, payload=None):
    """Update permitted contact fields.

    Patients may update their OWN contact details only. Staff may update any
    patient. Fields outside UPDATE_FIELDS are silently dropped by pick().
    """
    if not patient:
        patient = current_patient()
    assert_patient_access(patient)

    data = pick(parse_payload(payload), UPDATE_FIELDS)
    if not data:
        raise ApiError(Code.VALIDATION, _("No permitted fields to update."))

    doc = frappe.get_doc("Patient", patient)
    doc.update(data)
    doc.save()
    frappe.db.commit()

    return {f: doc.get(f) for f in PATIENT_FIELDS}


@frappe.whitelist()
@clinic_api()
def visit_history(patient=None, limit=50):
    """Appointments + encounters for a patient, newest first."""
    if not patient:
        patient = current_patient()
    assert_patient_access(patient)
    limit = min(as_int(limit, 50), 200)

    appointments = frappe.get_all(
        "Patient Appointment",
        filters={"patient": patient},
        fields=["name", "appointment_date", "appointment_time", "status",
                "practitioner", "department", "duration"],
        order_by="appointment_date desc, appointment_time desc",
        limit_page_length=limit,
    )
    encounters = frappe.get_all(
        "Patient Encounter",
        filters={"patient": patient},
        fields=["name", "encounter_date", "practitioner", "docstatus"],
        order_by="encounter_date desc",
        limit_page_length=limit,
    )
    return {"patient": patient, "appointments": appointments, "encounters": encounters}
