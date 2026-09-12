"""
Regression tests for the four bugs found in the 2026-09-10 mobile QA audit.

BUG-01 (P1): `appointments.bookable_slots` destroyed the caller's session.
    `slots._elevated()` switched to Administrator and switched back with
    `frappe.set_user(original)` -- but set_user() also overwrites session.sid
    with the username and clears session.data, so the caller's real session
    token was lost. Every later request in that session, reads included,
    then failed with a bare 403 "No App". The mobile booking screen loads
    slots before it submits, so staff booking and rescheduling were broken.

BUG-02 (P2): `patients.list_patients` counted with frappe.db.count(filters),
    which ignores or_filters -- so a search reported the total number of
    active patients instead of the number of matches. The mobile list shows
    that number and uses it to decide whether more pages exist, so it also
    requested a page that could only come back empty.

BUG-03 (P3): the detail endpoints were wider than the lists that feed them.
    A physician scoped out of a colleague's appointments in list_appointments
    could still read one by ID, and a doctor with no billing access (403 on
    list_invoices) could still read any invoice through get_invoice.

BUG-04 (policy): reception could rewrite a doctor's contracted weekly hours.
    Day-to-day diary work (block time, leave) stays with the front desk;
    changing permanent hours is now admin-or-the-doctor only.

Run:
    bench --site clinic.localhost run-tests --app clinic_core \
        --module clinic_core.tests.test_qa_regressions
"""

import frappe
import unittest
from frappe.utils import add_days, getdate

from clinic_core.api.v1 import appointments, invoices, patients, practitioners

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


class QaRegressionBase(unittest.TestCase):
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

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()


class TestBug01SessionSurvivesSlotComputation(QaRegressionBase):
    """The session must survive `bookable_slots`.

    These assert on the SEQUENCE, which is the part the pre-existing suite
    missed: every other test called bookable_slots as its last action, so a
    corrupted session was never observed.
    """

    def test_session_payload_survives_bookable_slots(self):
        """The session DATA must come back, not just the user name.

        This is the assertion that actually catches BUG-01. `session.data` is
        what Frappe writes back and reads on the next request; set_user() clears
        it, and an emptied payload is why the caller became an unauthenticated
        Website User and got 403 "No App" on everything afterwards.

        Verified to fail when the restore is removed. Note that asserting on
        session.user or session.sid does NOT catch it in-process: set_user()
        already sets sid to the username here, so both look unchanged either way.
        """
        frappe.set_user(ADMIN_USER)
        frappe.session.data["qa_regression_marker"] = "bug-01"
        before_user = frappe.session.user

        appointments.bookable_slots(practitioner=self.prac)

        self.assertEqual(
            frappe.session.user, before_user,
            "bookable_slots left the session pointing at a different user",
        )
        self.assertEqual(
            frappe.session.data.get("qa_regression_marker"), "bug-01",
            "bookable_slots discarded session.data -- this is BUG-01: the caller's "
            "session payload is cleared by set_user() and never restored, so every "
            "later request in that session fails with 403 'No App'",
        )

    def test_a_read_still_works_after_bookable_slots(self):
        frappe.set_user(ADMIN_USER)
        appointments.bookable_slots(practitioner=self.prac)

        res = patients.list_patients()
        self.assertTrue(
            _ok(res),
            "a plain read failed after bookable_slots -- the session was destroyed",
        )

    def test_the_full_mobile_booking_sequence_works(self):
        """slots -> create, in one session: exactly what appointment/new.tsx does."""
        frappe.set_user(ADMIN_USER)

        # Look ahead rather than using today: after the working day ends today
        # has no free slots, and this test would then SKIP -- silently not
        # covering the P1 it exists to catch. Scan forward for a day that does.
        slots, free = None, []
        for offset in range(0, 21):
            day = add_days(getdate(), offset)
            candidate = _data(
                appointments.bookable_slots(practitioner=self.prac, date=str(day))
            )
            times = [s["time"] for s in candidate.get("slots", []) if s.get("available")]
            if times:
                slots, free = candidate, times
                break

        self.assertTrue(
            free,
            "no bookable slot in the next 21 days -- the seed schedule is probably "
            "damaged; this test must not be allowed to skip quietly",
        )

        patient = frappe.db.get_value("Patient", {"patient_name": "Test Patient A"}, "name")
        res = appointments.create_appointment(payload={
            "patient": patient,
            "practitioner": self.prac,
            "appointment_date": slots["date"],
            "appointment_time": free[0],
        })
        self.assertTrue(
            _ok(res),
            f"booking failed after loading slots in the same session: {_code(res)}",
        )

    def test_every_staff_role_survives_it(self):
        for user in (ADMIN_USER, RECEPTION_USER, DOCTOR_USER):
            with self.subTest(user=user):
                frappe.set_user(user)
                frappe.session.data["qa_regression_marker"] = user
                appointments.bookable_slots(practitioner=self.prac)
                self.assertEqual(
                    frappe.session.data.get("qa_regression_marker"), user,
                    f"session payload lost for {user}",
                )
                self.assertTrue(_ok(patients.list_patients()))


