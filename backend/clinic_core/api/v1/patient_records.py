"""
clinic_core.api.v1.patient_records -- patient-safe clinical history.

    visits / visit / prescriptions / diagnostics / diagnostic / summary

The central rule of this module
-------------------------------
A `Patient Encounter` is a CLINICAL working document. It carries fields the
clinician writes for themselves and for colleagues -- `clinical_notes`,
`encounter_comment`, `physical_examination`, referral and insurance state. Those
are not the patient's summary of their visit, and some of them are actively
harmful to show without a clinician present.

So this module never serialises an encounter. It BUILDS a response from an
explicit allowlist (`PATIENT_SAFE_ENCOUNTER_FIELDS`), field by field. The
restricted fields never enter the JSON, which means they never cross the wire.

Filtering in React Native instead would be theatre: the data would still be in
the response body, readable with any HTTP proxy. The requirement is explicit
about this and it is right.

Field split verified against this install's Patient Encounter meta:

  patient-safe   encounter_date, encounter_time, practitioner_name,
                 medical_department, symptoms, diagnosis, drug_prescription,
                 lab_test_prescription, appointment_type
  staff-only     clinical_notes, encounter_comment, physical_examination,
                 source, referring_practitioner, insurance_*, codification_table,
                 invoiced, inpatient_record, submit_orders_on_save

Draft encounters (docstatus 0) are excluded everywhere: a clinician's unfinished
note is not a record of anything yet.
"""

import frappe
from frappe import _

from clinic_core.api.response import ApiError, Code, clinic_api, as_int
from clinic_core.api.v1 import patient_guard as guard

SUBMITTED = 1

# Header fields safe to show for a visit.
PATIENT_SAFE_ENCOUNTER_FIELDS = [
    "name", "encounter_date", "encounter_time",
    "practitioner", "practitioner_name", "medical_department",
    "appointment", "appointment_type", "company",
]

# Narrative content. On this install `symptoms` and `diagnosis` are NOT text
# fields -- they are `Table MultiSelect` child tables whose rows Link to the
# `Complaint` and `Diagnosis` masters:
#
#   Patient Encounter Symptom.complaint   -> Link: Complaint
#   Patient Encounter Diagnosis.diagnosis -> Link: Diagnosis
#
# Reading them as scalars silently yields nothing, so they are collected row by
# row below. Marley pairs each with an `*_in_print` flag -- its own signal for
# "this is meant to reach the patient" -- which we honour rather than inventing
# a policy. Note the shipped defaults differ (symptoms_in_print=0,
# diagnosis_in_print=1), which is precisely why the flag is consulted per field
# instead of assumed.
NARRATIVE_TABLES = {
    "symptoms": ("symptoms_in_print", "complaint"),
    "diagnosis": ("diagnosis_in_print", "diagnosis"),
}

# Explicitly never returned. Listed (rather than merely omitted) so the intent
# survives someone later "helpfully" widening the allowlist.
NEVER_RETURN = {
    "clinical_notes", "encounter_comment", "physical_examination",
    "source", "referring_practitioner", "insurance_policy", "insurance_payor",
    "insurance_coverage", "coverage_status", "codification_table",
    "invoiced", "inpatient_record", "inpatient_status", "submit_orders_on_save",
    "google_meet_link", "order_history_html",
}


def _clean(value):
    """Strip HTML from a Text Editor field so the app renders plain text."""
    if not value:
        return None
    from frappe.utils import strip_html
    text = strip_html(str(value)).strip()
    return text or None


def _narrative(doc):
    """Patient-visible symptoms and diagnoses, honouring Marley's in-print flags.

    Returns lists of strings (never the child documents), so no child-row
    metadata -- ids, parent references, internal columns -- reaches the client.
    """
    out = {}
    for field, (flag, value_field) in NARRATIVE_TABLES.items():
        rows = doc.get(field) or []
        if not rows:
            out[field] = []
            continue

        # When the flag exists and is explicitly off, the clinician has said this
        # is not for the patient-facing copy. Respect that.
        if doc.meta.get_field(flag) is not None and not doc.get(flag):
            out[field] = []
            continue

        values = []
        for row in rows:
            # Table MultiSelect rows carry the Link in `value_field`; fall back
            # to the row's own name only if the link column is absent.
            value = row.get(value_field) if hasattr(row, "get") else None
            if value:
                values.append(str(value))
        out[field] = values

    return out


def _prescription_rows(doc):
    """Medications from the encounter's Drug Prescription child table."""
    rows = []
    for row in (doc.get("drug_prescription") or []):
        rows.append({
            "drug": row.get("drug_code"),
            "drug_name": row.get("drug_name"),
            "dosage": row.get("dosage"),
            "period": row.get("period"),
            "dosage_form": row.get("dosage_form"),
            "comment": _clean(row.get("comment")),
            "interval": row.get("interval"),
            "interval_uom": row.get("interval_uom"),
        })
    return rows


