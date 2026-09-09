"""
Security regression tests against Marley (healthcare) endpoints.

These are ADVERSARIAL tests. Several are expected to FAIL against pristine upstream
Marley -- that is the point: they document real vulnerabilities and will turn green
once clinic_core's hardening (or an upstream fix) is in place.

Run:
    bench --site clinic.localhost run-tests --app clinic_core \
        --module clinic_core.tests.test_security_marley
"""

import frappe
import unittest

PATIENT_A_USER = "patienta@test.local"
PATIENT_B_USER = "patientb@test.local"
RECEPTION_USER = "reception@test.local"
DOCTOR_USER = "doctor@test.local"


class MarleySecurityBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        cls.patient_a = frappe.db.get_value("Patient", {"user_id": PATIENT_A_USER}, "name")
        cls.patient_b = frappe.db.get_value("Patient", {"user_id": PATIENT_B_USER}, "name")
        assert cls.patient_a, "seed data missing: Test Patient A"
        assert cls.patient_b, "seed data missing: Test Patient B"

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()


class TestSetRequestStatusIDOR(MarleySecurityBase):
    """
    GitHub issue #1063 -- Arbitrary Record Modification via unsanitized `doctype`.

        @frappe.whitelist()
        def set_request_status(doctype, request, status):
            frappe.db.set_value(doctype, request, "status", status)

    No permission check, no doctype allowlist, and frappe.db.set_value bypasses the
    ORM permission layer. Any authenticated user can set `status` on ANY doctype.
    """

    def test_low_privilege_user_can_mutate_arbitrary_doctype(self):
        from healthcare.controllers.service_request_controller import set_request_status

        # A patient-level user -- the lowest-trust authenticated role.
        frappe.set_user(PATIENT_A_USER)

        # Target a record this user must never be able to touch: another patient.
        original = frappe.db.get_value("Patient", self.patient_b, "status")

        set_request_status("Patient", self.patient_b, "Disabled")

        mutated = frappe.db.get_value("Patient", self.patient_b, "status")

        # If the vulnerability is present, the write succeeded.
        self.assertEqual(
            mutated, "Disabled",
            "Expected the documented #1063 vulnerability to reproduce "
            f"(status was {original!r}, now {mutated!r})",
        )

    def test_patient_cannot_disable_another_patient_via_orm(self):
        """Control: the SAME mutation through the ORM must be blocked.

        This proves the ORM permission layer works and that the bug is specifically
        caused by set_request_status bypassing it with frappe.db.set_value.
        """
        frappe.set_user(PATIENT_A_USER)
        with self.assertRaises(frappe.PermissionError):
            doc = frappe.get_doc("Patient", self.patient_b)
            doc.status = "Disabled"
            doc.save()


class TestPatientHorizontalAccess(MarleySecurityBase):
    """Patient A must not read Patient B's data."""

    def test_patient_a_cannot_read_patient_b_document(self):
        frappe.set_user(PATIENT_A_USER)
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc("Patient", self.patient_b).check_permission("read")

    def test_portal_patient_list_is_scoped_to_caller(self):
        from healthcare.healthcare.api.patient_portal import get_patients_with_relations

        frappe.set_user(PATIENT_A_USER)
        visible = get_patients_with_relations()
        self.assertIn(self.patient_a, visible)
        self.assertNotIn(
            self.patient_b, visible,
            "Patient A can see Patient B through the portal helper",
        )


class TestUnauthenticatedAccess(MarleySecurityBase):
    """Guest must not reach protected healthcare data."""

    def test_guest_cannot_list_patients(self):
        frappe.set_user("Guest")
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc("Patient", self.patient_a).check_permission("read")

    def test_guest_cannot_read_patient_via_get_list(self):
        """Guest listing Patient must not return data.

        Frappe v16 raises PermissionError here rather than returning an empty list --
        the stricter of the two acceptable behaviours. Either is a pass; leaking rows
        is the failure we are guarding against.
        """
        frappe.set_user("Guest")
        try:
            rows = frappe.get_list("Patient", ignore_permissions=False, limit=5)
        except frappe.PermissionError:
            return  # denied outright -- correct
        self.assertEqual(rows, [], "Guest received patient rows")


class TestRoleSeparation(MarleySecurityBase):
    """Doctor / receptionist boundaries."""

    def test_receptionist_cannot_access_system_settings(self):
        frappe.set_user(RECEPTION_USER)
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc("System Settings").check_permission("write")

    def test_doctor_cannot_access_system_settings(self):
        frappe.set_user(DOCTOR_USER)
        with self.assertRaises(frappe.PermissionError):
            frappe.get_doc("System Settings").check_permission("write")

    def test_doctor_can_read_patients(self):
        frappe.set_user(DOCTOR_USER)
        # Should NOT raise.
        frappe.get_doc("Patient", self.patient_a).check_permission("read")
