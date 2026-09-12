"""One-off maintenance helpers, run with `bench execute`.

Not API endpoints and deliberately not whitelisted: these are operator tools for
a dev site, invoked as

    bench --site clinic.localhost execute clinic_core.maintenance.<fn>

They exist because Practitioner Availability rows created by the test suite
cannot be rolled back -- clinic_core commits after submit() so the booking flows
see the change, and submit() commits regardless -- so a dev site accumulates
them until they block every near-term working day.

The tests now clean up after themselves (SchedulingBase._cleanup_unavailability);
this clears what earlier runs already left behind.
"""

import frappe
from frappe.utils import getdate, nowdate

# Notes written by the scheduling tests.
TEST_NOTES = ("regression test",)

# Only a minority of the leaked rows carry a note, so the note alone is not
# enough to identify residue. What every one of them DOES have is an owner that
# is a seeded test account: the suite runs as these users and nobody else does.
# That is the discriminator -- a row owned by a real clinic account is never
# touched, whatever its note says.
TEST_OWNERS = (
    "admin.clinic@test.local",
    "reception@test.local",
    "doctor@test.local",
    "doctor2@test.local",
)


def report_unavailability():
    """Print every Unavailable row, flagging the ones that look like residue."""
    rows = frappe.get_all(
        "Practitioner Availability",
        filters={"type": "Unavailable"},
        fields=[
            "name", "scope", "reason", "note", "start_date", "end_date",
            "start_time", "end_time", "docstatus", "owner", "creation",
        ],
        order_by="creation asc",
    )

    today = getdate(nowdate())
    residue = future = 0
    for row in rows:
        is_residue = (row.get("note") or "") in TEST_NOTES
        residue += is_residue
        if getdate(row["end_date"] or row["start_date"]) >= today:
            future += 1
        print(
            f"{row['name']} | {row['scope']} | {row['reason']} | "
            f"{row['start_date']}..{row['end_date']} | "
            f"{row['start_time']}-{row['end_time']} | ds={row['docstatus']} | "
            f"{row['owner']} | {row['creation']}"
            + ("  <-- test residue" if is_residue else "")
        )

    print(f"\ntotal={len(rows)} tagged_residue={residue} future_dated={future}")
    return {"total": len(rows), "residue": residue, "future": future}


def report_schedules():
    """Print each practitioner's weekly pattern and who else shares it."""
    for prac in frappe.get_all("Healthcare Practitioner", pluck="name"):
        doc = frappe.get_doc("Healthcare Practitioner", prac)
        rows = [r for r in (doc.get("practitioner_schedules") or []) if r.schedule]
        if not rows:
            print(f"{prac}: NO SCHEDULE")
            continue
        for row in rows:
            sched = frappe.get_doc("Practitioner Schedule", row.schedule)
            shared = frappe.db.count(
                "Practitioner Service Unit Schedule",
                {"schedule": sched.name, "parenttype": "Healthcare Practitioner"},
            )
            days = ", ".join(
                f"{t.day} {t.from_time}-{t.to_time}"
                for t in (sched.get("time_slots") or [])
            ) or "(no time slots)"
            print(f"{prac}: [{sched.name}] shared_with={shared} disabled={sched.disabled}")
            print(f"    {days}")


def restore_seed_schedule(dry_run=1):
    """Put the seeded "Weekday 9to5" schedule back to Mon-Fri 09:00-17:00.

    A run of the scheduling suite from BEFORE set_schedule() learned to fork a
    shared schedule rewrote this one in place, leaving it on the Mon/Tue pattern
    those tests write. Both seeded doctors shared it, so Dr Test Doctor silently
    lost Wed/Thu/Fri -- which is why test_public_booking then failed with
    "not available on Friday" for any run landing on one of those days.

    set_schedule() no longer does this (it forks onto a private copy when the
    schedule is shared, and test_scheduling covers that), so this repairs the
    stale damage rather than papering over a live bug. seed.py cannot: it
    returns early when the schedule already exists.
    """
    from clinic_core.seed import SCHEDULE

    dry = str(dry_run) not in ("0", "False", "false")
    want = [
        {"day": day, "from_time": "09:00:00", "to_time": "17:00:00"}
        for day in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
    ]

    if not frappe.db.exists("Practitioner Schedule", SCHEDULE):
        print(f"{SCHEDULE} does not exist -- run seed.py instead")
        return {"restored": False}

    doc = frappe.get_doc("Practitioner Schedule", SCHEDULE)
    current = [
        f"{t.day} {t.from_time}-{t.to_time}" for t in (doc.get("time_slots") or [])
    ]
    print(f"current: {', '.join(current) or '(none)'}")
    wanted = ", ".join("{0} 9:00:00-17:00:00".format(s["day"]) for s in want)
    print(f"wanted : {wanted}")

    if dry:
        print("\ndry run -- pass dry_run=0 to apply")
        return {"restored": False, "dry_run": True}

    doc.set("time_slots", [])
    for slot in want:
        doc.append("time_slots", slot)
    doc.flags.ignore_permissions = True
    doc.save()
    frappe.db.commit()
    print(f"\nrestored {SCHEDULE} to Mon-Fri 09:00-17:00")
    return {"restored": True, "dry_run": False}


def purge_test_unavailability(dry_run=1):
    """Cancel and delete Practitioner Availability rows left by the test suite.

    Scoped by OWNER: only rows created by a seeded test account (TEST_OWNERS).
    A row owned by a real clinic user is never matched -- deleting genuine leave
    to tidy a dev site would be far worse than leaving a stray row behind.

    Defaults to a dry run. Pass dry_run=0 to actually delete:
        bench --site clinic.localhost execute \
            clinic_core.maintenance.purge_test_unavailability --kwargs "{'dry_run': 0}"
    """
    dry = str(dry_run) not in ("0", "False", "false")

    rows = frappe.get_all(
        "Practitioner Availability",
        filters={"type": "Unavailable", "owner": ["in", list(TEST_OWNERS)]},
        fields=["name", "scope", "start_date", "end_date", "docstatus", "owner"],
        order_by="creation asc",
    )

    if not rows:
        print("nothing to purge")
        return {"deleted": 0, "failed": 0, "dry_run": dry}

    deleted = failed = 0
    for row in rows:
        label = f"{row['name']} ({row['scope']} {row['start_date']}..{row['end_date']})"
        if dry:
            print(f"WOULD DELETE {label}")
            continue
        try:
            doc = frappe.get_doc("Practitioner Availability", row["name"])
            doc.flags.ignore_permissions = True
            # A submitted document cannot be deleted while docstatus is 1.
            if doc.docstatus == 1:
                doc.cancel()
            doc.delete(ignore_permissions=True)
            frappe.db.commit()
            deleted += 1
            print(f"deleted {label}")
        except Exception as exc:
            # One bad row must not strand the rest.
            frappe.db.rollback()
            failed += 1
            print(f"FAILED  {label}: {exc}")

    print(f"\ndry_run={dry} deleted={deleted} failed={failed} matched={len(rows)}")
    return {"deleted": deleted, "failed": failed, "dry_run": dry}
