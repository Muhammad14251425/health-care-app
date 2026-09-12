"""
Regression tests for clinical-note isolation (QA baseline BUG-01 / BUG-02).

BUG-01 (P1): any Physician could read ANY other Physician's clinical notes,
including for patients they had never treated. `list_encounters` applied a
practitioner filter only when the caller supplied one, and `_may_see_clinical()`
granted every Physician access with no care-relationship check.

BUG-02 (P2): `list_encounters` returned 403 for a Healthcare Administrator
(Marley grants the Patient Encounter doctype read to Physician only) while
`get_encounter` returned the SAME record's clinical content in full, because
frappe.get_doc() performs no permission check. List and get disagreed.

Run:
    bench --site clinic.localhost run-tests --app clinic_core \
        --module clinic_core.tests.test_encounter_isolation
"""

import frappe
import unittest

from clinic_core.api.v1 import encounters

DOCTOR_USER = "doctor@test.local"
DOCTOR2_USER = "doctor2@test.local"
RECEPTION_USER = "reception@test.local"
ADMIN_USER = "admin.clinic@test.local"
PATIENT_A_USER = "patienta@test.local"

SECRET = "REGRESSION-ONLY-DIAGNOSIS-MARKER"


def _envelope_ok(response):
    """clinic_api() returns an envelope dict rather than raising."""
    return bool(response) and response.get("success") is True


def _data(response):
    return (response or {}).get("data") or {}


class EncounterIsolationBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        cls.patient_a = frappe.db.get_value("Patient", {"user_id": PATIENT_A_USER}, "name")
        cls.doc1 = frappe.db.get_value("Healthcare Practitioner", {"user_id": DOCTOR_USER}, "name")
        cls.doc2 = frappe.db.get_value("Healthcare Practitioner", {"user_id": DOCTOR2_USER}, "name")
        assert cls.patient_a, "seed data missing: Test Patient A"
        assert cls.doc1 and cls.doc2, "seed data missing: two practitioners"

    def setUp(self):
        """Create an encounter authored by doctor1 for patient A."""
        frappe.set_user("Administrator")
        doc = frappe.get_doc({
            "doctype": "Patient Encounter",
            "patient": self.patient_a,
            "practitioner": self.doc1,
            "encounter_date": frappe.utils.nowdate(),
            "encounter_comment": SECRET,
            "company": frappe.db.get_single_value("Global Defaults", "default_company"),
            "appointment_type": frappe.db.get_value("Appointment Type", {}, "name"),
        })
        doc.insert(ignore_permissions=True)
        self.encounter = doc.name

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()


class TestCrossDoctorIsolation(EncounterIsolationBase):
    """BUG-01: a Physician must not reach another Physician's clinical notes."""

    def test_other_doctor_cannot_read_encounter(self):
        frappe.set_user(DOCTOR2_USER)
        response = encounters.get_encounter(self.encounter)
        self.assertFalse(
            _envelope_ok(response),
            "doctor2 must not read doctor1's encounter",
        )
        self.assertNotIn(SECRET, frappe.as_json(response))

    def test_other_doctor_cannot_list_encounter(self):
        frappe.set_user(DOCTOR2_USER)
        response = encounters.list_encounters(limit=200)
        self.assertTrue(_envelope_ok(response))
        names = [row["name"] for row in _data(response).get("items", [])]
        self.assertNotIn(self.encounter, names)

    def test_other_doctor_cannot_request_foreign_practitioner_filter(self):
        """Asking for someone else's records is refused, not silently widened."""
        frappe.set_user(DOCTOR2_USER)
        response = encounters.list_encounters(practitioner=self.doc1)
        self.assertFalse(_envelope_ok(response))

    def test_author_still_reads_own_encounter_in_full(self):
        frappe.set_user(DOCTOR_USER)
        response = encounters.get_encounter(self.encounter)
        self.assertTrue(_envelope_ok(response), "author lost access to their own note")
        data = _data(response)
        self.assertTrue(data.get("clinical_access"))
        self.assertEqual(data.get("encounter_comment"), SECRET)

    def test_author_lists_own_encounter(self):
        frappe.set_user(DOCTOR_USER)
        response = encounters.list_encounters(limit=200)
        self.assertTrue(_envelope_ok(response))
        names = [row["name"] for row in _data(response).get("items", [])]
        self.assertIn(self.encounter, names)

    def test_other_doctor_cannot_modify_or_submit(self):
        frappe.set_user(DOCTOR2_USER)
        self.assertFalse(
            _envelope_ok(encounters.update_encounter(
                self.encounter, payload={"encounter_comment": "hijacked"})),
        )
        self.assertFalse(
            _envelope_ok(encounters.submit_encounter(self.encounter)),
        )


class TestListGetConsistency(EncounterIsolationBase):
    """BUG-02: list_encounters and get_encounter must agree for every persona."""

    def _verdicts(self):
        listed = _envelope_ok(encounters.list_encounters(limit=50))
        got = encounters.get_encounter(self.encounter)
        clinical = _envelope_ok(got) and _data(got).get("clinical_access") is True
        return listed, clinical

    def test_admin_list_and_get_agree(self):
        frappe.set_user(ADMIN_USER)
        listed, clinical = self._verdicts()
        self.assertEqual(
            listed, clinical,
            "admin must not be able to read a note in full while unable to list notes",
        )

    def test_doctor_list_and_get_agree(self):
        frappe.set_user(DOCTOR_USER)
        listed, clinical = self._verdicts()
        self.assertTrue(listed)
        self.assertTrue(clinical)


class TestReceptionRedaction(EncounterIsolationBase):
    """Reception keeps scheduling context but never clinical content."""

    def test_reception_cannot_list_encounters(self):
        frappe.set_user(RECEPTION_USER)
        self.assertFalse(_envelope_ok(encounters.list_encounters(limit=50)))

    def test_reception_gets_redacted_summary(self):
        frappe.set_user(RECEPTION_USER)
        response = encounters.get_encounter(self.encounter)
        self.assertTrue(_envelope_ok(response), "reception needs scheduling context")
        data = _data(response)
        self.assertFalse(data.get("clinical_access"))
        self.assertNotIn(SECRET, frappe.as_json(data))
        for field in ("symptoms", "diagnosis", "encounter_comment"):
            self.assertNotIn(field, data)
        # ...but the scheduling fields it legitimately needs are present.
        self.assertEqual(data.get("patient"), self.patient_a)
        self.assertEqual(data.get("practitioner"), self.doc1)


class TestPatientAccess(EncounterIsolationBase):
    """A patient reads their own record and nobody else's."""

    def test_unrelated_patient_cannot_read(self):
        frappe.set_user("patientb@test.local")
        self.assertFalse(_envelope_ok(encounters.get_encounter(self.encounter)))

    def test_guest_cannot_read(self):
        frappe.set_user("Guest")
        self.assertFalse(_envelope_ok(encounters.get_encounter(self.encounter)))
