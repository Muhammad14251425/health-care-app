"""
Tests for practitioner scheduling (QA baseline BUG-04) and the unified slot
derivation (BUG-05).

BUG-04 (P2): requirement 3 is "availability AND scheduling", but mobile was
display-only -- clinic_core exposed no way to edit a weekly pattern, block a
time range, or record leave, so the brief's blocked-time and leave tests could
not even be attempted.

BUG-05 (P2): `appointments.available_slots` returned Marley's raw schedule
WINDOWS with a service-unit-scoped `appointments[]` that is empty for ordinary
consultations. The staff client derived bookable times itself while the guest
flow derived them server-side -- two mechanisms for one concept.

Everything is written through Marley's own doctypes (Practitioner Schedule,
Practitioner Availability) so the scheduler and both booking flows see it.

Run:
    bench --site clinic.localhost run-tests --app clinic_core \
        --module clinic_core.tests.test_scheduling
"""

import frappe
import unittest
from frappe.utils import add_days, getdate, nowdate

from clinic_core.api.v1 import appointments, practitioners
from clinic_core.api.v1.public import availability as public_availability

ADMIN_USER = "admin.clinic@test.local"
RECEPTION_USER = "reception@test.local"
DOCTOR_USER = "doctor@test.local"
DOCTOR2_USER = "doctor2@test.local"


def _ok(response):
    return bool(response) and response.get("success") is True


def _data(response):
    return (response or {}).get("data") or {}


def _code(response):
    return ((response or {}).get("error") or {}).get("code")


class SchedulingBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        cls.prac = frappe.db.get_value(
            "Healthcare Practitioner", {"user_id": DOCTOR_USER}, "name"
        )
        cls.prac2 = frappe.db.get_value(
            "Healthcare Practitioner", {"user_id": DOCTOR2_USER}, "name"
        )
        assert cls.prac and cls.prac2, "seed data missing: two practitioners"

    def setUp(self):
        frappe.set_user("Administrator")
        # Practitioner Availability rows created during a test cannot be rolled
        # back: clinic_core commits after submit() so the booking flows see the
        # change, and submit() itself commits. They are therefore tracked and
        # deleted explicitly. Without this the rows accumulate on the dev site
        # and progressively block every near-term working day, at which point
        # the leave tests skip rather than run.
        self._created_unavailability = set()

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup_unavailability()
        frappe.db.rollback()

    def _track(self, response):
        """Remember a created Practitioner Availability so tearDown removes it.

        Takes the raw API response and returns it unchanged, so a call site can
        simply wrap: `res = self._track(practitioners.set_leave(...))`.
        """
        name = _data(response).get("name")
        if name:
            self._created_unavailability.add(name)
        return response

    def _cleanup_unavailability(self):
        """Cancel-then-delete every row this test created.

        A submitted document cannot be deleted while docstatus is 1, so it is
        cancelled first. Each row is handled in its own try/except: one failure
        (already cancelled, already gone) must not strand the rest.
        """
        for name in sorted(self._created_unavailability):
            try:
                if not frappe.db.exists("Practitioner Availability", name):
                    continue
                doc = frappe.get_doc("Practitioner Availability", name)
                doc.flags.ignore_permissions = True
                if doc.docstatus == 1:
                    doc.cancel()
                doc.delete(ignore_permissions=True)
            except Exception:
                frappe.db.rollback()
        frappe.db.commit()
        self._created_unavailability.clear()

    def _next_working_day(self, practitioner):
        """A date the practitioner works and that has free slots."""
        frappe.set_user(ADMIN_USER)
        for offset in range(1, 21):
            day = str(getdate(add_days(nowdate(), offset)))
            res = appointments.bookable_slots(practitioner, day)
            if _ok(res) and _data(res).get("available"):
                return day, _data(res)
        self.skipTest("no bookable day found in the next 3 weeks")

    def _blockable_window(self, slot_payload):
        """A free slot and the window covering exactly it.

        The window must (a) overlap the working pattern, or Marley refuses it as
        meaningless, and (b) contain no booked appointment, or Marley refuses it
        to avoid orphaning patients. A slot the API just reported as free
        satisfies both, so the block is aligned to that slot rather than to a
        whole clock hour -- 09:30 can be free while 09:00 is taken.

        Returns (slot_time, from_time, to_time).
        """
        slots = slot_payload.get("slots", [])
        minutes = int(slot_payload.get("duration") or 30)
        for entry in slots:
            start = entry["time"]
            h, m, _s = (int(part) for part in start.split(":"))
            end_total = h * 60 + m + minutes
            if end_total >= 24 * 60:
                continue
            end = f"{end_total // 60:02d}:{end_total % 60:02d}:00"
            return start, start, end
        self.skipTest("no free slot to block")

    def _free_working_day(self):
        """A working day with NO appointments booked on it.

        Whole-day leave is refused by Marley when appointments already exist in
        the window -- correctly, so patients are not orphaned. Tests that need
        leave to SUCCEED therefore need a genuinely empty day.

        A dev site accumulates bookings on every near-term working day, so
        rather than skipping, any appointments found on the chosen day are
        cancelled inside the test transaction. tearDown rolls that back.
        """
        frappe.set_user(ADMIN_USER)
        for offset in range(1, 28):
            day = str(getdate(add_days(nowdate(), offset)))
            res = appointments.bookable_slots(self.prac, day)
            if not (_ok(res) and _data(res).get("available")):
                continue

            booked = frappe.get_all("Patient Appointment", filters={
                "practitioner": self.prac,
                "appointment_date": day,
                "status": ["not in", ["Cancelled"]],
            }, pluck="name")
            for name in booked:
                frappe.db.set_value("Patient Appointment", name, "status", "Cancelled")
            return day
        self.skipTest("no working day found in the next 4 weeks")


