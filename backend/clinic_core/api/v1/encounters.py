"""
clinic_core.api.v1.encounters

POLICY DECISION (documented in docs/02_API_SECURITY_AUDIT.md):
Clinical notes are visible to the treating practitioner, healthcare admins, and the
patient themselves -- but NOT to reception (Nursing User). Reception needs scheduling
and billing data, not diagnoses. This is enforced here, at the backend.
"""

import frappe
from frappe import _
from frappe.utils import nowdate

from clinic_core.api.response import (
    ApiError, Code, clinic_api, assert_patient_access, current_patient,
    current_practitioner, is_staff, parse_payload, pick, as_int,
)

CLINICAL_ROLES = ["Physician", "Healthcare Administrator"]

# Summary fields -- safe for any authorised caller (incl. reception, for scheduling).
ENCOUNTER_SUMMARY = [
    "name", "patient", "patient_name", "practitioner", "practitioner_name",
    "encounter_date", "encounter_time", "docstatus", "company",
]

# Clinical detail -- gated.
ENCOUNTER_CLINICAL = ["symptoms", "diagnosis", "encounter_comment"]

# `symptoms` and `diagnosis` are NOT text fields: in Marley they are
# `Table MultiSelect` child tables (Patient Encounter Symptom / Diagnosis), each
# row linking to a Complaint / Diagnosis master. Assigning a plain string raises
# "TypeError: 'str' object does not support item assignment".
# Clients send simple string lists; we normalise them here.
# (child doctype, child link fieldname, master doctype, master's own field name)
# NOTE the asymmetry, confirmed from the doctype meta:
#   Complaint.autoname = field:complaints  -> the field is "complaints" (PLURAL)
#   Diagnosis.autoname = field:diagnosis   -> the field is "diagnosis"
MULTISELECT_FIELDS = {
    "symptoms": ("Patient Encounter Symptom", "complaint", "Complaint", "complaints"),
    "diagnosis": ("Patient Encounter Diagnosis", "diagnosis", "Diagnosis", "diagnosis"),
}


def _as_list(value):
    """Accept "a, b" or ["a", "b"] or None."""
    if value is None:
        return []
    if isinstance(value, str):
        return [p.strip() for p in value.split(",") if p.strip()]
    if isinstance(value, (list, tuple)):
        out = []
        for v in value:
            if isinstance(v, dict):
                v = v.get("complaint") or v.get("diagnosis") or v.get("name")
            if v:
                out.append(str(v).strip())
        return out
    return []


def _apply_multiselect(doc, field, values):
    """Populate a Table MultiSelect, creating the linked master row if needed.

    The master doctypes ("Complaint", "Diagnosis") have a single mandatory field
    whose name matches the doctype in lowercase; creating rows on demand keeps
    mobile clients from having to pre-register clinical vocabulary.
    """
    child_dt, fieldname, master_dt, master_field = MULTISELECT_FIELDS[field]
    doc.set(field, [])
    for label in values:
        if not frappe.db.exists(master_dt, label):
            master = frappe.new_doc(master_dt)
            master.set(master_field, label)
            master.insert(ignore_permissions=True)
        doc.append(field, {fieldname: label})


def _read_multiselect(doc, field):
    _child_dt, fieldname, _master_dt, _master_field = MULTISELECT_FIELDS[field]
    return [r.get(fieldname) for r in (doc.get(field) or []) if r.get(fieldname)]


def _may_see_clinical(patient):
    """Who may read diagnoses/notes for this patient."""
    roles = set(frappe.get_roles())
    if roles & {"Administrator", "System Manager", "Healthcare Administrator", "Physician"}:
        return True
    # The patient themselves may read their own record.
    return current_patient() == patient


@frappe.whitelist()
@clinic_api()
def list_encounters(patient=None, practitioner=None, limit=50, start=0):
    filters = {}
    if not is_staff():
        mine = current_patient()
        if not mine:
            raise ApiError(Code.FORBIDDEN, _("No patient record linked to this user."))
        filters["patient"] = mine
    else:
        if patient:
            assert_patient_access(patient)
            filters["patient"] = patient
        if practitioner:
            filters["practitioner"] = practitioner

    limit = min(as_int(limit, 50), 200)
    rows = frappe.get_list(
        "Patient Encounter",
        filters=filters,
        fields=ENCOUNTER_SUMMARY,
        limit_page_length=limit,
        limit_start=as_int(start, 0),
        order_by="encounter_date desc",
    )
    return {"items": rows, "total": frappe.db.count("Patient Encounter", filters)}


