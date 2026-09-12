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
# `owner` is the audit trail: the encounter is ATTRIBUTED to `practitioner`, but a
# note may legitimately have been typed by an admin on that doctor's behalf, and a
# clinical record must not hide who entered it. Exposed to the client as
# `entered_by` / `entered_by_name` (see _with_audit).
ENCOUNTER_SUMMARY = [
    "name", "patient", "patient_name", "practitioner", "practitioner_name",
    "encounter_date", "encounter_time", "docstatus", "company", "owner",
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


def _with_audit(row):
    """Add a human-readable "entered by" to an encounter payload.

    Keeps the distinction explicit in the UI: `practitioner` is the clinician the
    note belongs to, `entered_by` is the account that typed it. They differ when
    an admin records a note on a doctor's behalf, and that difference is exactly
    what an audit needs to see.
    """
    if not row:
        return row
    owner = row.pop("owner", None)
    row["entered_by"] = owner
    row["entered_by_name"] = (
        frappe.db.get_value("User", owner, "full_name") if owner else None
    )
    # True when someone other than the attributed clinician typed it.
    practitioner_user = (
        frappe.db.get_value("Healthcare Practitioner", row.get("practitioner"), "user_id")
        if row.get("practitioner") else None
    )
    row["entered_on_behalf"] = bool(owner and practitioner_user and owner != practitioner_user)
    return row


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


# Roles that may read clinical content across ALL practitioners' patients.
# A pure Physician is deliberately NOT here: they are scoped to their own
# patients by _treats(), below.
#
# "Healthcare Administrator" is deliberately ABSENT. Marley grants doctype read
# on Patient Encounter to Physician ONLY, so a Healthcare Administrator already
# receives 403 from list_encounters. Previously get_encounter disagreed --
# frappe.get_doc() performs no permission check, so admin could read any single
# note in full while being unable to enumerate them. The stricter reading wins:
# it matches the doctype, matches what the mobile app offers (canViewClinicalNotes
# is Physician-only), and keeps clinical content with clinicians.
CLINICAL_SUPERVISOR_ROLES = {
    "Administrator", "System Manager",
}

# Roles that may record a note ATTRIBUTED TO ANOTHER CLINICIAN -- an admin typing
# up a consultation on the treating doctor's behalf.
#
# Deliberately WIDER than CLINICAL_SUPERVISOR_ROLES, which governs *reading*
# everyone's clinical content. The two answer different questions:
#   - supervisor: "may I read every doctor's notes?"      (kept narrow)
#   - on-behalf:  "may I file this note under Dr X?"      (admin front office)
# A Healthcare Administrator belongs in the second and not the first: they run
# the clinic's records without being granted a clinical reading room.
#
# The note still names the real practitioner and `owner` still records who typed
# it, so attribution never becomes a fiction.
ON_BEHALF_ROLES = {
    "Administrator", "System Manager", "Healthcare Administrator",
}


def _treats(patient, practitioner=None):
    """True when the calling practitioner has a care relationship with `patient`.

    A care relationship means the practitioner authored an encounter for that
    patient, or has an appointment with them. Without this, ANY Physician could
    read ANY other Physician's clinical notes -- including for patients they
    have never treated.

    `practitioner` is the encounter's own practitioner, passed when known so the
    common "it is my own note" case costs no query.
    """
    mine = current_practitioner()
    if not mine:
        return False
    if practitioner and practitioner == mine:
        return True
    if not patient:
        return False
    return bool(
        frappe.db.exists("Patient Encounter", {"patient": patient, "practitioner": mine})
        or frappe.db.exists("Patient Appointment", {"patient": patient, "practitioner": mine})
    )


def _may_see_clinical(patient, practitioner=None):
    """Who may read diagnoses/notes for this patient.

    Admin/System Manager supervise across the clinic. A Physician sees only the
    patients they actually treat. The patient themselves may read their own
    record. Reception (Nursing User) is excluded entirely.
    """
    if set(frappe.get_roles()) & CLINICAL_SUPERVISOR_ROLES:
        return True
    if _treats(patient, practitioner):
        return True
    # The patient themselves may read their own record.
    return current_patient() == patient


def _practitioner_scope():
    """The practitioner a caller is confined to, or None when unrestricted.

    Mirrors appointments._scope_filters(): a pure Physician defaults to their
    own records; supervisory roles see everything.
    """
    if set(frappe.get_roles()) & CLINICAL_SUPERVISOR_ROLES:
        return None
    return current_practitioner()


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

        # A pure Physician is confined to their own encounters; asking for
        # someone else's is refused rather than silently widened.
        scope = _practitioner_scope()
        if scope:
            if practitioner and practitioner != scope:
                raise ApiError(
                    Code.FORBIDDEN,
                    _("You may only view your own clinical records."),
                )
            filters["practitioner"] = scope
        elif not set(frappe.get_roles()) & CLINICAL_SUPERVISOR_ROLES:
            # Staff who are neither a supervisor nor a practitioner -- i.e.
            # reception (Nursing User) and billing-only accounts. They are NOT
            # clinicians, and the query below runs with ignore_permissions, so
            # this branch MUST refuse rather than fall through to an unfiltered
            # read of every clinical record in the clinic.
            raise ApiError(
                Code.FORBIDDEN, _("You are not allowed to perform this action.")
            )
        elif practitioner:
            filters["practitioner"] = practitioner

    limit = min(as_int(limit, 50), 200)

    # Authorisation for this list is decided ABOVE, explicitly: non-staff are
    # pinned to their own patient, a pure Physician is pinned to their own
    # practitioner, and everyone else here is a supervisor role. Marley grants
    # the Patient Encounter doctype read to Physician ONLY, so frappe.get_list()
    # would 403 a supervisor who is legitimately allowed to see this -- which is
    # exactly the list/get inconsistency this replaces. Only the summary fields
    # are returned; clinical content stays gated by _may_see_clinical().
    rows = frappe.get_all(
        "Patient Encounter",
        filters=filters,
        fields=ENCOUNTER_SUMMARY,
        limit_page_length=limit,
        limit_start=as_int(start, 0),
        order_by="encounter_date desc",
        ignore_permissions=True,
    )
    return {
        "items": [_with_audit(r) for r in rows],
        "total": frappe.db.count("Patient Encounter", filters),
    }


@frappe.whitelist()
@clinic_api()
def get_encounter(encounter):
    if not frappe.db.exists("Patient Encounter", encounter):
        raise ApiError(Code.NOT_FOUND, _("Encounter not found."))

    doc = frappe.get_doc("Patient Encounter", encounter)
    if not is_staff():
        assert_patient_access(doc.patient)

    # A pure Physician may only open encounters for patients they actually
    # treat. Reception keeps the redacted summary below (they need scheduling
    # context), so this refuses only cross-practitioner clinical snooping.
    scope = _practitioner_scope()
    if scope and not _treats(doc.patient, doc.practitioner):
        raise ApiError(
            Code.FORBIDDEN, _("You may only view your own clinical records.")
        )

    data = _with_audit({f: doc.get(f) for f in ENCOUNTER_SUMMARY})

    if _may_see_clinical(doc.patient, doc.practitioner):
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

    mine = current_practitioner()
    may_act_for_others = bool(set(frappe.get_roles()) & ON_BEHALF_ROLES)

    # A physician writes as themselves. Refuse an explicit mismatch rather than
    # silently rewriting it: quietly "correcting" a colleague's name to your own
    # would file the note under the wrong clinician without telling anyone.
    if mine and not may_act_for_others:
        if data.get("practitioner") and data["practitioner"] != mine:
            raise ApiError(
                Code.FORBIDDEN, _("You may only record notes under your own name.")
            )
        data["practitioner"] = mine

    # An admin has no practitioner record of their own, so the note must name the
    # doctor it belongs to. When the note is opened from an appointment we know
    # who that is -- inherit it rather than asking again, and so the note cannot
    # be filed against a different doctor than the one who saw the patient.
    if not data.get("practitioner") and data.get("appointment"):
        data["practitioner"] = frappe.db.get_value(
            "Patient Appointment", data["appointment"], "practitioner"
        )

    if not data.get("practitioner"):
        raise ApiError(
            Code.VALIDATION,
            _("Select the doctor this consultation note belongs to."),
        )

    # Whoever is named must actually be a practitioner, and an active one:
    # without this an admin could file a note against any Link value.
    if not frappe.db.exists(
        "Healthcare Practitioner", {"name": data["practitioner"], "status": "Active"}
    ):
        raise ApiError(Code.VALIDATION, _("That doctor is not available."))

    # The encounter is ATTRIBUTED to the practitioner, but `owner` records who
    # actually typed it. Frappe sets owner to the session user automatically, so
    # an admin-entered note reads: practitioner = Dr X, owner = the admin.
    # get_encounter surfaces both (see ENCOUNTER_FIELDS / entered_by).

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
    return _with_audit({f: doc.get(f) for f in ENCOUNTER_SUMMARY})


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
    return _with_audit({f: doc.get(f) for f in ENCOUNTER_SUMMARY})


@frappe.whitelist()
@clinic_api(roles=CLINICAL_ROLES)
def submit_encounter(encounter):
    if not frappe.db.exists("Patient Encounter", encounter):
        raise ApiError(Code.NOT_FOUND, _("Encounter not found."))
    doc = frappe.get_doc("Patient Encounter", encounter)

    # Same ownership rule as update_encounter: submitting finalises a clinical
    # record, so a practitioner may only sign off their own.
    mine = current_practitioner()
    if mine and doc.practitioner != mine and not set(frappe.get_roles()) & {
        "Administrator", "System Manager", "Healthcare Administrator"
    }:
        raise ApiError(Code.FORBIDDEN, _("You may only submit your own encounters."))

    if doc.docstatus == 1:
        return _with_audit({f: doc.get(f) for f in ENCOUNTER_SUMMARY})
    doc.submit()
    frappe.db.commit()
    return _with_audit({f: doc.get(f) for f in ENCOUNTER_SUMMARY})
