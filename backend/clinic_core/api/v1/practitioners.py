"""clinic_core.api.v1.practitioners

Read: any authenticated user may browse practitioners and their published
working pattern -- that is booking information.

Write: schedule editing, blocked time and leave. These are restricted to
SCHEDULE_ROLES; a practitioner may additionally manage their OWN calendar.
Everything is written through Marley's own doctypes (Practitioner Schedule and
Practitioner Availability) so the scheduler, the overlap checks and the booking
flow all see the change -- nothing is stored in a parallel clinic_core table.
"""

from datetime import date, datetime

import frappe
from frappe import _
from frappe.utils import get_time, getdate, nowdate

from clinic_core.api.response import (
    ApiError, Code, clinic_api, as_int, current_practitioner, parse_payload,
)

PRACTITIONER_FIELDS = [
    "name", "practitioner_name", "department", "designation",
    "op_consulting_charge", "status", "user_id",
]

# Who may change a clinic-wide schedule.
SCHEDULE_ROLES = ["Healthcare Administrator", "Physician", "Nursing User"]

WEEKDAYS = (
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday",
)

# Marley's Practitioner Availability.reason options. "Time Off" doubles as the
# leave reason; the rest describe a shorter block.
BLOCK_REASONS = ("Time Off", "Break", "Training", "Travel", "Emergency")


def _assert_practitioner_exists(practitioner):
    if not practitioner or not frappe.db.exists("Healthcare Practitioner", practitioner):
        raise ApiError(Code.NOT_FOUND, _("Practitioner not found."))
    return practitioner


def _assert_may_manage(practitioner):
    """Day-to-day diary management: admin/reception for anyone, physician for self.

    Covers block_time / set_leave / clear_unavailability -- the front desk needs
    these to mark a doctor out sick or hold a slot, so reception is included.
    Mirrors the scoping used for appointments and encounters: a pure Physician
    is confined to their own record rather than the whole clinic's calendar.

    For the PERMANENT weekly pattern see _assert_may_set_hours() below.
    """
    _assert_practitioner_exists(practitioner)

    roles = set(frappe.get_roles())
    if roles & {"Administrator", "System Manager", "Healthcare Administrator", "Nursing User"}:
        return practitioner

    mine = current_practitioner()
    if mine and mine == practitioner:
        return practitioner

    raise ApiError(
        Code.FORBIDDEN, _("You may only manage your own schedule.")
    )


def _assert_may_set_hours(practitioner):
    """Stricter guard for changing a practitioner's contracted weekly hours.

    Blocking an afternoon or recording leave is routine front-desk work, but a
    doctor's permanent working pattern is a management decision -- so reception
    (Nursing User) is deliberately NOT included here, unlike _assert_may_manage.

    Allowed: Admin/System Manager/Healthcare Administrator for any practitioner,
    and a Physician for their own record only.
    """
    _assert_practitioner_exists(practitioner)

    roles = set(frappe.get_roles())
    if roles & {"Administrator", "System Manager", "Healthcare Administrator"}:
        return practitioner

    mine = current_practitioner()
    if mine and mine == practitioner:
        return practitioner

    raise ApiError(
        Code.FORBIDDEN,
        _("Only an administrator or the doctor can change weekly working hours."),
    )


def _clean_time(value, label):
    if not value:
        raise ApiError(Code.VALIDATION, _("{0} is required.").format(label))
    try:
        return get_time(value)
    except Exception:
        raise ApiError(Code.VALIDATION, _("{0} is not a valid time.").format(label))