@frappe.whitelist()
@clinic_api()
def get_encounter(encounter):
    if not frappe.db.exists("Patient Encounter", encounter):
        raise ApiError(Code.NOT_FOUND, _("Encounter not found."))

    doc = frappe.get_doc("Patient Encounter", encounter)
    if not is_staff():
        assert_patient_access(doc.patient)

    data = {f: doc.get(f) for f in ENCOUNTER_SUMMARY}

    if _may_see_clinical(doc.patient):
        data["symptoms"] = _read_multiselect(doc, "symptoms")
        data["diagnosis"] = _read_multiselect(doc, "diagnosis")
        data["encounter_comment"] = doc.get("encounter_comment")
        data["drug_prescription"] = [
            {"drug_code": d.get("drug_code"), "dosage": d.get("dosage"),
             "period": d.get("period"), "comment": d.get("comment")}
            for d in (doc.get("drug_prescription") or [])
        ]
        data["clinical_access"] = True
    else:
        # Reception: scheduling/billing context only, no clinical content.
        data["clinical_access"] = False

    return data


@frappe.whitelist()
@clinic_api(roles=CLINICAL_ROLES)
def create_encounter(payload=None):
    """Only clinicians create encounters."""
    raw = parse_payload(payload)
    data = pick(raw, [
        "patient", "practitioner", "encounter_date", "encounter_time",
        "appointment", "encounter_comment", "company", "appointment_type",
    ])
    # Child tables are applied after insert-time doc construction, not passed inline.
    symptoms = _as_list(raw.get("symptoms"))
    diagnosis = _as_list(raw.get("diagnosis"))

    if not data.get("patient"):
        raise ApiError(Code.VALIDATION, _("patient is required."))

    # A practitioner creates encounters as themselves unless an admin overrides.
    mine = current_practitioner()
    if mine and not set(frappe.get_roles()) & {
        "Administrator", "System Manager", "Healthcare Administrator"
    }:
        data["practitioner"] = mine
    if not data.get("practitioner"):
        raise ApiError(Code.VALIDATION, _("practitioner is required."))

    data.setdefault("encounter_date", nowdate())
    data.setdefault("company", frappe.db.get_single_value("Global Defaults", "default_company"))

    # Patient Encounter requires appointment_type. When the encounter is linked to
    # an appointment, inherit it from there; otherwise fall back to any configured
    # type so clinicians are not forced to supply an ERPNext internal.
    if not data.get("appointment_type"):
        appt = data.get("appointment")
        data["appointment_type"] = (
            frappe.db.get_value("Patient Appointment", appt, "appointment_type")
            if appt else None
        ) or frappe.db.get_value("Appointment Type", {}, "name")

    doc = frappe.get_doc({"doctype": "Patient Encounter", **data})
    if symptoms:
        _apply_multiselect(doc, "symptoms", symptoms)
    if diagnosis:
        _apply_multiselect(doc, "diagnosis", diagnosis)
    doc.insert()
    frappe.db.commit()
    return {f: doc.get(f) for f in ENCOUNTER_SUMMARY}


@frappe.whitelist()
@clinic_api(roles=CLINICAL_ROLES)
def update_encounter(encounter, payload=None):
    """Amend a draft encounter. Submitted encounters are immutable."""
    if not frappe.db.exists("Patient Encounter", encounter):
        raise ApiError(Code.NOT_FOUND, _("Encounter not found."))

    doc = frappe.get_doc("Patient Encounter", encounter)
    if doc.docstatus == 1:
        raise ApiError(Code.CONFLICT, _("Submitted encounter cannot be modified."))

    # A practitioner may only edit their own encounters.
    mine = current_practitioner()
    if mine and doc.practitioner != mine and not set(frappe.get_roles()) & {
        "Administrator", "System Manager", "Healthcare Administrator"
    }:
        raise ApiError(Code.FORBIDDEN, _("You may only edit your own encounters."))

    raw = parse_payload(payload)
    data = pick(raw, ["encounter_comment"])
    has_symptoms = "symptoms" in raw
    has_diagnosis = "diagnosis" in raw

    if not data and not has_symptoms and not has_diagnosis:
        raise ApiError(Code.VALIDATION, _("No permitted fields to update."))

    doc.update(data)
    if has_symptoms:
        _apply_multiselect(doc, "symptoms", _as_list(raw.get("symptoms")))
    if has_diagnosis:
        _apply_multiselect(doc, "diagnosis", _as_list(raw.get("diagnosis")))
    doc.save()
    frappe.db.commit()
    return {f: doc.get(f) for f in ENCOUNTER_SUMMARY}


@frappe.whitelist()
@clinic_api(roles=CLINICAL_ROLES)
def submit_encounter(encounter):
    if not frappe.db.exists("Patient Encounter", encounter):
        raise ApiError(Code.NOT_FOUND, _("Encounter not found."))
    doc = frappe.get_doc("Patient Encounter", encounter)
    if doc.docstatus == 1:
        return {f: doc.get(f) for f in ENCOUNTER_SUMMARY}
    doc.submit()
    frappe.db.commit()
    return {f: doc.get(f) for f in ENCOUNTER_SUMMARY}
