"""
clinic_core.api.v1.patient_billing -- the patient's own invoices and balance.

    summary / invoices / invoice / invoice_pdf

STRICTLY READ-ONLY. There is no endpoint here that writes anything, by design:
a patient may look at what they owe, and nothing else. Marking an invoice paid,
creating a Payment Entry or altering a total are accounting acts performed by
billing staff against evidence; putting any of them behind a patient's phone
would make the ledger unauditable.

Draft invoices (docstatus 0) are never shown. A draft is a figure the clinic has
not committed to, and a patient seeing one would reasonably treat it as a bill.
Cancelled invoices (docstatus 2) are excluded from balances for the same reason.
"""

import frappe
from frappe import _
from frappe.utils import flt

from clinic_core.api.response import ApiError, Code, clinic_api, as_int
from clinic_core.api.v1 import patient_guard as guard

SUBMITTED = 1

# Patient-visible invoice header. No `customer` (the accounting entity), no
# cost-centre / account / tax-template internals.
INVOICE_FIELDS = [
    "name", "posting_date", "due_date", "grand_total",
    "outstanding_amount", "status", "currency", "docstatus",
]


def _clinic_currency():
    """The currency to show when there are no invoices to read one from.

    Deliberately NOT `Global Defaults.default_currency`. This site's global
    default is INR -- dragged there by the `_Test Company` fixtures ERPNext ships
    -- while the real clinic ("Test Clinic", Pakistan) is PKR. Falling back to the
    global value made an empty Billing tab render "₹ 0" for a Pakistani patient.

    The company's own currency is the meaningful answer, so read that first and
    only fall back further if the site has no company at all.
    """
    company = (frappe.defaults.get_user_default("Company")
               or frappe.db.get_single_value("Global Defaults", "default_company"))
    if company:
        currency = frappe.db.get_value("Company", company, "default_currency")
        if currency:
            return currency

    # No company configured: prefer a selling price list's currency over the
    # global default, which on a test-fixture-polluted site is unreliable.
    price_list_currency = frappe.db.get_value(
        "Price List", {"selling": 1, "enabled": 1}, "currency")
    if price_list_currency:
        return price_list_currency

    return frappe.db.get_single_value("Global Defaults", "default_currency") or "PKR"


def _payment_status(row):
    """Normalised status, matching the staff API's vocabulary exactly.

    Shared vocabulary matters: the mobile theme maps these strings to colours in
    one place (`invoiceStatusTone`), so patient and staff screens cannot show the
    same invoice in two different colours.
    """
    outstanding = flt(row.get("outstanding_amount"))
    total = flt(row.get("grand_total"))
    if row.get("docstatus") == 2:
        return "cancelled"
    if outstanding <= 0:
        return "paid"
    if outstanding < total:
        return "partially_paid"
    return "unpaid"


@frappe.whitelist()
@clinic_api()
def summary():
    """Totals for the Billing hero card."""
    patient = guard.me()

    rows = frappe.get_all(
        "Sales Invoice",
        filters={"patient": patient, "docstatus": SUBMITTED},
        fields=["name", "grand_total", "outstanding_amount", "currency"],
        ignore_permissions=True,
    )

    billed = sum(flt(r["grand_total"]) for r in rows)
    outstanding = sum(flt(r["outstanding_amount"]) for r in rows)
    unpaid = sum(1 for r in rows if flt(r["outstanding_amount"]) > 0)

    currency = rows[0]["currency"] if rows else _clinic_currency()

    return {
        "total_billed": billed,
        "total_paid": billed - outstanding,
        "total_outstanding": outstanding,
        "unpaid_count": unpaid,
        "invoice_count": len(rows),
        "currency": currency,
    }


