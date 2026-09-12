"""
clinic_core.api.v1.slots

ONE slot derivation, shared by the staff and guest flows.

Marley's get_availability_data() returns the practitioner's *schedule windows*
(e.g. Thursday 09:00-17:00), not bookable times. Turning those into discrete
slots has to happen somewhere, and it must happen on the server: if each client
generated its own times, "available" would be a client opinion and two clients
would disagree about the same calendar.

Previously the guest flow derived slots here while the staff flow derived them
again in the mobile app (hooks/useStaffSlots.ts). Two mechanisms for one concept
is how the two views drift apart. This module is now the single implementation;
both `public.availability.slots` and `appointments.bookable_slots` call it.

It stays a *convenience view*: Marley's validate_overlaps() re-checks at insert
and raises OverlapError -> 409, so the booking decision is never taken here.
"""

from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import get_time, getdate, now_datetime

DEFAULT_SLOT_MINUTES = 30

# Never offer a slot starting sooner than this from now -- a slot 2 minutes out
# is not a real appointment.
MIN_LEAD_MINUTES = 30

# Statuses that still hold a slot. Cancelled / No Show free the time again.
OCCUPYING_STATUSES = ("Scheduled", "Open", "Checked In", "Closed")


def _elevated(fn):
    """Run one read as Administrator, then restore the caller.

    Scoped as tightly as possible: it wraps a single Marley slot computation
    whose *output* is reduced to free times before it reaches the caller.
    Nothing the elevated call reads is returned verbatim.

    Needed because a Guest cannot read Practitioner Schedule or Patient
    Appointment, so the raw call would return nothing at all for the public
    booking flow. Marley's get_availability_data() calls frappe.get_doc() and
    friends deep in its stack, so there is no per-document `ignore_permissions`
    hook to hang this on -- the user really does have to change.

    Restoring it is the delicate part. `frappe.set_user()` does NOT only set
    the username: it also resets `session.sid` to that username and clears
    `session.data`, the role-permission cache and the user-perm cache
    (frappe/__init__.py:382-395). So the obvious

        set_user("Administrator"); ...; set_user(original)

    puts the NAME back but leaves the session payload emptied. Frappe writes
    that emptied session back for the request, so on the next call it cannot
    resolve the user, treats them as a logged-out Website User, and returns a
    bare 403 "No App" -- for reads as well as writes -- until they log in again.

    That was BUG-01: one call to bookable_slots logged staff users out and
    broke appointment creation and rescheduling from the mobile app.

    `session.data` is the load-bearing part: restoring sid alone still
    reproduces the 403, and restoring data alone fixes it (verified by
    reverting each line independently against a live session). sid is restored
    too because set_user() corrupts it just as deliberately, and leaving a
    username where a token belongs is a trap for the next reader.
    """
    session = frappe.local.session
    original_user = session.user
    original_sid = session.sid
    original_data = session.data

    try:
        frappe.set_user("Administrator")
        raw = fn()
    finally:
        # Order matters: set_user() resets sid/data/caches, so it must run
        # BEFORE we put the real values back.
        frappe.set_user(original_user)
        session.sid = original_sid
        session.data = original_data

    if isinstance(raw, dict) and "success" in raw:
        return raw.get("data")
    return raw


def as_time(value):
    """Marley stores times as '9:00:00' (not zero padded) or as a timedelta."""
    if isinstance(value, timedelta):
        return (datetime.min + value).time()
    return get_time(value)


def _slot_minutes(avail_slot, appointment_type=None):
    """Slot length in minutes.

    Marley puts a per-slot `duration` on the schedule row when one is set (it is
    often 0, meaning "unset"). The fallback is Appointment Type.default_duration
    -- Healthcare Practitioner has no duration field in Marley 16.
    """
    for entry in avail_slot or []:
        duration = (entry.get("duration") if isinstance(entry, dict) else entry.get("duration")) or 0
        if duration:
            return int(duration)

    duration = frappe.db.get_value(
        "Appointment Type", appointment_type or {}, "default_duration"
    )
    return int(duration or DEFAULT_SLOT_MINUTES) or DEFAULT_SLOT_MINUTES


