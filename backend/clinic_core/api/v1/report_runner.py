"""
clinic_core.api.v1.report_runner

Generic access to Frappe/ERPNext's own report engine, plus downloads.

WHY THIS EXISTS ALONGSIDE reports.py: `reports.py` answers a handful of
questions with figures shaped for a phone. This module is the other half -- it
runs ANY of the ~200 desk reports, so every report the clinic already has (and
every one a future ERPNext upgrade adds) is reachable from mobile without
another release.

PERMISSIONS. Three layers, none of them optional:

  1. The report's own `ref_doctype` -- Frappe already knows who may read a
     Sales Invoice, and `run` enforces it. A Physician running Sales Register
     gets nothing they could not already see.
  2. An explicit allowlist of MODULES. ERPNext ships reports for
     manufacturing, assets and payroll that have no business in a clinic app
     and would only expose the chart of accounts to the curious.
  3. Financial modules are gated on billing roles, matching invoices.* -- a
     pure Physician is refused, exactly as they are refused invoices.

Downloads go out base64 for the same reason invoices do: a mobile client holds
a session cookie, not a browser, and the share sheet needs the bytes on device.
"""

import base64
import json

import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate

from clinic_core.api.response import ApiError, Code, clinic_api, parse_payload

# Modules whose reports may be listed and run. Anything outside this is not
# "hidden" -- it is refused, because the allowlist is the security boundary.
CLINICAL_MODULES = ["Healthcare"]
FINANCIAL_MODULES = ["Accounts", "Selling"]

BILLING_ROLES = ["Healthcare Administrator", "Accounts Manager", "Accounts User", "Nursing User"]
STAFF_ROLES = [
    "Healthcare Administrator", "Physician", "Nursing User",
    "Accounts Manager", "Accounts User",
]

# Rows this big are a sign the caller wants a spreadsheet, not a phone screen.
MAX_ROWS = 2000
# A PDF of more than this is slow to render and useless to read on a phone.
MAX_PDF_ROWS = 500


def _can_bill():
    roles = set(frappe.get_roles())
    return bool(roles.intersection(set(BILLING_ROLES + ["System Manager", "Administrator"])))


def _allowed_modules():
    mods = list(CLINICAL_MODULES)
    if _can_bill():
        mods += FINANCIAL_MODULES
    return mods


def _assert_allowed(report_name):
    """Refuse anything outside the allowlist, and anything the role cannot see."""
    if not frappe.db.exists("Report", report_name):
        raise ApiError(Code.NOT_FOUND, _("Report not found."))

    module, ref_doctype, disabled = frappe.db.get_value(
        "Report", report_name, ["module", "ref_doctype", "disabled"]
    )
    if disabled:
        raise ApiError(Code.NOT_FOUND, _("Report not found."))

    if module not in _allowed_modules():
        # Deliberately the same message as a missing report: telling a physician
        # that "Balance Sheet exists but you may not see it" is information too.
        raise ApiError(Code.FORBIDDEN, _("You are not allowed to run this report."))

    # Layer 1: the report's own doctype permission.
    if ref_doctype and not frappe.has_permission(ref_doctype, "report"):
        raise ApiError(Code.FORBIDDEN, _("You are not allowed to run this report."))

    return module, ref_doctype


