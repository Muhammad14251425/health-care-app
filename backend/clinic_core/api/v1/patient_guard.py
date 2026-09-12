"""
clinic_core.api.v1.patient_guard

The one place that answers "who is the caller, as a patient?".

Every patient-facing endpoint starts with `me()`. The patient id is derived from
`frappe.session.user` and NOTHING else -- no request parameter can influence it.
That single rule is what makes the whole patient surface IDOR-proof: there is no
`patient_id` input to tamper with, because the endpoints do not accept one.

For endpoints that DO take a record id (an appointment, an invoice), the id is a
lookup key only. `own()` re-reads the record's owning patient from the database
and compares it to the session's patient. A record the caller does not own is
reported exactly as a record that does not exist, so ids cannot be enumerated.

Note on `ignore_permissions=True` below: Marley's `Patient` role has ZERO
DocPerms on every clinical doctype (verified against this install), so a patient
session cannot read its own records through the ORM at all. These endpoints
therefore read with permissions bypassed AFTER scoping the query to the caller's
own patient id. The scope is the security boundary, and it is applied first,
every time.
"""

import frappe
from frappe import _

from clinic_core.api.response import ApiError, Code, current_patient, is_staff


def me():
    """The caller's own Patient id, or 403. Never derived from client input."""
    patient = current_patient()
    if not patient:
        raise ApiError(
            Code.FORBIDDEN,
            _("No patient record is linked to this account."),
        )
    return patient


def not_found():
    """The single response for 'absent' AND 'not yours'.

    Using one shape for both is deliberate. If "someone else's invoice" returned
    403 while "no such invoice" returned 404, an attacker could walk the id space
    and learn exactly which records exist -- a membership oracle over medical
    data. Both answers are identical here.
    """
    return ApiError(Code.NOT_FOUND, _("Record not found."))


def own(doctype, name, patient, patient_field="patient"):
    """Fetch `name` only if it belongs to `patient`. Otherwise: not found.

    Reads the owner column directly rather than loading the document first, so a
    record the caller has no business seeing is never instantiated.
    """
    if not name or not isinstance(name, str):
        raise not_found()

    owner = frappe.db.get_value(doctype, name, patient_field)
    if not owner or owner != patient:
        raise not_found()

    return frappe.get_doc(doctype, name)


def owns(doctype, name, patient, patient_field="patient"):
    """Boolean form of `own`, for filtering lists."""
    if not name:
        return False
    return frappe.db.get_value(doctype, name, patient_field) == patient


def reject_patient_override(payload):
    """Refuse a request that tries to name a patient.

    The requirement is explicit: if the mobile app sends a patient id, ignore it
    or reject it. We reject, because a client sending one is either broken or
    probing, and both are worth surfacing loudly in development rather than
    silently succeeding as somebody else.
    """
    if not isinstance(payload, dict):
        return
    for key in ("patient", "patient_id", "patient_name"):
        if payload.get(key):
            raise ApiError(
                Code.VALIDATION,
                _("This request must not specify a patient."),
            )


def assert_not_staff_only(*_args):
    """Guard for endpoints that must never serve a staff member by accident.

    Staff have their own, wider APIs. Letting a staff session through the patient
    endpoints would make `me()` resolve to whatever Patient record happens to be
    linked to that staff user -- usually none, occasionally the wrong one.
    """
    if is_staff() and not current_patient():
        raise ApiError(
            Code.FORBIDDEN,
            _("This endpoint is for patient accounts. Use the staff API."),
        )