def _blocked_ranges(practitioner, date, minutes):
    """Datetime ranges the practitioner is NOT bookable in on this date.

    Two sources, both authoritative:

    1. Real appointments. Marley's slot_details["appointments"] is not usable
       for this -- it is scoped to a Healthcare Service Unit, so it comes back
       empty for ordinary consultations and every slot looks free. They are read
       directly instead.

    2. Practitioner Availability rows of type "Unavailable" (submitted). This is
       Marley's own leave / blocked-time record, which clinic_core writes via
       practitioners.block_time() and practitioners.set_leave().
    """
    ranges = []

    rows = frappe.get_all(
        "Patient Appointment",
        filters={
            "practitioner": practitioner,
            "appointment_date": date,
            "status": ["in", OCCUPYING_STATUSES],
        },
        fields=["appointment_time", "duration"],
        limit_page_length=0,
        ignore_permissions=True,
    )
    for appt in rows:
        start = appt.get("appointment_time")
        if not start:
            continue
        try:
            start_t = as_time(start)
        except Exception:
            continue
        dur = int(appt.get("duration") or minutes)
        base = datetime.combine(datetime.min.date(), start_t)
        ranges.append((base, base + timedelta(minutes=dur)))

    # Leave / blocked time. A row spans start_date..end_date; on any covered day
    # the start_time..end_time window is unavailable.
    for block in frappe.get_all(
        "Practitioner Availability",
        filters={
            "type": "Unavailable",
            "docstatus": 1,
            "scope": practitioner,
            "start_date": ["<=", date],
            "end_date": [">=", date],
        },
        fields=["start_time", "end_time"],
        ignore_permissions=True,
    ):
        try:
            start_t = as_time(block.get("start_time"))
            end_t = as_time(block.get("end_time"))
        except Exception:
            continue
        ranges.append((
            datetime.combine(datetime.min.date(), start_t),
            datetime.combine(datetime.min.date(), end_t),
        ))

    return ranges


def compute_slots(practitioner, date=None, appointment_type=None):
    """Discrete bookable times for one practitioner on one date.

    Returns:
        { practitioner, practitioner_name, date, available,
          duration, slots: [{time, label, available}], message }

    `available: false` with an explanatory message is a NORMAL answer (the
    doctor does not work that day), not an error.
    """
    from clinic_core.api.v1.appointments import available_slots as staff_slots

    day = getdate(date) if date else getdate()
    practitioner_name = frappe.db.get_value(
        "Healthcare Practitioner", practitioner, "practitioner_name"
    )

    def _unavailable(message):
        return {
            "practitioner": practitioner,
            "practitioner_name": practitioner_name,
            "date": str(day),
            "available": False,
            "duration": DEFAULT_SLOT_MINUTES,
            "slots": [],
            "message": message,
        }

    # __wrapped__ is the undecorated function: it skips clinic_api's
    # require_login, which is deliberate. The guard belongs to the CALLER --
    # public_api for guests, clinic_api for staff -- and has already run.
    try:
        payload = _elevated(
            lambda: staff_slots.__wrapped__(practitioner=practitioner, date=str(day))
        )
    except frappe.ValidationError as e:
        # Marley throws for "not available on <weekday>", holidays and leave.
        # That is an answer, not a failure.
        from frappe.utils import strip_html

        return _unavailable(strip_html(str(e)) or _("The doctor is not available on this date."))

    if not payload or not payload.get("available"):
        return _unavailable(
            (payload or {}).get("message") or _("The doctor is not available on this date.")
        )

    earliest = None
    if day == getdate():
        lead = now_datetime() + timedelta(minutes=MIN_LEAD_MINUTES)
        earliest = datetime.combine(datetime.min.date(), lead.time())

    times, minutes = [], DEFAULT_SLOT_MINUTES
    for detail in payload.get("slot_details") or []:
        minutes = _slot_minutes(detail.get("avail_slot"), appointment_type)
        taken = _blocked_ranges(practitioner, day, minutes)

        for window in detail.get("avail_slot") or []:
            try:
                start_t = as_time(window.get("from_time"))
                end_t = as_time(window.get("to_time"))
            except Exception:
                continue

            cursor = datetime.combine(datetime.min.date(), start_t)
            window_end = datetime.combine(datetime.min.date(), end_t)

            while cursor + timedelta(minutes=minutes) <= window_end:
                slot_end = cursor + timedelta(minutes=minutes)
                overlapped = any(s < slot_end and cursor < e for s, e in taken)
                too_soon = earliest is not None and cursor < earliest

                if not overlapped and not too_soon:
                    times.append(cursor.strftime("%H:%M:%S"))
                cursor = slot_end

    times = sorted(set(times))
    return {
        "practitioner": practitioner,
        "practitioner_name": practitioner_name,
        "date": str(day),
        "available": bool(times),
        "duration": minutes,
        "slots": [
            {
                "time": t,
                "label": datetime.strptime(t, "%H:%M:%S").strftime("%I:%M %p").lstrip("0"),
                "available": True,
            }
            for t in times
        ],
        "message": None if times else _("No times are available on this date."),
    }


