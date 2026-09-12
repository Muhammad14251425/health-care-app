"""Patient OTP Request -- one issued, hashed, single-use verification code."""

import frappe
from frappe.model.document import Document


class PatientOTPRequest(Document):
    pass


def purge_expired(days=2):
    """Delete spent/expired OTP rows. Wired to the daily scheduler in hooks.py.

    Keeping consumed codes forever would turn a hash table of who logged in when
    into a permanent record for no operational benefit. Two days keeps enough
    history to investigate an abuse report.
    """
    from frappe.utils import add_days, now_datetime

    cutoff = add_days(now_datetime(), -abs(int(days)))
    frappe.db.delete("Patient OTP Request", {"creation": ["<", cutoff]})
    frappe.db.commit()