def _clean_filters(raw):
    """Filters arrive as a dict from the client; drop empties so a report's own
    defaults apply rather than being overridden with None."""
    if not raw:
        return {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise ApiError(Code.VALIDATION, _("filters must be an object."))
    if not isinstance(raw, dict):
        raise ApiError(Code.VALIDATION, _("filters must be an object."))
    return {k: v for k, v in raw.items() if v not in (None, "", [])}


def _normalise_rows(result, columns):
    """Report rows come back as dicts OR lists depending on the report; and a
    total row is sometimes a bare list. Normalise to dicts keyed by fieldname so
    the client renders one shape.
    """
    fieldnames = [c.get("fieldname") or f"col_{i}" for i, c in enumerate(columns)]
    out = []
    for row in result:
        if isinstance(row, dict):
            out.append({fn: row.get(fn) for fn in fieldnames})
        elif isinstance(row, (list, tuple)):
            out.append({fn: (row[i] if i < len(row) else None) for i, fn in enumerate(fieldnames)})
    return out


def _normalise_columns(columns):
    out = []
    for i, c in enumerate(columns):
        if isinstance(c, str):
            # Old-style "Label:Type/Options:Width"
            parts = c.split(":")
            label = parts[0]
            out.append({
                "label": label,
                "fieldname": frappe.scrub(label) or f"col_{i}",
                "fieldtype": parts[1].split("/")[0] if len(parts) > 1 else "Data",
                "width": cint(parts[2]) if len(parts) > 2 else 120,
            })
        else:
            out.append({
                "label": c.get("label") or c.get("fieldname") or f"Column {i + 1}",
                "fieldname": c.get("fieldname") or f"col_{i}",
                "fieldtype": c.get("fieldtype") or "Data",
                "width": cint(c.get("width")) or 120,
                "options": c.get("options"),
            })
    return out


@frappe.whitelist()
@clinic_api(roles=STAFF_ROLES)
def list_reports(payload=None):
    """Every report this user may run, grouped by module."""
    data = parse_payload(payload) if payload else {}
    search = (data.get("search") or "").strip().lower()

    rows = frappe.get_all(
        "Report",
        filters={"module": ["in", _allowed_modules()], "disabled": 0},
        fields=["name", "module", "report_type", "ref_doctype"],
        order_by="module asc, name asc",
    )

    items = []
    for r in rows:
        if search and search not in r.name.lower():
            continue
        # Hide what the doctype permission would refuse anyway, so the list does
        # not advertise reports that only produce a 403 when tapped.
        if r.ref_doctype and not frappe.has_permission(r.ref_doctype, "report"):
            continue
        items.append({
            "name": r.name,
            "module": r.module,
            "report_type": r.report_type,
            "ref_doctype": r.ref_doctype,
        })

    return {"items": items, "total": len(items), "modules": _allowed_modules()}


@frappe.whitelist()
@clinic_api(roles=STAFF_ROLES)
def get_filters(payload=None):
    """The filters a report declares, so the client can build its form.

    Read from the report's own JS `filters` definition where present; a report
    with none simply takes no filters.
    """
    data = parse_payload(payload)
    report_name = data.get("report")
    if not report_name:
        raise ApiError(Code.VALIDATION, _("report is required."))
    _assert_allowed(report_name)

    doc = frappe.get_doc("Report", report_name)
    out = []
    for f in (doc.get("filters") or []):
        out.append({
            "fieldname": f.get("fieldname"),
            "label": f.get("label"),
            "fieldtype": f.get("fieldtype"),
            "options": f.get("options"),
            "default": f.get("default"),
            "mandatory": cint(f.get("reqd")),
        })

    return {
        "report": report_name,
        "filters": out,
        # Most ERPNext financial reports need these two and fail confusingly
        # without them, so the client can pre-fill sensible values.
        "suggests_company": bool(frappe.db.count("Company")),
        "default_company": frappe.db.get_single_value("Global Defaults", "default_company"),
        "today": nowdate(),
    }


@frappe.whitelist()
@clinic_api(roles=STAFF_ROLES)
def run_report(payload=None):
    """Run any allowed desk report and return rows the client can render."""
    from frappe.desk.query_report import run as run_query_report

    data = parse_payload(payload)
    report_name = data.get("report")
    if not report_name:
        raise ApiError(Code.VALIDATION, _("report is required."))

    module, _ref = _assert_allowed(report_name)
    filters = _clean_filters(data.get("filters"))
    limit = min(cint(data.get("limit")) or 200, MAX_ROWS)

    try:
        # ignore_prepared_report: a background "prepared report" would return a
        # job id instead of rows, which a phone cannot wait on.
        result = run_query_report(report_name, filters=filters, ignore_prepared_report=True)
    except frappe.PermissionError:
        raise ApiError(Code.FORBIDDEN, _("You are not allowed to run this report."))
    except Exception as e:
        # Report scripts raise bare AttributeErrors when a required filter is
        # missing (Patient Appointment Analytics does exactly this without
        # `tree_type`). Surface something the user can act on.
        frappe.log_error(
            title=f"clinic_core report failed: {report_name}",
            message=frappe.get_traceback(with_context=True),
        )
        raise ApiError(
            Code.VALIDATION,
            _("This report could not run with those filters. Check the required filters and try again."),
        ) from e

    columns = _normalise_columns(result.get("columns") or [])
    rows = _normalise_rows(result.get("result") or [], columns)
    total = len(rows)

    return {
        "report": report_name,
        "module": module,
        "columns": columns,
        "rows": rows[:limit],
        "total": total,
        "truncated": total > limit,
        "filters": filters,
    }


def _report_payload(report_name, filters):
    """Shared by both download formats."""
    from frappe.desk.query_report import run as run_query_report

    result = run_query_report(report_name, filters=filters, ignore_prepared_report=True)
    columns = _normalise_columns(result.get("columns") or [])
    rows = _normalise_rows(result.get("result") or [], columns)
    return columns, rows


@frappe.whitelist()
@clinic_api(roles=STAFF_ROLES)
def download_csv(payload=None):
    """Any allowed report as CSV, base64-encoded."""
    data = parse_payload(payload)
    report_name = data.get("report")
    if not report_name:
        raise ApiError(Code.VALIDATION, _("report is required."))
    _assert_allowed(report_name)

    filters = _clean_filters(data.get("filters"))
    columns, rows = _report_payload(report_name, filters)

    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([c["label"] for c in columns])
    for row in rows:
        writer.writerow([_csv_value(row.get(c["fieldname"])) for c in columns])

    # BOM so Excel opens UTF-8 correctly -- without it, patient names with
    # non-ASCII characters arrive mangled.
    content = ("﻿" + buf.getvalue()).encode("utf-8")
    safe = frappe.scrub(report_name)

    return {
        "report": report_name,
        "filename": f"{safe}_{nowdate()}.csv",
        "mime_type": "text/csv",
        "encoding": "base64",
        "rows": len(rows),
        "content": base64.b64encode(content).decode(),
    }


def _csv_value(v):
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    return v


@frappe.whitelist()
@clinic_api(roles=STAFF_ROLES)
def download_pdf(payload=None):
    """Any allowed report as PDF, base64-encoded.

    Landscape: these reports are wide (Sales Register is 24 columns) and
    portrait would shrink them past legibility.
    """
    from clinic_core.pdf import render_pdf

    data = parse_payload(payload)
    report_name = data.get("report")
    if not report_name:
        raise ApiError(Code.VALIDATION, _("report is required."))
    _assert_allowed(report_name)

    filters = _clean_filters(data.get("filters"))
    columns, rows = _report_payload(report_name, filters)

    if len(rows) > MAX_PDF_ROWS:
        raise ApiError(
            Code.VALIDATION,
            _("This report has {0} rows; export it as CSV instead (PDF is capped at {1}).").format(
                len(rows), MAX_PDF_ROWS
            ),
        )

    html = _render_table_html(report_name, columns, rows, filters)
    pdf = render_pdf(html, options={"orientation": "Landscape", "page-size": "A4"})
    safe = frappe.scrub(report_name)

    return {
        "report": report_name,
        "filename": f"{safe}_{nowdate()}.pdf",
        "mime_type": "application/pdf",
        "encoding": "base64",
        "rows": len(rows),
        "content": base64.b64encode(pdf).decode(),
    }


def _render_table_html(report_name, columns, rows, filters):
    company = frappe.db.get_single_value("Global Defaults", "default_company") or ""
    filter_line = ", ".join(f"{k}: {v}" for k, v in (filters or {}).items())

    head = "".join(f"<th>{frappe.utils.escape_html(str(c['label']))}</th>" for c in columns)
    body = []
    for row in rows:
        cells = []
        for c in columns:
            v = row.get(c["fieldname"])
            numeric = c.get("fieldtype") in ("Currency", "Float", "Int", "Percent")
            if v is None:
                v = ""
            elif numeric and isinstance(v, (int, float)):
                v = frappe.format_value(v, {"fieldtype": c.get("fieldtype")})
            cells.append(
                f"<td class='{'num' if numeric else ''}'>"
                f"{frappe.utils.escape_html(str(v))}</td>"
            )
        body.append("<tr>" + "".join(cells) + "</tr>")

    return f"""
    <html><head><meta charset="utf-8"><style>
      body {{ font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 8pt; color:#1b1b1b; }}
      h1 {{ font-size: 14pt; margin: 0 0 2px; }}
      .meta {{ color:#666; font-size:7.5pt; margin-bottom:10px; }}
      table {{ width:100%; border-collapse: collapse; }}
      th, td {{ border:1px solid #ddd; padding:3px 5px; text-align:left; }}
      th {{ background:#f2f2f2; font-weight:600; }}
      td.num {{ text-align:right; }}
      tr:nth-child(even) td {{ background:#fafafa; }}
    </style></head><body>
      <h1>{frappe.utils.escape_html(report_name)}</h1>
      <div class="meta">
        {frappe.utils.escape_html(company)} &middot; generated {nowdate()}
        {(' &middot; ' + frappe.utils.escape_html(filter_line)) if filter_line else ''}
        &middot; {len(rows)} rows
      </div>
      <table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>
    </body></html>
    """


# --------------------------------------------------------------------------- #
# Bulk invoice download
# --------------------------------------------------------------------------- #
@frappe.whitelist()
@clinic_api(roles=BILLING_ROLES)
def bulk_invoices(payload=None):
    """Several invoices as one PDF, selected by date, patient or payment status.

    Billing roles only, matching invoices.*.

    One combined PDF rather than a zip of many: a phone share sheet handles a
    single file well and a zip badly, and the usual reason to ask for this is to
    send or print a batch.
    """
    data = parse_payload(payload)
    filters = {"docstatus": 1}

    if data.get("from_date") and data.get("to_date"):
        filters["posting_date"] = ["between", [data["from_date"], data["to_date"]]]
    if data.get("patient"):
        filters["patient"] = data["patient"]

    status = data.get("status")
    if status == "unpaid":
        filters["outstanding_amount"] = [">", 0]
    elif status == "paid":
        filters["outstanding_amount"] = ["<=", 0]

    limit = min(cint(data.get("limit")) or 50, 100)

    names = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        fields=["name"],
        order_by="posting_date asc, name asc",
        limit=limit,
        pluck="name",
    )
    if not names:
        raise ApiError(Code.NOT_FOUND, _("No submitted invoices match those filters."))

    # Each invoice through its own print format, joined with page breaks, so a
    # bulk download is identical to downloading them one by one.
    from clinic_core.pdf import print_many_pdf

    pdf = print_many_pdf("Sales Invoice", names, print_format=data.get("print_format") or None)

    return {
        "filename": f"invoices_{nowdate()}.pdf",
        "mime_type": "application/pdf",
        "encoding": "base64",
        "count": len(names),
        "invoices": names,
        "content": base64.b64encode(pdf).decode(),
    }


