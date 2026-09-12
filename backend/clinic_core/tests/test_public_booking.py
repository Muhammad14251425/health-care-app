"""
Tests for the guest-reachable booking API (clinic_core.api.v1.public).

Two things are being proven here:

  1. The booking flow genuinely works for someone with no account.
  2. Opening that flow did NOT open anything else. Every protected surface is
     re-checked as a guest and must still refuse.

Run:
    bench --site clinic.localhost run-tests --app clinic_core \
        --module clinic_core.tests.test_public_booking
"""

import unittest

import frappe
from frappe.utils import add_days, getdate, nowdate

from clinic_core.api.response import ApiError, Code
from clinic_core.api.v1.public import availability, booking, departments, practitioners

PRACTITIONER = "Dr Test Doctor"

# Each test method books under its own number: booking.MAX_OPEN_PER_PHONE caps
# how many upcoming appointments one phone may hold, so a shared number would
# make tests fail on each other rather than on the code under test.
PHONE_PREFIX = "+92300999"
_phone_counter = iter(range(1000, 9999))


def next_test_phone():
    return f"{PHONE_PREFIX}{next(_phone_counter)}"


def call(fn, **kwargs):
    """Invoke an endpoint's undecorated body (skips rate limiting)."""
    return fn.__wrapped__(**kwargs)


def next_working_date():
    """A weekday within the seeded Mon-Fri schedule, always in the future."""
    day = getdate(add_days(nowdate(), 1))
    while day.strftime("%A") in ("Saturday", "Sunday"):
        day = getdate(add_days(day, 1))
    return day


class PublicApiBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        assert frappe.db.exists("Healthcare Practitioner", PRACTITIONER), \
            "seed data missing: Dr Test Doctor"
        cls.date = next_working_date()

    def setUp(self):
        self.phone = next_test_phone()
        # Every test runs as an unauthenticated visitor unless it says otherwise.
        frappe.set_user("Guest")

    def tearDown(self):
        # Bookings are committed (booking.create commits so Marley's overlap
        # check sees them), so a rollback is not enough -- delete explicitly.
        self._cleanup_phone()
        frappe.set_user("Administrator")
        frappe.db.rollback()

    def _cleanup_phone(self, phone=None):
        """Remove anything this test booked (appointments are looked up via the
        Patient record, since Patient Appointment carries no phone column)."""
        frappe.set_user("Administrator")
        numbers = [phone] if phone else [self.phone]
        patients = frappe.get_all(
            "Patient", filters={"mobile": ["in", numbers]}, pluck="name"
        )
        if not patients:
            return
        for appt in frappe.get_all(
            "Patient Appointment", filters={"patient": ["in", patients]}, pluck="name"
        ):
            frappe.delete_doc("Patient Appointment", appt, force=True, ignore_permissions=True)
        for patient in patients:
            try:
                frappe.delete_doc("Patient", patient, force=True, ignore_permissions=True)
            except Exception:
                pass  # a patient reused by another fixture is fine to leave
        frappe.db.commit()


# --------------------------------------------------------------------------- #
# The flow works for a guest
# --------------------------------------------------------------------------- #
class TestGuestCanBrowse(PublicApiBase):
    def test_guest_can_list_departments(self):
        result = call(departments.list_departments)
        self.assertTrue(result["items"], "guest should see bookable departments")
        # Only the two public keys, nothing internal.
        self.assertEqual(set(result["items"][0]), {"name", "label"})

    def test_guest_can_list_bookable_doctors(self):
        result = call(practitioners.list_practitioners)
        names = [d["name"] for d in result["items"]]
        self.assertIn(PRACTITIONER, names)

    def test_doctor_list_never_exposes_user_id_or_contacts(self):
        result = call(practitioners.list_practitioners)
        leaked = {"user_id", "email", "mobile", "phone", "user"}
        for doctor in result["items"]:
            self.assertFalse(
                leaked & set(doctor),
                f"public doctor payload leaked one of {leaked}: {set(doctor)}",
            )

    def test_guest_can_get_available_slots(self):
        result = call(availability.slots, practitioner=PRACTITIONER, date=str(self.date))
        self.assertTrue(result["available"], result.get("message"))
        self.assertTrue(result["slots"])
        self.assertEqual(set(result["slots"][0]), {"time", "label", "available"})

    def test_slots_report_unavailable_on_a_non_working_day(self):
        sunday = getdate(add_days(nowdate(), 1))
        while sunday.strftime("%A") != "Sunday":
            sunday = getdate(add_days(sunday, 1))
        result = call(availability.slots, practitioner=PRACTITIONER, date=str(sunday))
        # "Nothing free" is a valid answer, not an error.
        self.assertFalse(result["available"])
        self.assertEqual(result["slots"], [])
        self.assertTrue(result["message"])