def working_days(practitioner, start_date=None, limit=14):
    """Which of the next N days the practitioner works -- powers the date strip.

    Deliberately cheap: it reports configured working weekdays minus any FULL-day
    unavailability, so a date picker can grey out days without running a full
    slot computation per day.
    """
    from frappe.utils import add_days

    begin = getdate(start_date) if start_date else getdate()
    try:
        span = max(1, min(int(limit), 31))
    except (TypeError, ValueError):
        span = 14

    schedules = frappe.get_all(
        "Practitioner Service Unit Schedule",
        filters={"parent": practitioner},
        fields=["schedule"],
        ignore_permissions=True,
    )
    working = set()
    for row in schedules:
        for slot in frappe.get_all(
            "Healthcare Schedule Time Slot",
            filters={"parent": row["schedule"]},
            fields=["day"],
            ignore_permissions=True,
        ):
            if slot.get("day"):
                working.add(slot["day"])

    if not working:
        return None  # caller decides how to report "no published schedule"

    # Days fully covered by an Unavailable block are not offered at all.
    #
    # Compare times as time objects: Marley hands these back as timedelta (the
    # MySQL TIME representation), so a string comparison silently never matches
    # and every leave day stayed bookable.
    day_start = get_time("00:00:00")
    day_end = get_time("23:59:00")

    blocked_dates = set()
    for block in frappe.get_all(
        "Practitioner Availability",
        filters={"type": "Unavailable", "docstatus": 1, "scope": practitioner},
        fields=["start_date", "end_date", "start_time", "end_time"],
        ignore_permissions=True,
    ):
        try:
            covers_whole_day = (
                as_time(block["start_time"]) <= day_start
                and as_time(block["end_time"]) >= day_end
            )
        except Exception:
            covers_whole_day = False
        if not covers_whole_day:
            continue
        cursor = getdate(block["start_date"])
        last = getdate(block["end_date"] or block["start_date"])
        while cursor <= last:
            blocked_dates.add(cursor)
            cursor = getdate(add_days(cursor, 1))

    out = []
    for offset in range(span):
        day = getdate(add_days(begin, offset))
        weekday = day.strftime("%A")
        out.append(
            {
                "date": str(day),
                "weekday": weekday,
                "day_label": day.strftime("%a").upper(),
                "day_number": day.strftime("%d"),
                "available": weekday in working and day not in blocked_dates,
            }
        )
    return out
