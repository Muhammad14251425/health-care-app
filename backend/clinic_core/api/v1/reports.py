"""
clinic_core.api.v1.reports

Clinic reporting for the mobile app.

WHY NOT `frappe.desk.query_report.run`: ERPNext ships ~200 reports and they are
excellent -- on a desktop. They return a spreadsheet grid (14 columns wide in the
case of Patient Appointment Analytics) which is unreadable on a phone, and each
one takes a different, undocumented filter set: getting the Analytics report to
run at all requires knowing it needs `tree_type`, or it fails with an
AttributeError rather than a useful message.

So these endpoints answer the questions a clinic actually asks, shaped for a
phone: a few headline numbers, a short series to draw, and a small ranked list.
The desk reports remain available at /app/report for anyone who wants the grid.

PERMISSIONS. Revenue is billing data, so the financial endpoint is restricted to
the roles that already hold invoice access -- a Physician gets 403 from
invoices.* on this backend, and must not read clinic takings through a side door.
Clinical volume (appointments, encounters) is open to any staff member.
"""

import frappe
from frappe import _
from frappe.utils import add_days, add_months, flt, getdate, nowdate

from clinic_core.api.response import ApiError, Code, clinic_api, parse_payload

# Same list invoices.py uses. A pure Physician is deliberately absent.
BILLING_ROLES = ["Healthcare Administrator", "Accounts Manager", "Accounts User", "Nursing User"]

STAFF_ROLES = [
    "Healthcare Administrator", "Physician", "Nursing User",
    "Accounts Manager", "Accounts User",
]

# Appointment statuses that represent a booking the clinic honoured. 'Closed' is
# Marley's completed state; 'Open' means the visit is in progress.
ATTENDED = ("Closed", "Open")


def _range(period):
    """Resolve a named period to (from_date, to_date).

    Named periods rather than free dates: a phone date-picker for two dates is
    painful, and these four cover what anyone actually asks a clinic dashboard.
    """
    today = getdate(nowdate())
    if period == "today":
        return today, today
    if period == "week":
        return add_days(today, -6), today
    if period == "month":
        return add_days(today, -29), today
    if period == "quarter":
        return add_months(today, -3), today
    if period == "year":
        return add_months(today, -12), today
    raise ApiError(Code.VALIDATION, _("Unknown period {0}.").format(period))


def _period_from(payload, default="month"):
    data = parse_payload(payload) if payload else {}
    return data.get("period") or default


@frappe.whitelist()
@clinic_api(roles=STAFF_ROLES)
def overview(payload=None):
    """Headline numbers for the reports landing screen.

    One endpoint rather than four so the screen paints in a single round trip;
    a clinic on mobile data should not pay four for one view.
    """
    period = _period_from(payload)
    lo, hi = _range(period)

    appts = frappe.db.sql(
        """
        select status, count(*) as n
        from `tabPatient Appointment`
        where appointment_date between %(lo)s and %(hi)s
        group by status
        """,
        {"lo": lo, "hi": hi},
        as_dict=True,
    )

    by_status = {}
    for row in appts:
        # Older rows carry an empty status; count them as scheduled rather than
        # inventing a category, and never drop them from the total.
        key = (row.status or "Scheduled")
        by_status[key] = by_status.get(key, 0) + int(row.n)

    total = sum(by_status.values())
    cancelled = by_status.get("Cancelled", 0)
    no_show = by_status.get("No Show", 0)
    attended = sum(by_status.get(s, 0) for s in ATTENDED)

    encounters = frappe.db.count(
        "Patient Encounter",
        {"encounter_date": ["between", [lo, hi]], "docstatus": ["<", 2]},
    )
    new_patients = frappe.db.sql(
        "select count(*) as n from `tabPatient` where date(creation) between %(lo)s and %(hi)s",
        {"lo": lo, "hi": hi},
        as_dict=True,
    )[0].n

    out = {
        "period": period,
        "from_date": str(lo),
        "to_date": str(hi),
        "appointments": {
            "total": total,
            "attended": attended,
            "cancelled": cancelled,
            "no_show": no_show,
            "scheduled": by_status.get("Scheduled", 0),
            # Expressed as a percentage because "12 of 112" is harder to read at
            # a glance than "10.7%", and it is the number clinics track.
            "cancellation_rate": round((cancelled / total * 100), 1) if total else 0.0,
            "no_show_rate": round((no_show / total * 100), 1) if total else 0.0,
        },
        "encounters": encounters,
        "new_patients": int(new_patients or 0),
    }

    # Revenue only for roles that may see billing; everyone else gets the
    # clinical half of the screen and no empty money card.
    if _can_bill():
        out["revenue"] = _revenue_totals(lo, hi)

    return out


def _can_bill():
    roles = set(frappe.get_roles())
    return bool(roles.intersection(set(BILLING_ROLES + ["System Manager", "Administrator"])))


def _revenue_totals(lo, hi):
    row = frappe.db.sql(
        """
        select
            count(*)                     as invoices,
            sum(grand_total)             as billed,
            sum(outstanding_amount)      as outstanding
        from `tabSales Invoice`
        where docstatus = 1 and posting_date between %(lo)s and %(hi)s
        """,
        {"lo": lo, "hi": hi},
        as_dict=True,
    )[0]

    billed = flt(row.billed)
    outstanding = flt(row.outstanding)
    return {
        "invoices": int(row.invoices or 0),
        "billed": billed,
        "collected": billed - outstanding,
        "outstanding": outstanding,
        "currency": frappe.db.get_default("currency") or "PKR",
    }


