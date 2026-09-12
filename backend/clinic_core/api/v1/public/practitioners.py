"""
clinic_core.api.v1.public.practitioners

Guest-facing doctor list for step 2 of the booking flow.

Field exposure is the whole point of this module. A guest gets exactly what a
booking decision needs -- who the doctor is, their specialty, and what a
consultation costs. A guest never gets `user_id` (which would map a doctor to a
login account), email, phone, or any other staff contact detail.
"""

import frappe
from frappe import _

from clinic_core.api.response import ApiError, Code
from clinic_core.api.v1.public.guard import assert_choice, public_api

# Everything a booking UI legitimately needs, and nothing else.
PUBLIC_PRACTITIONER_FIELDS = [
    "name",
    "practitioner_name",
    "department",
    "designation",
    "op_consulting_charge",
]


@public_api("read")
def list_practitioners(department=None):
    """Bookable practitioners, optionally filtered to one department."""
    filters = {"status": "Active"}

    if department:
        # The client may only name a department the server recognises; it never
        # supplies a raw filter dict.
        filters["department"] = assert_choice(
            department, "Medical Department", "Department"
        )

    rows = frappe.get_all(
        "Healthcare Practitioner",
        filters=filters,
        fields=PUBLIC_PRACTITIONER_FIELDS,
        order_by="practitioner_name asc",
        limit_page_length=100,
        ignore_permissions=True,  # deliberately public: this is the "who can I see" list
    )

    items = [
        {
            "name": r["name"],
            "practitioner_name": r.get("practitioner_name"),
            "department": r.get("department"),
            "designation": r.get("designation"),
            "consultation_fee": r.get("op_consulting_charge"),
        }
        for r in rows
    ]
    return {"items": items, "total": len(items)}


@public_api("read")
def get_practitioner(practitioner):
    """One practitioner, same restricted field set as the list."""
    name = assert_choice(
        practitioner, "Healthcare Practitioner", "Practitioner", {"status": "Active"}
    )

    row = frappe.db.get_value(
        "Healthcare Practitioner", name, PUBLIC_PRACTITIONER_FIELDS, as_dict=True
    )
    if not row:
        raise ApiError(Code.VALIDATION, _("Please choose a valid practitioner."))

    return {
        "name": row["name"],
        "practitioner_name": row.get("practitioner_name"),
        "department": row.get("department"),
        "designation": row.get("designation"),
        "consultation_fee": row.get("op_consulting_charge"),
    }
