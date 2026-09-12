"""
Consistent API envelope + authorization guards for every clinic_core endpoint.

Envelope
--------
Success:  {"success": true,  "data": {...}, "message": null}
Error:    {"success": false, "data": null, "error": {"code": "...", "message": "..."}}

Security posture
----------------
Marley exposes 160 @frappe.whitelist() endpoints and uses `frappe.only_for` ZERO times
(see docs/02_API_SECURITY_AUDIT.md). We therefore never rely on Marley's own checks.
Every clinic_core endpoint declares its allowed roles explicitly via @clinic_api and,
where a record is addressed by name, ownership is re-verified server-side.

Stack traces, SQL and internal messages are never returned to the client; they are
logged server-side and replaced with a generic message.
"""

import functools
import json

import frappe
from frappe import _


# --------------------------------------------------------------------------- #
# Error codes
# --------------------------------------------------------------------------- #
class Code:
    UNAUTHENTICATED = "UNAUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION = "VALIDATION_ERROR"
    CONFLICT = "CONFLICT"
    RATE_LIMITED = "RATE_LIMITED"
    INTERNAL = "INTERNAL_ERROR"


HTTP_FOR_CODE = {
    Code.UNAUTHENTICATED: 401,
    Code.FORBIDDEN: 403,
    Code.NOT_FOUND: 404,
    Code.VALIDATION: 400,
    Code.CONFLICT: 409,
    Code.RATE_LIMITED: 429,
    Code.INTERNAL: 500,
}


class ApiError(Exception):
    """Raised inside endpoints to produce a controlled error envelope."""

    def __init__(self, code, message, http_status=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status or HTTP_FOR_CODE.get(code, 400)


# --------------------------------------------------------------------------- #
# Envelope helpers
# --------------------------------------------------------------------------- #
def ok(data=None, message=None):
    return {"success": True, "data": data, "message": message}


def err(code, message, http_status=None):
    frappe.local.response["http_status_code"] = http_status or HTTP_FOR_CODE.get(code, 400)
    return {"success": False, "data": None,
            "error": {"code": code, "message": message}}


# --------------------------------------------------------------------------- #
# Guards
# --------------------------------------------------------------------------- #
def require_login():
    """401 for guests. Frappe treats unauthenticated callers as user 'Guest'."""
    if frappe.session.user == "Guest" or not frappe.session.user:
        raise ApiError(Code.UNAUTHENTICATED, _("Authentication required."))


def require_roles(*roles):
    """403 unless the caller holds at least one of `roles`.

    Administrator and System Manager always pass. This is the check Marley itself
    never performs -- see the audit doc.
    """
    require_login()
    if frappe.session.user == "Administrator":
        return
    held = set(frappe.get_roles())
    if held & {"Administrator", "System Manager"}:
        return
    if not held & set(roles):
        raise ApiError(
            Code.FORBIDDEN,
            _("You are not allowed to perform this action."),
        )


def current_patient():
    """The Patient record owned by the caller, or None."""
    return frappe.db.get_value(
        "Patient", {"user_id": frappe.session.user, "status": "Active"}, "name"
    )


def current_practitioner():
    """The Healthcare Practitioner record owned by the caller, or None."""
    return frappe.db.get_value(
        "Healthcare Practitioner", {"user_id": frappe.session.user}, "name"
    )


# Roles that legitimately work across patients. Accounts roles are included
# because billing staff must reach any patient's invoices to do their job --
# clinical *content* is gated separately (see api/v1/encounters.py).
STAFF_ROLES = {
    "Administrator", "System Manager", "Healthcare Administrator",
    "Physician", "Nursing User", "Accounts Manager", "Accounts User",
}


def is_staff():
    """Staff = anyone who legitimately sees across patients."""
    return bool(set(frappe.get_roles()) & STAFF_ROLES)


def assert_patient_access(patient):
    """Horizontal-access guard.

    A Patient-role caller may only address their OWN patient record. Staff may
    address any. This is the check whose absence causes IDOR in Marley.
    """
    require_login()
    if not patient:
        raise ApiError(Code.VALIDATION, _("Patient is required."))
    if not frappe.db.exists("Patient", patient):
        # Do not distinguish "missing" from "forbidden" for non-staff: that itself
        # leaks which patient ids exist.
        if is_staff():
            raise ApiError(Code.NOT_FOUND, _("Patient not found."))
        raise ApiError(Code.FORBIDDEN, _("You are not allowed to access this patient."))
    if is_staff():
        return
    if current_patient() != patient:
        raise ApiError(Code.FORBIDDEN, _("You are not allowed to access this patient."))


def assert_doc_permission(doctype, name, ptype="read"):
    """Defer to Frappe's own document permission engine, then raise our envelope."""
    if not frappe.has_permission(doctype, ptype, doc=name):
        raise ApiError(Code.FORBIDDEN, _("You are not allowed to access this record."))


# --------------------------------------------------------------------------- #
# Decorator
# --------------------------------------------------------------------------- #
def clinic_api(roles=None, allow_guest=False):
    """Wrap an endpoint with auth, role checks and the response envelope.

    Usage:
        @frappe.whitelist()
        @clinic_api(roles=["Physician", "Healthcare Administrator"])
        def my_endpoint(...): ...

    `roles=None` means "any authenticated user" (still NOT guests unless
    allow_guest=True).
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                if not allow_guest:
                    require_login()
                if roles:
                    require_roles(*roles)
                result = fn(*args, **kwargs)
                # Endpoints may return a full envelope themselves.
                if isinstance(result, dict) and "success" in result:
                    return result
                return ok(result)

            except ApiError as e:
                return err(e.code, e.message, e.http_status)

            except frappe.PermissionError:
                return err(Code.FORBIDDEN,
                           _("You are not allowed to perform this action."))

            except frappe.DoesNotExistError:
                return err(Code.NOT_FOUND, _("Record not found."))

            except frappe.ValidationError as e:
                # Frappe validation messages are user-facing by design and safe
                # to surface -- but strip any HTML Frappe embedded in them.
                from frappe.utils import strip_html
                msg = strip_html(str(e)) or _("Invalid request.")
                return err(Code.VALIDATION, msg)

            except Exception:
                # Never leak stack traces / SQL / secrets to the client.
                frappe.log_error(
                    title=f"clinic_core API error: {fn.__module__}.{fn.__name__}",
                    message=frappe.get_traceback(with_context=True),
                )
                return err(Code.INTERNAL, _("An unexpected error occurred."))

        return wrapper
    return decorator


# --------------------------------------------------------------------------- #
# Input helpers
# --------------------------------------------------------------------------- #
def parse_payload(payload):
    """Accept a dict or a JSON string (React Native / fetch send strings)."""
    if payload is None:
        return {}
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            parsed = json.loads(payload)
        except (ValueError, TypeError):
            raise ApiError(Code.VALIDATION, _("Invalid JSON payload."))
        if not isinstance(parsed, dict):
            raise ApiError(Code.VALIDATION, _("Payload must be an object."))
        return parsed
    raise ApiError(Code.VALIDATION, _("Invalid payload."))


def pick(source, allowed):
    """Whitelist inbound fields -- never pass raw client dicts into frappe.get_doc.

    This is what prevents a client from setting fields it should not control
    (the same class of bug as Marley's unsanitized `doctype` parameter).
    """
    src = source or {}
    return {k: src[k] for k in allowed if k in src and src[k] is not None}


def as_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