class TestGuestCanBook(PublicApiBase):
    def _payload(self, **over):
        slots = call(availability.slots, practitioner=PRACTITIONER, date=str(self.date))
        data = {
            "first_name": "Ayesha",
            "last_name": "Malik",
            "phone": self.phone,
            "email": f"ayesha.{self.phone.strip('+')}@example.invalid",
            "practitioner": PRACTITIONER,
            "date": str(self.date),
            "time": slots["slots"][0]["time"],
            "reason": "Persistent cough",
        }
        data.update(over)
        return data

    def test_guest_can_create_a_valid_appointment(self):
        result = call(booking.create, payload=self._payload())

        self.assertTrue(result["reference"])
        self.assertEqual(result["patient_name"], "Ayesha Malik")
        self.assertTrue(frappe.db.exists("Patient Appointment", result["reference"]))

        # The response must not carry the internal patient id.
        self.assertNotIn("patient", result)

    def test_booking_creates_the_patient_record_server_side(self):
        result = call(booking.create, payload=self._payload())
        frappe.set_user("Administrator")
        patient = frappe.db.get_value("Patient Appointment", result["reference"], "patient")
        self.assertTrue(patient)
        self.assertEqual(
            frappe.db.get_value("Patient", patient, "mobile"), self.phone
        )

    def test_booking_never_provisions_a_login_account(self):
        """Marley invites new patients as portal Users by default.

        Left on, an anonymous form would be a User-creation endpoint (and would
        hard-fail whenever the address already belonged to somebody).
        """
        email = f"guest.{self.phone.strip('+')}@example.invalid"
        call(booking.create, payload=self._payload(email=email))

        frappe.set_user("Administrator")
        self.assertFalse(
            frappe.db.exists("User", {"email": email}),
            "public booking must not create a User account",
        )

    def test_same_person_rebooking_reuses_their_patient_record(self):
        first = call(booking.create, payload=self._payload())

        frappe.set_user("Administrator")
        patient_one = frappe.db.get_value("Patient Appointment", first["reference"], "patient")
        frappe.set_user("Guest")

        # The first booking consumed a slot, so re-read the list and take the
        # next free one.
        slots = call(availability.slots, practitioner=PRACTITIONER, date=str(self.date))
        second = call(booking.create, payload=self._payload(time=slots["slots"][0]["time"]))

        frappe.set_user("Administrator")
        patient_two = frappe.db.get_value("Patient Appointment", second["reference"], "patient")
        self.assertEqual(patient_one, patient_two, "an identical name+phone must not duplicate")


class TestBookingConflicts(PublicApiBase):
    def setUp(self):
        super().setUp()
        self.other_phone = next_test_phone()

    def tearDown(self):
        self._cleanup_phone(self.other_phone)
        super().tearDown()

    def test_guest_cannot_book_an_unavailable_slot(self):
        with self.assertRaises(ApiError) as caught:
            call(booking.create, payload={
                "first_name": "Ahmed", "last_name": "Raza", "phone": self.phone,
                "practitioner": PRACTITIONER, "date": str(self.date),
                "time": "03:00:00",  # outside the 09:00-17:00 schedule
            })
        self.assertEqual(caught.exception.code, Code.CONFLICT)

    def test_two_people_cannot_book_the_same_slot(self):
        slots = call(availability.slots, practitioner=PRACTITIONER, date=str(self.date))
        contested = slots["slots"][0]["time"]

        first = call(booking.create, payload={
            "first_name": "Ali", "last_name": "Khan", "phone": self.phone,
            "practitioner": PRACTITIONER, "date": str(self.date), "time": contested,
        })
        self.assertTrue(first["reference"])

        # A different person asks for the very same time.
        frappe.set_user("Guest")
        with self.assertRaises(ApiError) as caught:
            call(booking.create, payload={
                "first_name": "Sara", "last_name": "Ahmed", "phone": self.other_phone,
                "practitioner": PRACTITIONER, "date": str(self.date), "time": contested,
            })
        self.assertEqual(caught.exception.code, Code.CONFLICT)

    def test_a_booked_slot_disappears_from_the_public_slot_list(self):
        before = call(availability.slots, practitioner=PRACTITIONER, date=str(self.date))
        taken = before["slots"][0]["time"]

        call(booking.create, payload={
            "first_name": "Ali", "last_name": "Khan", "phone": self.phone,
            "practitioner": PRACTITIONER, "date": str(self.date), "time": taken,
        })

        frappe.set_user("Guest")
        after = call(availability.slots, practitioner=PRACTITIONER, date=str(self.date))
        self.assertNotIn(taken, [s["time"] for s in after["slots"]])


