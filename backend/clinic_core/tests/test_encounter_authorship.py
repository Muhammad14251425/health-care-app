"""
Who a consultation note is attributed to, and who is recorded as having typed it.

Reported from the app: an admin filled in the Consultation note screen and got
"practitioner is required." with no field to satisfy it. Three separate faults:

1. The mobile form never collected a practitioner, so it could not be sent.
2. An admin has no Healthcare Practitioner record, so the server could not infer
   one -- correctly, but the message did not say what to do about it.
3. Marley ships Patient Encounter with a DocPerm for `Physician` ONLY, so even a
   correct payload died at doc.insert() with a bare PermissionError -- while
   clinic_core's CLINICAL_ROLES and the app's canCreateEncounter both said the
   admin was allowed. The action was permitted everywhere except the doctype.

The rule these tests pin down: a note is ATTRIBUTED to a clinician
(`practitioner`) and ATTRIBUTABLE to whoever typed it (`owner` -> `entered_by`).
An admin may record on a doctor's behalf; the record never pretends the admin
was the clinician, and never hides who entered it.

Run:
    bench --site clinic.localhost run-tests --app clinic_core \
        --module clinic_core.tests.test_encounter_authorship
"""

import frappe
import unittest

from clinic_core.api.v1 import encounters, patients

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


class AuthorshipBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        cls.prac = frappe.db.get_value(
            "Healthcare Practitioner", {"user_id": DOCTOR_USER}, "name"
        )
        cls.prac2 = frappe.db.get_value(
            "Healthcare Practitioner", {"user_id": DOCTOR2_USER}, "name"
        )
        cls.patient = frappe.db.get_value("Patient", {"patient_name": "Test Patient A"}, "name")
        assert cls.prac and cls.prac2 and cls.patient, "seed data missing"

    def setUp(self):
        frappe.set_user("Administrator")
        self._created = []

    def tearDown(self):
        # create_encounter commits (the booking flows must see the row), so a
        # rollback alone would leak encounters into the dev site.
        frappe.set_user("Administrator")
        for name in self._created:
            try:
                if frappe.db.exists("Patient Encounter", name):
                    doc = frappe.get_doc("Patient Encounter", name)
                    doc.flags.ignore_permissions = True
                    if doc.docstatus == 1:
                        doc.cancel()
                    doc.delete(ignore_permissions=True)
            except Exception:
                frappe.db.rollback()
        frappe.db.commit()
        frappe.db.rollback()

    def _track(self, response):
        name = _data(response).get("name")
        if name:
            self._created.append(name)
        return response


class TestAdminRecordsOnBehalf(AuthorshipBase):
    def test_admin_selects_a_doctor_and_the_note_is_created(self):
        frappe.set_user(ADMIN_USER)
        res = self._track(encounters.create_encounter(payload={
            "patient": self.patient,
            "practitioner": self.prac,
            "encounter_comment": "typed by admin",
        }))
        self.assertTrue(
            _ok(res),
            "admin could not record a note even with a practitioner named -- "
            "check the Custom DocPerm granted by setup_masters",
        )
        self.assertEqual(_data(res)["practitioner"], self.prac)

    def test_admin_without_a_practitioner_is_told_what_to_do(self):
        frappe.set_user(ADMIN_USER)
        res = encounters.create_encounter(payload={
            "patient": self.patient,
            "encounter_comment": "no doctor named",
        })
        self.assertEqual(_code(res), "VALIDATION_ERROR")
        # The original message was the bare field name, which gave the user no
        # way forward when the form had no such field.
        self.assertIn("doctor", (res["error"]["message"] or "").lower())

    def test_the_practitioner_must_be_a_real_active_one(self):
        frappe.set_user(ADMIN_USER)
        res = encounters.create_encounter(payload={
            "patient": self.patient,
            "practitioner": "No Such Doctor",
            "encounter_comment": "bogus",
        })
        self.assertEqual(_code(res), "VALIDATION_ERROR")

    def test_the_note_records_who_actually_typed_it(self):
        frappe.set_user(ADMIN_USER)
        created = self._track(encounters.create_encounter(payload={
            "patient": self.patient,
            "practitioner": self.prac,
            "encounter_comment": "audit check",
        }))
        detail = _data(encounters.get_encounter(encounter=_data(created)["name"]))

        self.assertEqual(detail["practitioner"], self.prac, "attributed to the doctor")
        self.assertEqual(detail["entered_by"], ADMIN_USER, "but entered by the admin")
        self.assertTrue(
            detail["entered_on_behalf"],
            "the record must flag that the typist was not the clinician",
        )


