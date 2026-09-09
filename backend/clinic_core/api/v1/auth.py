"""
clinic_core.api.v1.auth -- authentication surface for mobile/web clients.

Endpoints:
    POST /api/method/clinic_core.api.v1.auth.login
    POST /api/method/clinic_core.api.v1.auth.logout
    GET  /api/method/clinic_core.api.v1.auth.me

See docs/03_AUTH_ARCHITECTURE.md for why token auth is preferred on React Native
and session auth on Next.js.
"""

import frappe
from frappe import _

from clinic_core.api.response import (
    ApiError, Code, clinic_api, ok, current_patient, current_practitioner,
)


def _profile():
    """Identity + role context the client needs to drive its UI."""
    user = frappe.session.user
    roles = sorted(set(frappe.get_roles()))
    patient = current_patient()
    practitioner = current_practitioner()

    if practitioner:
        persona = "practitioner"
    elif patient:
        persona = "patient"
    elif set(roles) & {"Administrator", "System Manager", "Healthcare Administrator"}:
        persona = "admin"
    elif "Nursing User" in roles:
        persona = "reception"
    else:
        persona = "unknown"

    full_name = frappe.db.get_value("User", user, "full_name")
    return {
        "user": user,
        "full_name": full_name,
        "roles": roles,
        "persona": persona,
        "patient": patient,
        "practitioner": practitioner,
    }


@frappe.whitelist(allow_guest=True)
@clinic_api(allow_guest=True)
def login(usr=None, pwd=None):
    """Session login. Sets the sid cookie on success.

    Deliberately generic on failure: never reveal whether the user exists.
    """
    if not usr or not pwd:
        raise ApiError(Code.VALIDATION, _("Username and password are required."))

    from frappe.auth import LoginManager

    try:
        lm = LoginManager()
        lm.authenticate(user=usr, pwd=pwd)
        lm.post_login()
    except frappe.SecurityException as e:
        # Rate limiting / IP restrictions -- surface as 403 without detail.
        raise ApiError(Code.FORBIDDEN, _("Login blocked."))
    except Exception:
        raise ApiError(Code.UNAUTHENTICATED, _("Invalid credentials."))

    if frappe.session.user == "Guest":
        raise ApiError(Code.UNAUTHENTICATED, _("Invalid credentials."))

    frappe.local.login_manager = lm
    data = _profile()
    data["sid"] = frappe.session.sid
    return ok(data, message=_("Logged in."))


@frappe.whitelist()
@clinic_api()
def logout():
    from frappe.auth import LoginManager
    lm = LoginManager()
    lm.logout()
    frappe.db.commit()
    return ok({"logged_out": True}, message=_("Logged out."))


@frappe.whitelist()
@clinic_api()
def me():
    """Current user, roles, and linked patient/practitioner records."""
    return _profile()


@frappe.whitelist()
@clinic_api()
def session_valid():
    """Cheap probe for clients to test whether their token/cookie still works."""
    return {"valid": True, "user": frappe.session.user}
