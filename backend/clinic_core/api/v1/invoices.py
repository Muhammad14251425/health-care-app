"""
clinic_core.api.v1.invoices

Simple clinic billing over ERPNext Sales Invoice:
    Appointment -> Consultation -> Invoice -> Unpaid / Partly Paid / Paid

Patients may READ their own invoices. Only billing staff may create or submit.
"""

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from clinic_core.api.response import (
    ApiError, Code, clinic_api, assert_patient_access, current_patient,
    is_staff, parse_payload, pick, as_int,
)

BILLING_ROLES = ["Healthcare Administrator", "Accounts Manager", "Accounts User", "Nursing User"]

INVOICE_FIELDS = [
    "name", "customer", "patient", "patient_name", "posting_date", "due_date",
    "grand_total", "outstanding_amount", "status", "currency", "docstatus",
]


def _patient_customer(patient):
    """Resolve the ERPNext Customer linked to a Patient."""
    customer = frappe.db.get_value("Patient", patient, "customer")
    if not customer:
        raise ApiError(
            Code.VALIDATION,
            _("Patient {0} has no linked Customer; cannot invoice.").format(patient),
        )
    return customer


def _payment_status(inv):
    """Normalised status the mobile client can rely on."""
    outstanding = flt(inv.get("outstanding_amount"))
    total = flt(inv.get("grand_total"))
    if inv.get("docstatus") == 0:
        return "draft"
    if inv.get("docstatus") == 2:
        return "cancelled"
    if outstanding <= 0:
        return "paid"
    if outstanding < total:
        return "partially_paid"
    return "unpaid"


@frappe.whitelist()
@clinic_api()
def list_invoices(patient=None, status=None, limit=50, start=0):
    filters = {"docstatus": ["!=", 2]}

    if not is_staff():
        mine = current_patient()
        if not mine:
            raise ApiError(Code.FORBIDDEN, _("No patient record linked to this user."))
        filters["patient"] = mine
    elif patient:
        assert_patient_access(patient)
        filters["patient"] = patient

    if status:
        filters["status"] = status

    limit = min(as_int(limit, 50), 200)
    rows = frappe.get_list(
        "Sales Invoice",
        filters=filters,
        fields=INVOICE_FIELDS,
        limit_page_length=limit,
        limit_start=as_int(start, 0),
        order_by="posting_date desc",
    )
    for r in rows:
        r["payment_status"] = _payment_status(r)
    return {"items": rows, "total": frappe.db.count("Sales Invoice", filters)}


@frappe.whitelist()
@clinic_api()
def get_invoice(invoice):
    if not frappe.db.exists("Sales Invoice", invoice):
        raise ApiError(Code.NOT_FOUND, _("Invoice not found."))

    doc = frappe.get_doc("Sales Invoice", invoice)
    if not is_staff():
        if not doc.get("patient"):
            raise ApiError(Code.FORBIDDEN, _("You are not allowed to access this record."))
        assert_patient_access(doc.patient)

    data = {f: doc.get(f) for f in INVOICE_FIELDS}
    data["payment_status"] = _payment_status(data)
    data["items"] = [
        {"item_code": i.item_code, "item_name": i.item_name, "qty": i.qty,
         "rate": i.rate, "amount": i.amount}
        for i in doc.items
    ]
    return data


