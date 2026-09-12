"""Patient Phone Mapping -- the patient authentication anchor.

Invariants enforced here rather than only at the call site, so they hold even if
someone creates a mapping from the desk or a patch:

  * `phone_e164` is stored normalised. A raw value written by hand is normalised
    on validate rather than silently becoming an identity nobody can log into.
  * one phone -> one Patient -> one User, all three directions.

The DocType JSON marks phone_e164, patient and user `unique`, which is the real
(database-level) guarantee. The checks below exist to produce a clear message
instead of a raw IntegrityError, and to catch the case the unique index cannot:
a Patient already linked to a DIFFERENT user through Patient.user_id.
"""

import frappe
from frappe import _
from frappe.model.document import Document


class PatientPhoneMapping(Document):
    def validate(self):
        from clinic_core.api.v1.phone import normalize

        # Normalise defensively: a desk-entered "0300 1234567" must not become a
        # second identity for a patient who already logs in as +923001234567.
        self.phone_e164 = normalize(self.phone_e164, _("Phone number"))

        self._assert_patient_not_double_mapped()
        self._assert_user_consistent()

    def _assert_patient_not_double_mapped(self):
        other = frappe.db.get_value(
            "Patient Phone Mapping",
            {"patient": self.patient, "name": ["!=", self.name or ""]},
            "name",
        )
        if other:
            frappe.throw(
                _("This patient already has a phone login ({0}).").format(other),
                title=_("Duplicate mapping"),
            )

    def _assert_user_consistent(self):
        """The User must not already belong to a different patient."""
        other = frappe.db.get_value(
            "Patient Phone Mapping",
            {"user": self.user, "name": ["!=", self.name or ""]},
            "patient",
        )
        if other and other != self.patient:
            frappe.throw(
                _("That user account is already linked to another patient."),
                title=_("Duplicate mapping"),
            )

        # Patient.user_id is the field Marley itself uses and clinic_core's
        # current_patient() reads. If it points somewhere else, the mapping and
        # the session would disagree about who this is -- refuse rather than
        # letting the two drift.
        linked = frappe.db.get_value("Patient", self.patient, "user_id")
        if linked and linked != self.user:
            frappe.throw(
                _("This patient is already linked to a different user account."),
                title=_("Conflicting link"),
            )

    def on_update(self):
        """Keep Patient.user_id in step -- it is what current_patient() reads.

        `user_id` is a Read Only field, so db_set is the supported way to write
        it; this is exactly what Marley's own Patient.invite_user path does.
        """
        if self.status == "Active":
            current = frappe.db.get_value("Patient", self.patient, "user_id")
            if current != self.user:
                frappe.db.set_value("Patient", self.patient, "user_id", self.user)

    def on_trash(self):
        """Unlink the patient so a deleted mapping cannot leave a live session."""
        if frappe.db.get_value("Patient", self.patient, "user_id") == self.user:
            frappe.db.set_value("Patient", self.patient, "user_id", None)