@frappe.whitelist()
@clinic_api()
def invoices(status=None, limit=50, start=0):
    """The caller's own invoices. `status` filters the tab, not the patient."""
    patient = guard.me()

    filters = {"patient": patient, "docstatus": SUBMITTED}

    status = (status or "all").lower()
    if status == "unpaid":
        filters["outstanding_amount"] = [">", 0]
    elif status == "paid":
        filters["outstanding_amount"] = ["<=", 0]
    elif status not in ("all", "partial"):
        raise ApiError(Code.VALIDATION, _("Unknown status filter."))

    rows = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        fields=INVOICE_FIELDS,
        order_by="posting_date desc, creation desc",
        limit_page_length=min(as_int(limit, 50), 200),
        limit_start=as_int(start, 0),
        ignore_permissions=True,
    )

    for row in rows:
        row["payment_status"] = _payment_status(row)
        row["paid_amount"] = flt(row["grand_total"]) - flt(row["outstanding_amount"])

    # "Partial" is a derived state, not a column, so it is filtered after the
    # query rather than pretending it can be expressed as one.
    if status == "partial":
        rows = [r for r in rows if r["payment_status"] == "partially_paid"]

    return {
        "items": rows,
        "total": frappe.db.count("Sales Invoice", filters),
        "status": status,
    }


@frappe.whitelist()
@clinic_api()
def invoice(invoice=None):
    """One invoice with its line items -- only if it is the caller's own."""
    patient = guard.me()
    doc = guard.own("Sales Invoice", invoice, patient)

    if doc.docstatus != SUBMITTED:
        # Drafts are not bills yet; cancelled invoices are not bills any more.
        raise guard.not_found()

    data = {f: doc.get(f) for f in INVOICE_FIELDS}
    data["payment_status"] = _payment_status(data)
    data["paid_amount"] = flt(doc.grand_total) - flt(doc.outstanding_amount)

    data["items"] = [{
        "item_name": item.get("item_name") or item.get("item_code"),
        "description": item.get("description"),
        "qty": item.get("qty"),
        "rate": item.get("rate"),
        "amount": item.get("amount"),
    } for item in doc.items]

    # Payments received against this invoice, so "paid Rs 1,000" is explainable.
    data["payments"] = [{
        "date": p.get("posting_date"),
        "amount": flt(p.get("allocated_amount")),
        "mode": p.get("mode_of_payment"),
    } for p in _payment_rows(doc.name)]

    return data


def _payment_rows(invoice_name):
    """Payment Entry allocations against one invoice."""
    try:
        return frappe.get_all(
            "Payment Entry Reference",
            filters={"reference_doctype": "Sales Invoice",
                     "reference_name": invoice_name, "docstatus": SUBMITTED},
            fields=["parent", "allocated_amount"],
            ignore_permissions=True,
        ) and frappe.db.sql(
            """
            SELECT pe.posting_date, pe.mode_of_payment, per.allocated_amount
            FROM `tabPayment Entry Reference` per
            JOIN `tabPayment Entry` pe ON pe.name = per.parent
            WHERE per.reference_doctype = 'Sales Invoice'
              AND per.reference_name = %s
              AND pe.docstatus = 1
            ORDER BY pe.posting_date
            """,
            (invoice_name,),
            as_dict=True,
        ) or []
    except Exception:
        # Payment history is a nicety; never fail the invoice view over it.
        return []


@frappe.whitelist()
@clinic_api()
def invoice_pdf(invoice=None):
    """The caller's own invoice as a base64 PDF, for the native share sheet.

    Reuses the staff renderer so both audiences get an identical document --
    a patient-specific PDF path would be a second thing to keep correct.
    """
    import base64

    patient = guard.me()
    doc = guard.own("Sales Invoice", invoice, patient)

    if doc.docstatus != SUBMITTED:
        raise guard.not_found()

    try:
        html = frappe.get_print("Sales Invoice", doc.name, no_letterhead=0)
        from frappe.utils.pdf import get_pdf
        pdf = get_pdf(html)
    except Exception:
        frappe.log_error(title="clinic_core: patient invoice PDF failed",
                         message=frappe.get_traceback())
        raise ApiError(
            Code.INTERNAL,
            _("Could not produce the invoice PDF. Please try again later."),
        )

    return {
        "invoice": doc.name,
        "filename": f"{doc.name}.pdf",
        "mime_type": "application/pdf",
        "encoding": "base64",
        "content": base64.b64encode(pdf).decode(),
        "size": len(pdf),
    }