@frappe.whitelist()
@clinic_api(roles=BILLING_ROLES)
def bulk_invoices_preview(payload=None):
    """How many invoices the same filters would return, and their total.

    Called before the download so the user is not left waiting on a render of
    eighty invoices they did not intend to ask for.
    """
    data = parse_payload(payload)
    filters = {"docstatus": 1}

    if data.get("from_date") and data.get("to_date"):
        filters["posting_date"] = ["between", [data["from_date"], data["to_date"]]]
    if data.get("patient"):
        filters["patient"] = data["patient"]

    status = data.get("status")
    if status == "unpaid":
        filters["outstanding_amount"] = [">", 0]
    elif status == "paid":
        filters["outstanding_amount"] = ["<=", 0]

    rows = frappe.get_all(
        "Sales Invoice",
        filters=filters,
        fields=["name", "patient_name", "posting_date", "grand_total", "outstanding_amount", "currency"],
        order_by="posting_date asc",
        limit=100,
    )

    return {
        "count": len(rows),
        "capped": len(rows) >= 100,
        "total": flt(sum(flt(r.grand_total) for r in rows)),
        "outstanding": flt(sum(flt(r.outstanding_amount) for r in rows)),
        "currency": rows[0].currency if rows else None,
        "items": rows[:25],
    }