def _clean_slots(raw):
    """Validate an incoming weekly pattern.

    Expects [{day, from_time, to_time, duration?}]. Rejects unknown weekdays,
    inverted ranges and same-day overlaps -- an overlapping pattern would make
    slot generation produce duplicate times.
    """
    if not isinstance(raw, (list, tuple)) or not raw:
        raise ApiError(Code.VALIDATION, _("At least one time slot is required."))

    cleaned = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise ApiError(Code.VALIDATION, _("Each time slot must be an object."))

        day = (entry.get("day") or "").strip().title()
        if day not in WEEKDAYS:
            raise ApiError(Code.VALIDATION, _("{0} is not a valid day.").format(day or "?"))

        start = _clean_time(entry.get("from_time"), _("Start time"))
        end = _clean_time(entry.get("to_time"), _("End time"))
        if end <= start:
            raise ApiError(
                Code.VALIDATION,
                _("{0}: end time must be after start time.").format(day),
            )

        duration = entry.get("duration")
        try:
            duration = int(duration) if duration else 0
        except (TypeError, ValueError):
            raise ApiError(Code.VALIDATION, _("Duration must be a whole number of minutes."))
        if duration < 0 or duration > 480:
            raise ApiError(Code.VALIDATION, _("Duration must be between 0 and 480 minutes."))

        slot = {
            "day": day,
            "from_time": str(start),
            "to_time": str(end),
            "duration": duration,
        }

        # Marley's PractitionerSchedule.validate() does
        #   `slots.get("maximum_appointments") > maximum_apps`
        # whenever a duration is set, which raises
        #   TypeError: '>' not supported between 'NoneType' and 'int'
        # if the field is left empty. It is not a required field and the desk UI
        # simply never leaves it null. Fill it with how many slots actually fit
        # in the window, which is both a correct value and keeps the check
        # satisfied.
        if duration:
            minutes = (
                datetime.combine(date.min, end) - datetime.combine(date.min, start)
            ).total_seconds() / 60
            slot["maximum_appointments"] = max(1, int(abs(minutes) // duration))

        cleaned.append(slot)

    by_day = {}
    for slot in cleaned:
        for other in by_day.setdefault(slot["day"], []):
            if slot["from_time"] < other["to_time"] and other["from_time"] < slot["to_time"]:
                raise ApiError(
                    Code.VALIDATION,
                    _("{0}: time slots overlap.").format(slot["day"]),
                )
        by_day[slot["day"]].append(slot)

    return sorted(cleaned, key=lambda s: (WEEKDAYS.index(s["day"]), s["from_time"]))


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
    """The practitioner's configured weekly working pattern, plus any leave."""
    _assert_practitioner_exists(practitioner)
    return _availability_payload(practitioner)


def _availability_payload(practitioner):
    """Shared by `availability` and the write endpoints, which echo the new state.

    A plain function, not the decorated endpoint: calling a @clinic_api view
    from inside another one re-enters the auth wrapper and clears the session.
    """
    doc = frappe.get_doc("Healthcare Practitioner", practitioner)
    out = []
    for row in (doc.get("practitioner_schedules") or []):
        if not row.schedule:
            continue
        sched = frappe.get_doc("Practitioner Schedule", row.schedule)
        out.append({
            "schedule": sched.name,
            "disabled": bool(sched.disabled),
            "slots": [
                {
                    "day": t.day,
                    "from_time": str(t.from_time),
                    "to_time": str(t.to_time),
                    "duration": t.get("duration") or 0,
                }
                for t in (sched.get("time_slots") or [])
            ],
        })

    return {
        "practitioner": practitioner,
        "schedules": out,
        "unavailability": _list_unavailability(practitioner),
        # Lets the client show or hide the edit affordances without guessing.
        # Two separate rights: day-to-day diary work (block time / leave), which
        # reception has, and rewriting the contracted weekly hours, which it does
        # not. Without the second flag the UI would offer reception an editor
        # whose save can only 403.
        "can_manage": _may_manage(practitioner),
        "can_set_hours": _may_set_hours(practitioner),
    }


def _may_manage(practitioner):
    try:
        _assert_may_manage(practitioner)
        return True
    except ApiError:
        return False


def _may_set_hours(practitioner):
    try:
        _assert_may_set_hours(practitioner)
        return True
    except ApiError:
        return False


def _list_unavailability(practitioner, include_past=False):
    """Submitted leave / blocked-time rows for this practitioner."""
    filters = {"type": "Unavailable", "docstatus": 1, "scope": practitioner}
    if not include_past:
        filters["end_date"] = [">=", getdate(nowdate())]

    rows = frappe.get_all(
        "Practitioner Availability",
        filters=filters,
        fields=[
            "name", "reason", "note", "start_date", "end_date",
            "start_time", "end_time", "duration",
        ],
        order_by="start_date asc, start_time asc",
        ignore_permissions=True,
    )
    from clinic_core.api.v1.slots import as_time

    day_start = get_time("00:00:00")
    day_end = get_time("23:59:00")

    for row in rows:
        # A row covering the whole clock on its dates is a leave day rather than
        # a block within a working day; the UI labels them differently.
        # `as_time` because MySQL TIME comes back as timedelta -- comparing the
        # stringified form silently never matches.
        try:
            row["full_day"] = (
                as_time(row["start_time"]) <= day_start
                and as_time(row["end_time"]) >= day_end
            )
        except Exception:
            row["full_day"] = False

        row["start_time"] = str(row["start_time"])
        row["end_time"] = str(row["end_time"])
        row["start_date"] = str(row["start_date"])
        row["end_date"] = str(row["end_date"]) if row["end_date"] else str(row["start_date"])
    return rows


@frappe.whitelist()
@clinic_api(roles=SCHEDULE_ROLES)
def set_schedule(practitioner, payload=None):
    """Replace a practitioner's weekly working pattern.

    Writes Marley's own Practitioner Schedule so the scheduler, the overlap
    checks and both booking flows see the change immediately.

    payload: { slots: [{day, from_time, to_time, duration?}], schedule_name? }

    The whole pattern is replaced rather than patched: a weekly timetable is
    edited as a whole, and a partial update has no obvious meaning when a day
    is removed.

    Permanent hours are a management decision: reception can block time and
    record leave, but cannot rewrite the weekly pattern.
    """
    _assert_may_set_hours(practitioner)

    data = parse_payload(payload)
    slots = _clean_slots(data.get("slots"))

    doc = frappe.get_doc("Healthcare Practitioner", practitioner)
    row = next((r for r in (doc.get("practitioner_schedules") or []) if r.schedule), None)
    existing = row.schedule if row else None

    # A Practitioner Schedule can be SHARED between practitioners (the seed data
    # puts every doctor on "Weekday 9to5"). Editing it in place would silently
    # rewrite a colleague's hours, so when it is shared this practitioner is
    # forked onto a private copy first.
    shared_with = 0
    if existing:
        shared_with = frappe.db.count(
            "Practitioner Service Unit Schedule",
            {"schedule": existing, "parenttype": "Healthcare Practitioner"},
        )

    if existing and shared_with <= 1:
        schedule = frappe.get_doc("Practitioner Schedule", existing)
    else:
        schedule = frappe.new_doc("Practitioner Schedule")
        schedule.schedule_name = _unique_schedule_name(
            data.get("schedule_name") or f"{practitioner} Schedule"
        )

    schedule.set("time_slots", [])
    for slot in slots:
        schedule.append("time_slots", slot)

    schedule.flags.ignore_permissions = True
    schedule.save()

    if schedule.name != existing:
        if row:
            row.schedule = schedule.name
        else:
            doc.append("practitioner_schedules", {"schedule": schedule.name})
        doc.flags.ignore_permissions = True
        doc.save()

    frappe.db.commit()
    return _availability_payload(practitioner)


def _unique_schedule_name(base):
    """Practitioner Schedule is autonamed from schedule_name, so it must be free."""
    base = (base or "Schedule").strip()[:120]
    name = base
    suffix = 2
    while frappe.db.exists("Practitioner Schedule", name):
        name = f"{base} {suffix}"[:140]
        suffix += 1
    return name


@frappe.whitelist()
@clinic_api(roles=SCHEDULE_ROLES)
def block_time(practitioner, payload=None):
    """Make a practitioner unavailable for part of a day (or a date range).

    payload: { date, from_time, to_time, end_date?, reason?, note? }

    Creates a submitted Practitioner Availability row of type "Unavailable" --
    Marley's own record. It validates overlaps itself and refuses to block a
    window that already holds appointments, which is exactly the behaviour we
    want; that refusal is surfaced as a 409.
    """
    _assert_may_manage(practitioner)
    data = parse_payload(payload)

    start_date = data.get("date") or data.get("start_date")
    if not start_date:
        raise ApiError(Code.VALIDATION, _("date is required."))
    start_date = getdate(start_date)
    end_date = getdate(data.get("end_date")) if data.get("end_date") else start_date
    if end_date < start_date:
        raise ApiError(Code.VALIDATION, _("End date must not be before the start date."))

    from_time = _clean_time(data.get("from_time"), _("Start time"))
    to_time = _clean_time(data.get("to_time"), _("End time"))
    if to_time <= from_time:
        raise ApiError(Code.VALIDATION, _("End time must be after start time."))

    reason = data.get("reason") or "Break"
    if reason not in BLOCK_REASONS:
        raise ApiError(
            Code.VALIDATION,
            _("Reason must be one of: {0}").format(", ".join(BLOCK_REASONS)),
        )

    return _create_unavailability(
        practitioner, start_date, end_date, str(from_time), str(to_time),
        reason, data.get("note"),
    )


@frappe.whitelist()
@clinic_api(roles=SCHEDULE_ROLES)
def set_leave(practitioner, payload=None):
    """Mark a practitioner on leave for one or more whole days.

    payload: { from_date, to_date?, reason?, note? }

    A whole-day block is the same Practitioner Availability record covering
    00:00-23:59, so the booking flow needs no separate concept of leave.
    """
    _assert_may_manage(practitioner)
    data = parse_payload(payload)

    start = data.get("from_date") or data.get("date")
    if not start:
        raise ApiError(Code.VALIDATION, _("from_date is required."))
    start_date = getdate(start)
    end_date = getdate(data.get("to_date")) if data.get("to_date") else start_date
    if end_date < start_date:
        raise ApiError(Code.VALIDATION, _("End date must not be before the start date."))

    reason = data.get("reason") or "Time Off"
    if reason not in BLOCK_REASONS:
        raise ApiError(
            Code.VALIDATION,
            _("Reason must be one of: {0}").format(", ".join(BLOCK_REASONS)),
        )

    return _create_unavailability(
        practitioner, start_date, end_date, "00:00:00", "23:59:00",
        reason, data.get("note"),
    )


def _create_unavailability(practitioner, start_date, end_date, from_time, to_time,
                           reason, note):
    doc = frappe.get_doc({
        "doctype": "Practitioner Availability",
        "type": "Unavailable",
        "status": "Active",
        "reason": reason,
        "scope_type": "Healthcare Practitioner",
        "scope": practitioner,
        "start_date": start_date,
        "end_date": end_date,
        "start_time": from_time,
        "end_time": to_time,
        "note": (note or "")[:500] or None,
    })

    try:
        doc.flags.ignore_permissions = True
        doc.insert()
        doc.submit()
    except frappe.ValidationError as e:
        frappe.db.rollback()
        from frappe.utils import strip_html

        raw = strip_html(str(e)) or ""
        lower = raw.lower()

        # Marley enforces two rules here, both of them correct. Its messages
        # carry HTML doc links and internal wording, so they are translated into
        # something a receptionist can act on.
        if "conflicts with existing patient appointment" in lower:
            raise ApiError(
                Code.CONFLICT,
                _("There are appointments booked in that time. "
                  "Move or cancel them first."),
            )
        if "must overlap" in lower:
            raise ApiError(
                Code.VALIDATION,
                _("That time is outside this doctor's working hours, "
                  "so there is nothing to block."),
            )
        if "overlaps with another" in lower:
            raise ApiError(
                Code.CONFLICT,
                _("That time is already blocked."),
            )
        raise ApiError(Code.VALIDATION, raw or _("Could not block this time."))

    frappe.db.commit()
    return {
        "name": doc.name,
        "practitioner": practitioner,
        "reason": doc.reason,
        "note": doc.note,
        "start_date": str(doc.start_date),
        "end_date": str(doc.end_date),
        "start_time": str(doc.start_time),
        "end_time": str(doc.end_time),
        "full_day": from_time <= "00:00:00" and to_time >= "23:59:00",
    }


@frappe.whitelist()
@clinic_api(roles=SCHEDULE_ROLES)
def clear_unavailability(name):
    """Remove a leave / blocked-time entry, freeing those slots again."""
    if not frappe.db.exists("Practitioner Availability", name):
        raise ApiError(Code.NOT_FOUND, _("Entry not found."))

    doc = frappe.get_doc("Practitioner Availability", name)
    _assert_may_manage(doc.scope)

    doc.flags.ignore_permissions = True
    if doc.docstatus == 1:
        doc.cancel()
    frappe.db.commit()
    return {"name": name, "practitioner": doc.scope, "cleared": True}


@frappe.whitelist()
@clinic_api()
def unavailability(practitioner, include_past=0):
    """Leave and blocked time for a practitioner."""
    _assert_practitioner_exists(practitioner)
    return {
        "practitioner": practitioner,
        "items": _list_unavailability(practitioner, include_past=bool(as_int(include_past, 0))),
    }
