"""
Tests for invoice sharing (QA baseline BUG-03).

BUG-03 (P2): "send/share" is an explicit MVP requirement, but neither a backend
endpoint nor a mobile action existed. PDF rendering had also never been
exercised on this deployment -- it turned out to be broken independently:
wkhtmltopdf resolves the header/footer asset URLs through frappe.utils.get_url(),
which returned http://clinic.localhost:8000, a host that does not resolve. The
site's `host_name` is now pinned to a resolvable address.

Run:
    bench --site clinic.localhost run-tests --app clinic_core \
        --module clinic_core.tests.test_invoice_share
"""

import base64

import frappe
import unittest

from clinic_core.api.v1 import invoices

ADMIN_USER = "admin.clinic@test.local"
RECEPTION_USER = "reception@test.local"
DOCTOR_USER = "doctor@test.local"
PATIENT_A_USER = "patienta@test.local"
PATIENT_B_USER = "patientb@test.local"


def _ok(response):
    return bool(response) and response.get("success") is True


def _data(response):
    return (response or {}).get("data") or {}


def _error_code(response):
    return ((response or {}).get("error") or {}).get("code")


class InvoiceShareBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frappe.set_user("Administrator")
        cls.patient_a = frappe.db.get_value("Patient", {"user_id": PATIENT_A_USER}, "name")
        assert cls.patient_a, "seed data missing: Test Patient A"

        cls.submitted = frappe.db.get_value(
            "Sales Invoice", {"docstatus": 1, "patient": ["is", "set"]}, "name"
        )
        assert cls.submitted, "seed data missing: a submitted Sales Invoice"

    def tearDown(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()


class TestInvoicePdf(InvoiceShareBase):
    def test_billing_staff_gets_a_real_pdf(self):
        frappe.set_user(ADMIN_USER)
        response = invoices.invoice_pdf(self.submitted)
        self.assertTrue(_ok(response), f"PDF failed: {response}")
        data = _data(response)
        self.assertEqual(data["filename"], f"{self.submitted}.pdf")
        self.assertEqual(data["mime_type"], "application/pdf")
        raw = base64.b64decode(data["content"])
        self.assertTrue(raw.startswith(b"%PDF-"), "content is not a PDF")
        self.assertEqual(len(raw), data["size"])

    def test_reception_may_share(self):
        frappe.set_user(RECEPTION_USER)
        self.assertTrue(_ok(invoices.invoice_pdf(self.submitted)))

    def test_doctor_is_forbidden_not_a_server_error(self):
        """A pure Physician has no Sales Invoice permission -> 403, never 500."""
        frappe.set_user(DOCTOR_USER)
        response = invoices.invoice_pdf(self.submitted)
        self.assertFalse(_ok(response))
        self.assertEqual(_error_code(response), "FORBIDDEN")

    def test_missing_invoice_is_not_found(self):
        frappe.set_user(ADMIN_USER)
        response = invoices.invoice_pdf("NO-SUCH-INVOICE")
        self.assertFalse(_ok(response))
        self.assertEqual(_error_code(response), "NOT_FOUND")

    def test_draft_invoice_is_refused(self):
        """Sharing a draft would send a figure the clinic has not committed to."""
        frappe.set_user("Administrator")
        draft = frappe.get_doc({
            "doctype": "Sales Invoice",
            "customer": frappe.db.get_value("Patient", self.patient_a, "customer"),
            "patient": self.patient_a,
            "company": frappe.db.get_single_value("Global Defaults", "default_company"),
            "items": [{"item_code": invoices._consultation_item(), "qty": 1, "rate": 100}],
        })
        draft.set_missing_values()
        draft.insert(ignore_permissions=True)

        frappe.set_user(ADMIN_USER)
        response = invoices.invoice_pdf(draft.name)
        self.assertFalse(_ok(response))
        self.assertEqual(_error_code(response), "VALIDATION_ERROR")

    def test_unrelated_patient_cannot_fetch_pdf(self):
        frappe.set_user(PATIENT_B_USER)
        invoice = frappe.db.get_value(
            "Sales Invoice", {"docstatus": 1, "patient": self.patient_a}, "name"
        )
        if not invoice:
            self.skipTest("no submitted invoice for patient A")
        self.assertFalse(_ok(invoices.invoice_pdf(invoice)))

    def test_guest_cannot_fetch_pdf(self):
        frappe.set_user("Guest")
        self.assertFalse(_ok(invoices.invoice_pdf(self.submitted)))


class TestEmailInvoice(InvoiceShareBase):
    def test_doctor_cannot_send(self):
        frappe.set_user(DOCTOR_USER)
        response = invoices.email_invoice(self.submitted)
        self.assertFalse(_ok(response))
        self.assertEqual(_error_code(response), "FORBIDDEN")

    def test_missing_email_config_is_a_4xx_not_a_500(self):
        """The client must be able to branch to 'share instead', so 4xx."""
        if frappe.db.exists("Email Account", {"enable_outgoing": 1}):
            self.skipTest("outgoing email IS configured on this site")
        frappe.set_user(ADMIN_USER)
        response = invoices.email_invoice(self.submitted)
        self.assertFalse(_ok(response))
        self.assertEqual(_error_code(response), "VALIDATION_ERROR")