class TestAppointmentContextIsInherited(AuthorshipBase):
    def test_a_note_from_an_appointment_uses_that_appointments_doctor(self):
        frappe.set_user(ADMIN_USER)
        appt = frappe.db.get_value(
            "Patient Appointment", {"practitioner": self.prac}, ["name", "patient"], as_dict=True
        )
        if not appt:
            self.skipTest("no appointment for the seeded practitioner")

        res = self._track(encounters.create_encounter(payload={
            "patient": appt.patient,
            "appointment": appt.name,
            "encounter_comment": "inherited",
        }))
        self.assertTrue(_ok(res), "admin had to pick a doctor despite appointment context")
        self.assertEqual(
            _data(res)["practitioner"], self.prac,
            "the note must follow the appointment's doctor, so it cannot be filed "
            "against someone who did not hold the consultation",
        )


class TestDoctorAuthorship(AuthorshipBase):
    def test_a_doctor_is_assigned_their_own_record(self):
        frappe.set_user(DOCTOR_USER)
        res = self._track(encounters.create_encounter(payload={
            "patient": self.patient,
            "encounter_comment": "own note",
        }))
        self.assertTrue(_ok(res))
        self.assertEqual(_data(res)["practitioner"], self.prac)

    def test_a_doctors_own_note_is_not_flagged_on_behalf(self):
        frappe.set_user(DOCTOR_USER)
        created = self._track(encounters.create_encounter(payload={
            "patient": self.patient,
            "encounter_comment": "own note",
        }))
        detail = _data(encounters.get_encounter(encounter=_data(created)["name"]))
        self.assertEqual(detail["entered_by"], DOCTOR_USER)
        self.assertFalse(
            detail["entered_on_behalf"],
            "a clinician writing their own note is the normal case and must not "
            "be decorated as if someone else typed it",
        )

    def test_a_doctor_cannot_file_under_another_doctor(self):
        frappe.set_user(DOCTOR_USER)
        res = encounters.create_encounter(payload={
            "patient": self.patient,
            "practitioner": self.prac2,
            "encounter_comment": "not mine to write",
        })
        self._track(res)
        self.assertEqual(
            _code(res), "FORBIDDEN",
            "a physician must not be able to put words in a colleague's record",
        )


class TestReceptionIsExcluded(AuthorshipBase):
    def test_reception_cannot_create_a_clinical_note(self):
        frappe.set_user(RECEPTION_USER)
        res = encounters.create_encounter(payload={
            "patient": self.patient,
            "practitioner": self.prac,
            "encounter_comment": "front desk should not write this",
        })
        self._track(res)
        self.assertEqual(_code(res), "FORBIDDEN")

    def test_reception_still_cannot_read_clinical_content(self):
        """Granting admin authorship must not widen reception's view."""
        frappe.set_user(ADMIN_USER)
        created = self._track(encounters.create_encounter(payload={
            "patient": self.patient,
            "practitioner": self.prac,
            "encounter_comment": "confidential",
        }))
        name = _data(created)["name"]

        frappe.set_user(RECEPTION_USER)
        detail = _data(encounters.get_encounter(encounter=name))
        self.assertFalse(detail.get("clinical_access"))
        self.assertIsNone(detail.get("encounter_comment"))


class TestPersistence(AuthorshipBase):
    def test_an_admin_entered_note_reaches_the_patients_visit_history(self):
        frappe.set_user(ADMIN_USER)
        created = self._track(encounters.create_encounter(payload={
            "patient": self.patient,
            "practitioner": self.prac,
            "encounter_comment": "history check",
        }))
        name = _data(created)["name"]

        history = _data(patients.visit_history(patient=self.patient, limit=50))
        self.assertIn(
            name, [e["name"] for e in history.get("encounters", [])],
            "a note the admin recorded must appear in the patient's record like "
            "any other, not sit in a separate class of its own",
        )

    def test_the_treating_doctor_sees_a_note_recorded_for_them(self):
        frappe.set_user(ADMIN_USER)
        created = self._track(encounters.create_encounter(payload={
            "patient": self.patient,
            "practitioner": self.prac,
            "encounter_comment": "for the doctor",
        }))
        name = _data(created)["name"]

        frappe.set_user(DOCTOR_USER)
        listing = _data(encounters.list_encounters())
        self.assertIn(name, [e["name"] for e in listing.get("items", [])])

    def test_the_stored_document_carries_the_right_practitioner(self):
        """Read the doctype directly, not just the API's view of it."""
        frappe.set_user(ADMIN_USER)
        created = self._track(encounters.create_encounter(payload={
            "patient": self.patient,
            "practitioner": self.prac,
            "encounter_comment": "stored check",
        }))
        name = _data(created)["name"]

        frappe.set_user("Administrator")
        row = frappe.db.get_value(
            "Patient Encounter", name, ["practitioner", "patient", "owner"], as_dict=True
        )
        self.assertEqual(row.practitioner, self.prac)
        self.assertEqual(row.patient, self.patient)
        self.assertEqual(
            row.owner, ADMIN_USER,
            "Frappe's own audit column must still name the real user; the "
            "on-behalf flow must not rewrite it",
        )
