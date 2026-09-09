"""clinic_core.api.v1.practitioners"""

import frappe
from frappe import _

from clinic_core.api.response import ApiError, Code, clinic_api, as_int

PRACTITIONER_FIELDS = [
    "name", "practitioner_name", "department", "designation",
    "op_consulting_charge", "status", "user_id",
]


@frappe.whitelist()
@clinic_api()
def list_practitioners(department=None, limit=50, start=0):
    """Any authenticated user may browse practitioners (needed to book)."""
    limit = min(as_int(limit, 50), 100)
    filters = {"status": "Active"}
    if department:
        filters["department"] = department

    rows = frappe.get_all(
        "Healthcare Practitioner",
        filters=filters,
        # user_id is intentionally omitted from the public list -- it is an
        # account identifier, not booking information.
        fields=[f for f in PRACTITIONER_FIELDS if f != "user_id"],
        limit_page_length=limit,
        limit_start=as_int(start, 0),
        order_by="practitioner_name asc",
    )
    return {"items": rows, "total": frappe.db.count("Healthcare Practitioner", filters)}


@frappe.whitelist()
@clinic_api()
def get_practitioner(practitioner):
    if not frappe.db.exists("Healthcare Practitioner", practitioner):
        raise ApiError(Code.NOT_FOUND, _("Practitioner not found."))

    doc = frappe.get_doc("Healthcare Practitioner", practitioner)
    data = {f: doc.get(f) for f in PRACTITIONER_FIELDS if f != "user_id"}
    data["schedules"] = [
        {"schedule": s.schedule, "service_unit": s.get("service_unit")}
        for s in (doc.get("practitioner_schedules") or [])
    ]
    return data


@frappe.whitelist()
@clinic_api()
def list_departments():
    rows = frappe.get_all("Medical Department", fields=["name"], order_by="name asc")
    return {"items": rows}


@frappe.whitelist()
@clinic_api()
def availability(practitioner):
    """The practitioner's configured weekly working pattern."""
    if not frappe.db.exists("Healthcare Practitioner", practitioner):
        raise ApiError(Code.NOT_FOUND, _("Practitioner not found."))

    doc = frappe.get_doc("Healthcare Practitioner", practitioner)
    out = []
    for row in (doc.get("practitioner_schedules") or []):
        if not row.schedule:
            continue
        sched = frappe.get_doc("Practitioner Schedule", row.schedule)
        out.append({
            "schedule": sched.name,
            "slots": [
                {"day": t.day, "from_time": str(t.from_time), "to_time": str(t.to_time)}
                for t in (sched.get("time_slots") or [])
            ],
        })
    return {"practitioner": practitioner, "schedules": out}
