"""
clinic_core.api.v1.payments

Record payments against submitted Sales Invoices. Supports partial payment
(ERPNext handles the outstanding_amount arithmetic; we do not reimplement it).

Patients may READ their own payment history but never create payments --
recording money is a staff action.
"""

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from clinic_core.api.response import (
    ApiError, Code, clinic_api, assert_patient_access, current_patient,
    is_staff, parse_payload, as_int,
)

PAYMENT_ROLES = ["Healthcare Administrator", "Accounts Manager", "Accounts User", "Nursing User"]


@frappe.whitelist()
@clinic_api()
def payment_history(patient=None, limit=50, start=0):
    if not patient:
        patient = current_patient()
    assert_patient_access(patient)

    customer = frappe.db.get_value("Patient", patient, "customer")
    if not customer:
        return {"items": [], "total": 0}

    filters = {"party_type": "Customer", "party": customer, "docstatus": 1}
    limit = min(as_int(limit, 50), 200)
    rows = frappe.get_list(
        "Payment Entry",
        filters=filters,
        fields=["name", "posting_date", "paid_amount", "mode_of_payment",
                "reference_no", "status"],
        limit_page_length=limit,
        limit_start=as_int(start, 0),
        order_by="posting_date desc",
    )
    return {"items": rows, "total": frappe.db.count("Payment Entry", filters)}


@frappe.whitelist()
@clinic_api(roles=PAYMENT_ROLES)
def record_payment(payload=None):
    """Record a (possibly partial) payment against a submitted invoice.

    Uses ERPNext's get_payment_entry so that GL entries, party balances and
    outstanding amounts stay correct -- we never write those by hand.
    """
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

    data = parse_payload(payload)
    invoice = data.get("invoice")
    if not invoice:
        raise ApiError(Code.VALIDATION, _("invoice is required."))
    if not frappe.db.exists("Sales Invoice", invoice):
        raise ApiError(Code.NOT_FOUND, _("Invoice not found."))

    inv = frappe.get_doc("Sales Invoice", invoice)
    if inv.docstatus != 1:
        raise ApiError(Code.CONFLICT, _("Invoice must be submitted before payment."))
    if flt(inv.outstanding_amount) <= 0:
        raise ApiError(Code.CONFLICT, _("Invoice is already fully paid."))

    amount = flt(data.get("amount") or inv.outstanding_amount)
    if amount <= 0:
        raise ApiError(Code.VALIDATION, _("amount must be greater than zero."))
    if amount > flt(inv.outstanding_amount):
        raise ApiError(
            Code.VALIDATION,
            _("Amount exceeds outstanding {0}.").format(flt(inv.outstanding_amount)),
        )

    pe = get_payment_entry("Sales Invoice", invoice)
    pe.paid_amount = amount
    pe.received_amount = amount
    pe.reference_no = data.get("reference_no") or invoice
    pe.reference_date = data.get("posting_date") or nowdate()
    if data.get("mode_of_payment"):
        pe.mode_of_payment = data["mode_of_payment"]

    # Align the allocation with the amount actually being paid.
    for ref in pe.references:
        if ref.reference_name == invoice:
            ref.allocated_amount = amount

    pe.flags.ignore_permissions = False
    pe.insert()
    pe.submit()
    frappe.db.commit()

    inv.reload()
    return {
        "payment_entry": pe.name,
        "paid_amount": flt(pe.paid_amount),
        "invoice": invoice,
        "grand_total": flt(inv.grand_total),
        "outstanding_amount": flt(inv.outstanding_amount),
        "invoice_status": inv.status,
        "fully_paid": flt(inv.outstanding_amount) <= 0,
    }