class TestBug02SearchTotalRespectsTheFilter(QaRegressionBase):
    def test_total_matches_the_number_of_rows_for_a_narrow_search(self):
        frappe.set_user(ADMIN_USER)
        res = patients.list_patients(search="Test Patient A")
        data = _data(res)

        self.assertTrue(_ok(res))
        self.assertEqual(
            data["total"], len(data["items"]),
            "total ignored the search filter (BUG-02): the mobile list shows this "
            "number and uses it to decide whether to fetch another page",
        )

    def test_a_search_with_no_matches_totals_zero(self):
        frappe.set_user(ADMIN_USER)
        data = _data(patients.list_patients(search="zzz-no-such-patient-zzz"))

        self.assertEqual(data["items"], [])
        self.assertEqual(
            data["total"], 0,
            "an empty search still reported the full patient count",
        )

    def test_an_unfiltered_list_still_counts_everything(self):
        """The fix must not break the plain list, which has no or_filters."""
        frappe.set_user(ADMIN_USER)
        data = _data(patients.list_patients())
        expected = frappe.db.count("Patient", {"status": "Active"})
        self.assertEqual(data["total"], expected)


class TestBug03DetailEndpointsAreScopedLikeTheirLists(QaRegressionBase):
    def _an_appointment_for(self, practitioner):
        frappe.set_user(ADMIN_USER)
        name = frappe.db.get_value(
            "Patient Appointment", {"practitioner": practitioner}, "name"
        )
        if not name:
            self.skipTest(f"no appointment exists for {practitioner}")
        return name

    def test_a_doctor_cannot_read_another_doctors_appointment(self):
        target = self._an_appointment_for(self.prac)

        frappe.set_user(DOCTOR2_USER)
        res = appointments.get_appointment(appointment=target)
        self.assertEqual(
            _code(res), "FORBIDDEN",
            "the detail endpoint was wider than the list: doc2 is scoped out of "
            "doc1's appointments in list_appointments but could read one by ID, "
            "and IDs are sequential",
        )

    def test_a_doctor_can_still_read_their_own_appointment(self):
        target = self._an_appointment_for(self.prac)
        frappe.set_user(DOCTOR_USER)
        self.assertTrue(_ok(appointments.get_appointment(appointment=target)))

    def test_admin_and_reception_still_read_any_appointment(self):
        target = self._an_appointment_for(self.prac)
        for user in (ADMIN_USER, RECEPTION_USER):
            with self.subTest(user=user):
                frappe.set_user(user)
                self.assertTrue(_ok(appointments.get_appointment(appointment=target)))

    def test_a_doctor_cannot_read_an_invoice(self):
        frappe.set_user(ADMIN_USER)
        inv = frappe.db.get_value("Sales Invoice", {"docstatus": 1}, "name")
        if not inv:
            self.skipTest("no submitted invoice exists")

        frappe.set_user(DOCTOR_USER)
        res = invoices.get_invoice(invoice=inv)
        self.assertEqual(
            _code(res), "FORBIDDEN",
            "a physician is 403 on list_invoices but could read any invoice "
            "through get_invoice, which uses get_doc and skips the doctype check",
        )

    def test_billing_staff_still_read_invoices(self):
        frappe.set_user(ADMIN_USER)
        inv = frappe.db.get_value("Sales Invoice", {"docstatus": 1}, "name")
        if not inv:
            self.skipTest("no submitted invoice exists")

        for user in (ADMIN_USER, RECEPTION_USER):
            with self.subTest(user=user):
                frappe.set_user(user)
                self.assertTrue(_ok(invoices.get_invoice(invoice=inv)))


class TestBug04ReceptionCannotRewriteWeeklyHours(QaRegressionBase):
    """Reception keeps the diary; contracted hours are management-level.

    set_schedule is NOT called successfully anywhere here: it rewrites a shared
    Practitioner Schedule and cannot be rolled back, which is how an earlier
    test run silently wiped Wed-Fri from the seed data. Only refusals are
    asserted, plus the read-only capability flags.
    """

    def test_reception_is_refused(self):
        frappe.set_user(RECEPTION_USER)
        res = practitioners.set_schedule(
            practitioner=self.prac,
            payload={"slots": [{"day": "Monday", "from_time": "09:00:00",
                                "to_time": "17:00:00"}]},
        )
        self.assertEqual(_code(res), "FORBIDDEN")

    def test_a_doctor_is_refused_for_someone_else(self):
        frappe.set_user(DOCTOR2_USER)
        res = practitioners.set_schedule(
            practitioner=self.prac,
            payload={"slots": [{"day": "Monday", "from_time": "09:00:00",
                                "to_time": "17:00:00"}]},
        )
        self.assertEqual(_code(res), "FORBIDDEN")

    def test_capability_flags_distinguish_the_two_rights(self):
        expected = {
            # user: (can_manage, can_set_hours)
            ADMIN_USER: (True, True),
            RECEPTION_USER: (True, False),
            DOCTOR_USER: (True, True),
            DOCTOR2_USER: (False, False),
        }
        for user, (manage, hours) in expected.items():
            with self.subTest(user=user):
                frappe.set_user(user)
                data = _data(practitioners.availability(practitioner=self.prac))
                self.assertEqual(data.get("can_manage"), manage)
                self.assertEqual(
                    data.get("can_set_hours"), hours,
                    "the client gates the weekly-hours editor on can_set_hours; "
                    "a wrong value offers an editor whose save can only 403",
                )

    def test_reception_may_still_block_time(self):
        """The front desk must keep day-to-day diary control."""
        frappe.set_user(RECEPTION_USER)
        data = _data(practitioners.availability(practitioner=self.prac))
        self.assertTrue(
            data.get("can_manage"),
            "tightening weekly hours must not remove reception's ability to "
            "block time or record leave",
        )