@frappe.whitelist()
@clinic_api(roles=STAFF_ROLES)
def appointments_trend(payload=None):
    """Appointments per day over the period -- the series behind the chart."""
    period = _period_from(payload)
    lo, hi = _range(period)

    rows = frappe.db.sql(
        """
        select appointment_date as d, count(*) as n
        from `tabPatient Appointment`
        where appointment_date between %(lo)s and %(hi)s
          and (status is null or status != 'Cancelled')
        group by appointment_date
        order by appointment_date
        """,
        {"lo": lo, "hi": hi},
        as_dict=True,
    )

    # Fill the gaps. A chart drawn from sparse rows silently compresses quiet
    # days, which makes a clinic look busier than it was.
    counts = {str(r.d): int(r.n) for r in rows}
    series, cursor = [], getdate(lo)
    while cursor <= getdate(hi):
        key = str(cursor)
        series.append({"date": key, "count": counts.get(key, 0)})
        cursor = add_days(cursor, 1)

    return {
        "period": period,
        "from_date": str(lo),
        "to_date": str(hi),
        "series": series,
        "total": sum(p["count"] for p in series),
        "peak": max((p["count"] for p in series), default=0),
    }


@frappe.whitelist()
@clinic_api(roles=STAFF_ROLES)
def by_practitioner(payload=None):
    """Workload per doctor: appointments, completed visits, notes written."""
    period = _period_from(payload)
    lo, hi = _range(period)

    rows = frappe.db.sql(
        """
        select
            a.practitioner                                             as practitioner,
            a.practitioner_name                                        as practitioner_name,
            count(*)                                                   as appointments,
            sum(case when a.status in ('Closed','Open') then 1 else 0 end) as attended,
            sum(case when a.status = 'Cancelled' then 1 else 0 end)    as cancelled
        from `tabPatient Appointment` a
        where a.appointment_date between %(lo)s and %(hi)s
        group by a.practitioner, a.practitioner_name
        order by appointments desc
        """,
        {"lo": lo, "hi": hi},
        as_dict=True,
    )

    notes = frappe.db.sql(
        """
        select practitioner, count(*) as n
        from `tabPatient Encounter`
        where encounter_date between %(lo)s and %(hi)s and docstatus < 2
        group by practitioner
        """,
        {"lo": lo, "hi": hi},
        as_dict=True,
    )
    notes_by = {r.practitioner: int(r.n) for r in notes}

    items = []
    for r in rows:
        items.append({
            "practitioner": r.practitioner,
            "practitioner_name": r.practitioner_name or r.practitioner,
            "appointments": int(r.appointments or 0),
            "attended": int(r.attended or 0),
            "cancelled": int(r.cancelled or 0),
            "encounters": notes_by.get(r.practitioner, 0),
        })

    return {"period": period, "from_date": str(lo), "to_date": str(hi), "items": items}


@frappe.whitelist()
@clinic_api(roles=BILLING_ROLES)
def revenue(payload=None):
    """Money: totals, a daily series, and who still owes.

    Billing roles only -- see the module docstring.
    """
    period = _period_from(payload)
    lo, hi = _range(period)

    totals = _revenue_totals(lo, hi)

    rows = frappe.db.sql(
        """
        select posting_date as d,
               sum(grand_total) as billed,
               sum(grand_total - outstanding_amount) as collected
        from `tabSales Invoice`
        where docstatus = 1 and posting_date between %(lo)s and %(hi)s
        group by posting_date
        order by posting_date
        """,
        {"lo": lo, "hi": hi},
        as_dict=True,
    )
    by_date = {str(r.d): r for r in rows}

    series, cursor = [], getdate(lo)
    while cursor <= getdate(hi):
        key = str(cursor)
        r = by_date.get(key)
        series.append({
            "date": key,
            "billed": flt(r.billed) if r else 0.0,
            "collected": flt(r.collected) if r else 0.0,
        })
        cursor = add_days(cursor, 1)

    # Who owes, biggest first -- the list reception actually chases.
    debtors = frappe.db.sql(
        """
        select patient, patient_name, sum(outstanding_amount) as due, count(*) as invoices
        from `tabSales Invoice`
        where docstatus = 1 and outstanding_amount > 0
        group by patient, patient_name
        order by due desc
        limit 10
        """,
        as_dict=True,
    )

    return {
        "period": period,
        "from_date": str(lo),
        "to_date": str(hi),
        "totals": totals,
        "series": series,
        "outstanding_by_patient": [
            {
                "patient": d.patient,
                "patient_name": d.patient_name or d.patient,
                "due": flt(d.due),
                "invoices": int(d.invoices or 0),
            }
            for d in debtors
        ],
    }


@frappe.whitelist()
@clinic_api(roles=STAFF_ROLES)
def top_diagnoses(payload=None):
    """What the clinic is treating, most frequent first.

    Reads the Patient Encounter Diagnosis child table, which is where Marley
    stores the diagnosis rows -- the parent encounter holds no diagnosis field.
    """
    period = _period_from(payload)
    lo, hi = _range(period)

    rows = frappe.db.sql(
        """
        select d.diagnosis as diagnosis, count(*) as n
        from `tabPatient Encounter Diagnosis` d
        inner join `tabPatient Encounter` e on e.name = d.parent
        where e.encounter_date between %(lo)s and %(hi)s and e.docstatus < 2
        group by d.diagnosis
        order by n desc
        limit 10
        """,
        {"lo": lo, "hi": hi},
        as_dict=True,
    )

    return {
        "period": period,
        "from_date": str(lo),
        "to_date": str(hi),
        "items": [{"diagnosis": r.diagnosis, "count": int(r.n)} for r in rows],
    }