@frappe.whitelist()
@clinic_api(roles=BILLING_ROLES)
def create_consultation_invoice(payload=None):
    """Create (and optionally submit) a consultation invoice for a patient."""
    data = parse_payload(payload)
    patient = data.get("patient")
    if not patient:
        raise ApiError(Code.VALIDATION, _("patient is required."))
    assert_patient_access(patient)

    practitioner = data.get("practitioner")
    rate = data.get("rate")
    if rate is None and practitioner:
        rate = frappe.db.get_value("Healthcare Practitioner", practitioner,
                                   "op_consulting_charge")
    if rate is None:
        raise ApiError(Code.VALIDATION, _("rate is required."))

    item_code = data.get("item_code") or _consultation_item()
    company = (data.get("company")
               or frappe.db.get_single_value("Global Defaults", "default_company"))

    # Sales Invoice requires selling_price_list / price_list_currency /
    # plc_conversion_rate. Set them explicitly rather than relying on the global
    # default being configured.
    price_list = (frappe.db.get_single_value("Selling Settings", "selling_price_list")
                  or frappe.db.get_value("Price List", {"selling": 1, "enabled": 1}, "name"))
    if not price_list:
        raise ApiError(
            Code.VALIDATION,
            _("No selling Price List configured. Run clinic_core.setup_masters.run."),
        )
    currency = (frappe.db.get_value("Price List", price_list, "currency")
                or frappe.db.get_value("Company", company, "default_currency"))

    inv = frappe.get_doc({
        "doctype": "Sales Invoice",
        "customer": _patient_customer(patient),
        "patient": patient,
        "company": company,
        "selling_price_list": price_list,
        "price_list_currency": currency,
        "plc_conversion_rate": 1,
        "currency": currency,
        "conversion_rate": 1,
        "posting_date": data.get("posting_date") or nowdate(),
        "due_date": data.get("due_date") or nowdate(),
        "items": [{
            "item_code": item_code,
            "qty": 1,
            "rate": flt(rate),
            "description": data.get("description") or _("Consultation"),
        }],
    })
    if data.get("appointment"):
        inv.patient_appointment = data["appointment"]

    inv.set_missing_values()
    inv.insert()

    if data.get("submit"):
        inv.submit()

    frappe.db.commit()

    out = {f: inv.get(f) for f in INVOICE_FIELDS}
    out["payment_status"] = _payment_status(out)
    return out


def _consultation_item():
    """Ensure a non-stock service Item exists to bill consultations against."""
    code = "Consultation Charge"
    if frappe.db.exists("Item", code):
        return code

    group = (frappe.db.get_value("Item Group", {"item_group_name": "Services"}, "name")
             or frappe.db.get_value("Item Group", {"is_group": 0}, "name"))
    uom = frappe.db.get_value("UOM", {"uom_name": "Nos"}, "name")
    if not uom:
        # No UOM on this site at all -- run clinic_core.setup_masters.run first.
        raise ApiError(
            Code.VALIDATION,
            _("No Unit of Measure configured. Run clinic_core.setup_masters.run."),
        )

    frappe.get_doc({
        "doctype": "Item",
        "item_code": code,
        "item_name": code,
        "item_group": group,
        "stock_uom": uom,
        "is_stock_item": 0,
        "is_sales_item": 1,
        "include_item_in_manufacturing": 0,
    }).insert(ignore_permissions=True)
    frappe.db.commit()
    return code


@frappe.whitelist()
@clinic_api(roles=BILLING_ROLES)
def submit_invoice(invoice):
    if not frappe.db.exists("Sales Invoice", invoice):
        raise ApiError(Code.NOT_FOUND, _("Invoice not found."))
    doc = frappe.get_doc("Sales Invoice", invoice)
    if doc.docstatus == 1:
        out = {f: doc.get(f) for f in INVOICE_FIELDS}
        out["payment_status"] = _payment_status(out)
        return out
    doc.submit()
    frappe.db.commit()
    doc.reload()
    out = {f: doc.get(f) for f in INVOICE_FIELDS}
    out["payment_status"] = _payment_status(out)
    return out


@frappe.whitelist()
@clinic_api()
def outstanding(patient=None):
    """Total outstanding for a patient."""
    if not patient:
        patient = current_patient()
    assert_patient_access(patient)

    rows = frappe.get_all(
        "Sales Invoice",
        filters={"patient": patient, "docstatus": 1},
        fields=["name", "grand_total", "outstanding_amount", "status"],
    )
    return {
        "patient": patient,
        "total_billed": sum(flt(r.grand_total) for r in rows),
        "total_outstanding": sum(flt(r.outstanding_amount) for r in rows),
        "invoices": rows,
    }