class TestUnifiedSlots(SchedulingBase):
    """BUG-05: staff and guests must read the same calendar."""

    def test_staff_and_public_slots_are_identical(self):
        day, staff = self._next_working_day(self.prac)

        frappe.set_user("Guest")
        pub = _data(public_availability.slots(self.prac, day))

        self.assertEqual(
            [s["time"] for s in staff["slots"]],
            [s["time"] for s in pub["slots"]],
            "staff and guest slot lists diverged",
        )
        self.assertEqual(staff["duration"], pub["duration"])

    def test_staff_and_public_working_days_agree(self):
        frappe.set_user(ADMIN_USER)
        staff = _data(appointments.working_days(self.prac, limit=14))
        frappe.set_user("Guest")
        pub = _data(public_availability.days(self.prac, limit=14))

        self.assertEqual(
            [d["available"] for d in staff["days"]],
            [d["available"] for d in pub["days"]],
        )

    def test_bookable_slots_requires_authentication(self):
        frappe.set_user("Guest")
        self.assertFalse(_ok(appointments.bookable_slots(self.prac)))

    def test_unknown_practitioner_is_not_found(self):
        frappe.set_user(ADMIN_USER)
        res = appointments.bookable_slots("No Such Doctor")
        self.assertFalse(_ok(res))
        self.assertEqual(_code(res), "NOT_FOUND")


class TestBlockedTime(SchedulingBase):
    """BUG-04: blocking part of a working day removes exactly those slots."""

    def test_blocking_removes_slots_for_staff_and_guests(self):
        day, before = self._next_working_day(self.prac)
        window, start, end = self._blockable_window(before)
        frappe.set_user(ADMIN_USER)
        created = self._track(practitioners.block_time(self.prac, payload={
            "date": day, "from_time": start, "to_time": end,
            "reason": "Break", "note": "regression test",
        }))
        self.assertTrue(_ok(created), f"block failed: {created}")

        after = _data(appointments.bookable_slots(self.prac, day))
        self.assertNotIn(window, [s["time"] for s in after["slots"]],
                         "blocked slot still offered to staff")

        frappe.set_user("Guest")
        pub = _data(public_availability.slots(self.prac, day))
        self.assertNotIn(window, [s["time"] for s in pub["slots"]],
                         "blocked slot still offered to guests")

    def test_clearing_a_block_restores_the_slots(self):
        day, before = self._next_working_day(self.prac)
        window, start, end = self._blockable_window(before)

        frappe.set_user(ADMIN_USER)
        created = _data(self._track(practitioners.block_time(self.prac, payload={
            "date": day, "from_time": start, "to_time": end,
        })))
        cleared = practitioners.clear_unavailability(created["name"])
        self.assertTrue(_ok(cleared))

        after = _data(appointments.bookable_slots(self.prac, day))
        self.assertIn(window, [s["time"] for s in after["slots"]])

    def test_block_outside_working_hours_is_refused(self):
        """Blocking time the doctor never works is meaningless -- Marley agrees."""
        day, _slots = self._next_working_day(self.prac)
        frappe.set_user(ADMIN_USER)
        res = practitioners.block_time(self.prac, payload={
            "date": day, "from_time": "03:00:00", "to_time": "04:00:00",
        })
        self.assertFalse(_ok(res))
        self.assertEqual(_code(res), "VALIDATION_ERROR")

    def test_inverted_range_is_refused(self):
        day, _slots = self._next_working_day(self.prac)
        frappe.set_user(ADMIN_USER)
        res = practitioners.block_time(self.prac, payload={
            "date": day, "from_time": "15:00:00", "to_time": "14:00:00",
        })
        self.assertFalse(_ok(res))
        self.assertEqual(_code(res), "VALIDATION_ERROR")

    def test_unknown_reason_is_refused(self):
        day, _slots = self._next_working_day(self.prac)
        frappe.set_user(ADMIN_USER)
        res = practitioners.block_time(self.prac, payload={
            "date": day, "from_time": "11:00:00", "to_time": "12:00:00",
            "reason": "Bogus",
        })
        self.assertFalse(_ok(res))
        self.assertEqual(_code(res), "VALIDATION_ERROR")