def _lab_request_rows(doc):
    """Tests the clinician ordered at this visit (the order, not the result)."""
    rows = []
    for row in (doc.get("lab_test_prescription") or []):
        rows.append({
            "template": row.get("lab_test_code"),
            "test_name": row.get("lab_test_name"),
            "comment": _clean(row.get("lab_test_comment")),
        })
    return rows


# --------------------------------------------------------------------------- #
# Visits
# --------------------------------------------------------------------------- #
@frappe.whitelist()
@clinic_api()
def visits(limit=50, start=0):
    """The caller's visit history.

    Built from completed APPOINTMENTS, with the encounter attached where one
    exists. Listing encounters alone would hide visits the doctor never wrote up,
    which to the patient look like visits that never happened.
    """
    patient = guard.me()
    limit = min(as_int(limit, 50), 200)

    appointments = frappe.get_all(
        "Patient Appointment",
        filters={"patient": patient, "status": ["in", ("Closed", "No Show")]},
        fields=["name", "appointment_date", "appointment_time", "status",
                "practitioner", "practitioner_name", "department",
                "appointment_type"],
        order_by="appointment_date desc, appointment_time desc",
        limit_page_length=limit,
        limit_start=as_int(start, 0),
        ignore_permissions=True,
    )

    # Which of those visits have a submitted encounter behind them.
    by_appointment = {}
    if appointments:
        encounters = frappe.get_all(
            "Patient Encounter",
            filters={
                "patient": patient,
                "docstatus": SUBMITTED,
                "appointment": ["in", [a["name"] for a in appointments]],
            },
            fields=["name", "appointment"],
            ignore_permissions=True,
        )
        by_appointment = {e["appointment"]: e["name"] for e in encounters}

    items = []
    for appt in appointments:
        items.append({
            "id": appt["name"],
            "date": appt["appointment_date"],
            "time": appt["appointment_time"],
            "status": appt["status"],
            "practitioner": appt["practitioner"],
            "practitioner_name": appt["practitioner_name"],
            "department": appt["department"],
            "appointment_type": appt["appointment_type"],
            "encounter": by_appointment.get(appt["name"]),
            "has_record": bool(by_appointment.get(appt["name"])),
        })

    # Encounters with no appointment behind them (walk-ins recorded directly).
    orphans = frappe.get_all(
        "Patient Encounter",
        filters={"patient": patient, "docstatus": SUBMITTED,
                 "appointment": ["in", ("", None)]},
        fields=["name", "encounter_date", "encounter_time", "practitioner",
                "practitioner_name", "medical_department"],
        order_by="encounter_date desc",
        limit_page_length=limit,
        ignore_permissions=True,
    )
    for enc in orphans:
        items.append({
            "id": enc["name"],
            "date": enc["encounter_date"],
            "time": enc["encounter_time"],
            "status": "Closed",
            "practitioner": enc["practitioner"],
            "practitioner_name": enc["practitioner_name"],
            "department": enc["medical_department"],
            "appointment_type": None,
            "encounter": enc["name"],
            "has_record": True,
        })

    items.sort(key=lambda i: (str(i["date"] or ""), str(i["time"] or "")), reverse=True)

    total = frappe.db.count("Patient Appointment", {
        "patient": patient, "status": ["in", ("Closed", "No Show")]
    })
    return {"items": items[:limit], "total": total}


@frappe.whitelist()
@clinic_api()
def visit(encounter=None):
    """One visit's patient-safe record.

    `guard.own` proves ownership before the document is loaded; the projection
    below is what actually leaves the server.
    """
    patient = guard.me()
    doc = guard.own("Patient Encounter", encounter, patient)

    if doc.docstatus != SUBMITTED:
        # An unsubmitted encounter is a draft note, not a record.
        raise guard.not_found()

    data = {f: doc.get(f) for f in PATIENT_SAFE_ENCOUNTER_FIELDS}
    data.update(_narrative(doc))
    data["prescriptions"] = _prescription_rows(doc)
    data["lab_requests"] = _lab_request_rows(doc)

    # Defensive assertion: if someone later adds a restricted field to the
    # allowlist, fail loudly in development instead of leaking it quietly.
    leaked = NEVER_RETURN & set(data)
    if leaked:
        frappe.log_error(
            title="clinic_core: patient-safe projection leaked a restricted field",
            message=f"encounter={doc.name} fields={sorted(leaked)}",
        )
        for field in leaked:
            data.pop(field, None)

    return data


