"""
clinic_core.api.v1.public.departments

Guest-facing department list for step 1 of the booking flow.

Only departments that actually have a bookable practitioner behind them are
returned: offering a guest a department with no doctors is a dead end, and it
would also disclose the clinic's full internal department taxonomy.
"""

import frappe

from clinic_core.api.v1.public.guard import public_api


@public_api("read")
def list_departments():
    """Departments a guest can currently book into.

    Returns only {name, label} -- no internal accounting or company fields.
    """
    # Frappe v16 rejects "distinct <field> as <alias>" in a fields list, so the
    # de-duplication happens here rather than in SQL.
    rows = frappe.get_all(
        "Healthcare Practitioner",
        filters={"status": "Active", "department": ["is", "set"]},
        fields=["department"],
        limit_page_length=0,
        ignore_permissions=True,  # guest browsing of a deliberately public set
    )
    names = sorted({r["department"] for r in rows if r.get("department")})
    return {"items": [{"name": n, "label": n} for n in names], "total": len(names)}