class TestInputValidation(PublicApiBase):
    """Bad input must be refused before anything is written."""

    def _bad(self, **over):
        base = {
            "first_name": "Ali", "last_name": "Khan", "phone": self.phone,
            "practitioner": PRACTITIONER, "date": str(self.date), "time": "09:00:00",
        }
        base.update(over)
        with self.assertRaises(ApiError) as caught:
            call(booking.create, payload=base)
        return caught.exception

    def test_missing_name_is_rejected(self):
        self.assertEqual(self._bad(first_name="").code, Code.VALIDATION)

    def test_invalid_phone_is_rejected(self):
        self.assertEqual(self._bad(phone="abc").code, Code.VALIDATION)

    def test_invalid_email_is_rejected(self):
        self.assertEqual(self._bad(email="not-an-email").code, Code.VALIDATION)

    def test_past_date_is_rejected(self):
        self.assertEqual(self._bad(date=str(getdate(add_days(nowdate(), -1)))).code,
                         Code.VALIDATION)

    def test_absurdly_distant_date_is_rejected(self):
        self.assertEqual(self._bad(date=str(getdate(add_days(nowdate(), 400)))).code,
                         Code.VALIDATION)

    def test_markup_in_a_name_is_rejected(self):
        self.assertEqual(self._bad(first_name="<script>alert(1)</script>").code,
                         Code.VALIDATION)

    def test_unknown_practitioner_is_rejected(self):
        self.assertEqual(self._bad(practitioner="Dr Nobody At All").code, Code.VALIDATION)

    def test_client_cannot_smuggle_extra_document_fields(self):
        """Unknown keys must be ignored, never written onto the document."""
        slots = call(availability.slots, practitioner=PRACTITIONER, date=str(self.date))
        result = call(booking.create, payload={
            "first_name": "Ali", "last_name": "Khan", "phone": self.phone,
            "practitioner": PRACTITIONER, "date": str(self.date),
            "time": slots["slots"][0]["time"],
            # None of these may take effect.
            "status": "Closed",
            "doctype": "User",
            "invoiced": 1,
        })
        frappe.set_user("Administrator")
        doc = frappe.get_doc("Patient Appointment", result["reference"])
        self.assertNotEqual(doc.status, "Closed")
        self.assertFalse(doc.invoiced)


# --------------------------------------------------------------------------- #
# Opening the guest surface opened nothing else
# --------------------------------------------------------------------------- #
class TestGuestStillLockedOut(PublicApiBase):
    """The staff API must remain exactly as closed as it was before."""

    def _refuses(self, fn, **kwargs):
        from clinic_core.api.v1 import encounters, invoices, patients
        try:
            result = fn(**kwargs)
        except (ApiError, frappe.PermissionError, frappe.AuthenticationError):
            return True
        # Enveloped refusal is equally valid.
        if isinstance(result, dict) and result.get("success") is False:
            self.assertIn(
                result["error"]["code"],
                {Code.UNAUTHENTICATED, Code.FORBIDDEN},
            )
            return True
        self.fail(f"guest was allowed to call {fn.__name__}: {result}")

    def test_guest_cannot_list_patients(self):
        from clinic_core.api.v1 import patients
        self._refuses(patients.list_patients)

    def test_guest_cannot_read_a_patient_record(self):
        from clinic_core.api.v1 import patients
        self._refuses(patients.get_patient, patient="Test Patient A")

    def test_guest_cannot_read_visit_history(self):
        from clinic_core.api.v1 import patients
        self._refuses(patients.visit_history, patient="Test Patient A")

    def test_guest_cannot_access_clinical_notes(self):
        from clinic_core.api.v1 import encounters
        self._refuses(encounters.list_encounters)

    def test_guest_cannot_access_invoices(self):
        from clinic_core.api.v1 import invoices
        self._refuses(invoices.list_invoices)

    def test_guest_cannot_list_all_appointments(self):
        from clinic_core.api.v1 import appointments
        self._refuses(appointments.list_appointments)

    def test_guest_cannot_create_an_appointment_through_the_staff_endpoint(self):
        from clinic_core.api.v1 import appointments
        self._refuses(appointments.create_appointment, payload={
            "patient": "Test Patient A", "practitioner": PRACTITIONER,
            "appointment_date": str(self.date), "appointment_time": "09:00:00",
        })

    def test_public_practitioner_lookup_does_not_become_a_record_reader(self):
        """assert_choice must reject anything outside the offered set."""
        with self.assertRaises(ApiError):
            call(practitioners.get_practitioner, practitioner="Administrator")


if __name__ == "__main__":
    unittest.main()