class TestLeave(SchedulingBase):
    """BUG-04: a leave day offers no slots at all, to anyone."""

    def test_leave_day_has_no_slots(self):
        day = self._free_working_day()

        frappe.set_user(ADMIN_USER)
        created = self._track(practitioners.set_leave(self.prac, payload={
            "from_date": day, "reason": "Time Off", "note": "regression test",
        }))
        self.assertTrue(_ok(created), f"leave failed: {created}")
        self.assertTrue(_data(created)["full_day"])

        after = _data(appointments.bookable_slots(self.prac, day))
        self.assertFalse(after["available"], "slots offered on a leave day")

        frappe.set_user("Guest")
        pub = _data(public_availability.slots(self.prac, day))
        self.assertFalse(pub["available"], "guest offered slots on a leave day")

    def test_leave_day_is_greyed_out_in_the_date_strip(self):
        day = self._free_working_day()
        frappe.set_user(ADMIN_USER)
        created = self._track(practitioners.set_leave(self.prac, payload={"from_date": day}))
        self.assertTrue(_ok(created), f"leave failed: {created}")

        days = _data(appointments.working_days(self.prac, limit=28))["days"]
        row = next((d for d in days if d["date"] == day), None)
        self.assertIsNotNone(row)
        self.assertFalse(row["available"])

    def test_end_before_start_is_refused(self):
        frappe.set_user(ADMIN_USER)
        res = practitioners.set_leave(self.prac, payload={
            "from_date": str(getdate(add_days(nowdate(), 5))),
            "to_date": str(getdate(add_days(nowdate(), 2))),
        })
        self.assertFalse(_ok(res))
        self.assertEqual(_code(res), "VALIDATION_ERROR")

    def test_leave_is_refused_when_appointments_exist(self):
        """Booked patients must not be silently orphaned by a leave day."""
        day = self._free_working_day()
        slots = _data(appointments.bookable_slots(self.prac, day))["slots"]
        patient = frappe.db.get_value("Patient", {"status": "Active"}, "name")
        if not patient or not slots:
            self.skipTest("no patient or slot available")

        # Book one appointment so there is something to protect.
        frappe.set_user(ADMIN_USER)
        booked = appointments.create_appointment(payload={
            "patient": patient,
            "practitioner": self.prac,
            "appointment_date": day,
            "appointment_time": slots[0]["time"],
        })
        self.assertTrue(_ok(booked), f"setup booking failed: {booked}")

        res = practitioners.set_leave(self.prac, payload={"from_date": day})
        self.assertFalse(_ok(res), "leave wiped out a booked appointment")
        self.assertEqual(_code(res), "CONFLICT")