# --------------------------------------------------------------------------- #
# Prescriptions
# --------------------------------------------------------------------------- #
@frappe.whitelist()
@clinic_api()
def prescriptions(limit=50):
    """Every medication prescribed to the caller, newest first.

    Read from the encounters' child rows rather than `Medication Request`,
    because Marley only creates those when the clinic runs the orders workflow --
    on a clinic that does not, the child table is the only record there is.
    """
    patient = guard.me()
    limit = min(as_int(limit, 50), 200)

    encounters = frappe.get_all(
        "Patient Encounter",
        filters={"patient": patient, "docstatus": SUBMITTED},
        fields=["name", "encounter_date", "practitioner", "practitioner_name"],
        order_by="encounter_date desc",
        limit_page_length=limit,
        ignore_permissions=True,
    )
    if not encounters:
        return {"items": [], "total": 0}

    by_encounter = {e["name"]: e for e in encounters}

    rows = frappe.get_all(
        "Drug Prescription",
        filters={"parent": ["in", list(by_encounter)], "parenttype": "Patient Encounter"},
        fields=["parent", "drug_code", "drug_name", "dosage", "period",
                "dosage_form", "comment", "interval", "interval_uom"],
        ignore_permissions=True,
    )

    items = []
    for row in rows:
        enc = by_encounter.get(row["parent"]) or {}
        items.append({
            "id": f"{row['parent']}::{row['drug_code'] or row['drug_name']}",
            "encounter": row["parent"],
            "drug": row["drug_code"],
            "drug_name": row["drug_name"],
            "dosage": row["dosage"],
            "period": row["period"],
            "dosage_form": row["dosage_form"],
            "comment": _clean(row["comment"]),
            "date": enc.get("encounter_date"),
            "practitioner_name": enc.get("practitioner_name"),
        })

    items.sort(key=lambda i: str(i["date"] or ""), reverse=True)
    return {"items": items, "total": len(items)}


# --------------------------------------------------------------------------- #
# Diagnostics -- optional module
# --------------------------------------------------------------------------- #
def _lab_enabled():
    """Whether this clinic actually runs the lab module.

    A clinic with no lab is not a broken deployment, so the endpoint reports
    `enabled: false` and the app hides the section rather than showing an error.
    """
    return bool(frappe.db.exists("DocType", "Lab Test"))


@frappe.whitelist()
@clinic_api()
def diagnostics(limit=50):
    """Completed lab tests for the caller.

    Only APPROVED/COMPLETED results are returned. A result mid-workflow has not
    been signed off by the lab, and showing a patient an unvalidated number is
    exactly the kind of harm this filtering exists to prevent.
    """
    patient = guard.me()

    if not _lab_enabled():
        return {"enabled": False, "items": [], "total": 0}

    rows = frappe.get_all(
        "Lab Test",
        filters={
            "patient": patient,
            "docstatus": SUBMITTED,
            "status": ["in", ("Completed", "Approved")],
        },
        fields=["name", "lab_test_name", "result_date", "status",
                "practitioner", "template", "lab_test_group"],
        order_by="result_date desc",
        limit_page_length=min(as_int(limit, 50), 200),
        ignore_permissions=True,
    )

    return {
        "enabled": True,
        "items": [{
            "id": r["name"],
            "test_name": r["lab_test_name"] or r["template"],
            "date": r["result_date"],
            "status": r["status"],
            "group": r["lab_test_group"],
        } for r in rows],
        "total": len(rows),
    }


@frappe.whitelist()
@clinic_api()
def diagnostic(lab_test=None):
    """One lab result, if it belongs to the caller and is signed off."""
    patient = guard.me()

    if not _lab_enabled():
        raise guard.not_found()

    doc = guard.own("Lab Test", lab_test, patient)
    if doc.docstatus != SUBMITTED or doc.status not in ("Completed", "Approved"):
        raise guard.not_found()

    normals = []
    for row in (doc.get("normal_test_items") or []):
        normals.append({
            "test": row.get("lab_test_name"),
            "result": row.get("result_value"),
            "uom": row.get("lab_test_uom"),
            "reference": row.get("normal_range"),
        })

    return {
        "id": doc.name,
        "test_name": doc.get("lab_test_name") or doc.get("template"),
        "date": doc.get("result_date"),
        "status": doc.get("status"),
        "practitioner_name": doc.get("practitioner_name"),
        "results": normals,
        # The lab's own patient-facing comment, not internal workflow notes.
        "comment": _clean(doc.get("lab_test_comment")),
    }


@frappe.whitelist()
@clinic_api()
def summary():
    """Counts for the Records tab, so it can show what is worth opening."""
    patient = guard.me()

    visit_count = frappe.db.count("Patient Appointment", {
        "patient": patient, "status": ["in", ("Closed", "No Show")]
    })
    record_count = frappe.db.count("Patient Encounter", {
        "patient": patient, "docstatus": SUBMITTED
    })

    prescription_count = 0
    if record_count:
        encounters = frappe.get_all(
            "Patient Encounter",
            filters={"patient": patient, "docstatus": SUBMITTED},
            pluck="name", ignore_permissions=True,
        )
        prescription_count = frappe.db.count("Drug Prescription", {
            "parent": ["in", encounters], "parenttype": "Patient Encounter"
        })

    diagnostics_count = 0
    if _lab_enabled():
        diagnostics_count = frappe.db.count("Lab Test", {
            "patient": patient, "docstatus": SUBMITTED,
            "status": ["in", ("Completed", "Approved")],
        })

    return {
        "visits": visit_count,
        "records": record_count,
        "prescriptions": prescription_count,
        "diagnostics": diagnostics_count,
        "diagnostics_enabled": _lab_enabled(),
    }