class TestScheduleEditing(SchedulingBase):
    """BUG-04: the weekly working pattern is editable and persists."""

    def test_admin_can_replace_the_weekly_pattern(self):
        frappe.set_user(ADMIN_USER)
        res = practitioners.set_schedule(self.prac2, payload={"slots": [
            {"day": "Monday", "from_time": "09:00:00", "to_time": "13:00:00", "duration": 30},
            {"day": "Monday", "from_time": "14:00:00", "to_time": "17:00:00", "duration": 30},
            {"day": "Tuesday", "from_time": "09:00:00", "to_time": "17:00:00", "duration": 30},
        ]})
        self.assertTrue(_ok(res), f"set_schedule failed: {res}")

        slots = _data(res)["schedules"][0]["slots"]
        self.assertEqual(len(slots), 3)
        self.assertFalse([s for s in slots if s["day"] == "Wednesday"])

        # And it is what a fresh read returns.
        again = _data(practitioners.availability(self.prac2))
        self.assertEqual(len(again["schedules"][0]["slots"]), 3)

    def test_removed_day_stops_being_offered(self):
        frappe.set_user(ADMIN_USER)
        practitioners.set_schedule(self.prac2, payload={"slots": [
            {"day": "Monday", "from_time": "09:00:00", "to_time": "17:00:00"},
        ]})

        days = _data(appointments.working_days(self.prac2, limit=14))["days"]
        for row in days:
            if row["weekday"] != "Monday":
                self.assertFalse(
                    row["available"], f"{row['weekday']} still offered after removal"
                )

    def test_availability_reports_whether_the_caller_may_edit(self):
        frappe.set_user(ADMIN_USER)
        self.assertTrue(_data(practitioners.availability(self.prac))["can_manage"])

        frappe.set_user(DOCTOR2_USER)
        self.assertFalse(_data(practitioners.availability(self.prac))["can_manage"])

    def test_invalid_patterns_are_refused(self):
        frappe.set_user(ADMIN_USER)
        cases = {
            "unknown day": [{"day": "Funday", "from_time": "09:00:00", "to_time": "17:00:00"}],
            "inverted": [{"day": "Monday", "from_time": "17:00:00", "to_time": "09:00:00"}],
            "overlapping": [
                {"day": "Monday", "from_time": "09:00:00", "to_time": "13:00:00"},
                {"day": "Monday", "from_time": "12:00:00", "to_time": "15:00:00"},
            ],
            "empty": [],
            "bad time": [{"day": "Monday", "from_time": "nope", "to_time": "17:00:00"}],
        }
        for label, slots in cases.items():
            res = practitioners.set_schedule(self.prac2, payload={"slots": slots})
            self.assertFalse(_ok(res), f"{label} was accepted")
            self.assertEqual(_code(res), "VALIDATION_ERROR", label)


class TestSchedulePermissions(SchedulingBase):
    """Who may change whose calendar."""

    def test_doctor_cannot_edit_another_doctors_schedule(self):
        frappe.set_user(DOCTOR2_USER)
        res = practitioners.set_schedule(self.prac, payload={"slots": [
            {"day": "Monday", "from_time": "09:00:00", "to_time": "17:00:00"},
        ]})
        self.assertFalse(_ok(res))
        self.assertEqual(_code(res), "FORBIDDEN")

    def test_doctor_cannot_block_another_doctors_time(self):
        day, slots = self._next_working_day(self.prac)
        _w, start, end = self._blockable_window(slots)
        frappe.set_user(DOCTOR2_USER)
        res = practitioners.block_time(self.prac, payload={
            "date": day, "from_time": start, "to_time": end,
        })
        self.assertFalse(_ok(res))
        self.assertEqual(_code(res), "FORBIDDEN")

    def test_doctor_can_manage_their_own_calendar(self):
        day, slots = self._next_working_day(self.prac)
        window, start, end = self._blockable_window(slots)

        frappe.set_user(DOCTOR_USER)
        res = self._track(practitioners.block_time(self.prac, payload={
            "date": day, "from_time": start, "to_time": end,
            "reason": "Training",
        }))
        self.assertTrue(_ok(res), f"doctor could not block own time: {res}")

    def test_reception_may_manage_the_front_desk_calendar(self):
        day, slots = self._next_working_day(self.prac)
        window, start, end = self._blockable_window(slots)

        frappe.set_user(RECEPTION_USER)
        res = self._track(practitioners.block_time(self.prac, payload={
            "date": day, "from_time": start, "to_time": end,
        }))
        self.assertTrue(_ok(res), f"reception could not block: {res}")

    def test_guest_cannot_change_anything(self):
        frappe.set_user("Guest")
        self.assertFalse(_ok(practitioners.set_schedule(self.prac, payload={"slots": [
            {"day": "Monday", "from_time": "09:00:00", "to_time": "17:00:00"},
        ]})))
        self.assertFalse(_ok(practitioners.set_leave(self.prac, payload={
            "from_date": str(getdate(add_days(nowdate(), 3))),
        })))
