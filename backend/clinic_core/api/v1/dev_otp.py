"""
clinic_core.api.v1.dev_otp -- read back an issued OTP during development.

WHY THIS EXISTS
---------------
Codes are stored only as sha256(salt + code), which is correct, and the console
provider prints them to the bench log -- but when you are testing on a phone the
bench log is in another window (or another machine), and scrolling for it is
tedious. This recovers the code the same way an attacker would have to: by
hashing every 6-digit candidate until one matches. ~10^6 sha256 rounds, well
under a second.

SAFETY
------
It refuses to run unless BOTH hold:

  * the site is in developer_mode, and
  * the caller is the Administrator

It is not whitelisted, so it is unreachable over HTTP -- bench only. Even so,
the two guards are what make it safe to leave in the tree: on a production site
(developer_mode off) it does nothing at all.

USAGE
-----
    bench --site clinic.localhost execute \
        clinic_core.api.v1.dev_otp.peek \
        --kwargs "{'phone_number': '03451110001'}"
"""

import hashlib

import frappe

from clinic_core.api.v1.phone import normalize


def _assert_dev_only():
    if not frappe.conf.get("developer_mode"):
        frappe.throw(
            "dev_otp is only available when developer_mode is enabled. "
            "On a real deployment the code is delivered by the OTP provider."
        )
    if frappe.session.user != "Administrator":
        frappe.throw("dev_otp is restricted to the Administrator.")


def peek(phone_number=None, purpose="login"):
    """Print the plaintext of the newest live code for `phone_number`."""
    _assert_dev_only()

    if not phone_number:
        frappe.throw("phone_number is required.")

    phone = normalize(phone_number)

    row = frappe.db.get_value(
        "Patient OTP Request",
        {"phone_e164": phone, "purpose": purpose, "consumed": 0},
        ["name", "salt", "otp_hash", "expires_at", "attempts"],
        order_by="creation desc",
        as_dict=True,
    )
    if not row:
        print(f"No live {purpose} code for {phone}. Request one from the app first.")
        return None

    from frappe.utils import get_datetime, now_datetime

    if get_datetime(row.expires_at) < now_datetime():
        print(f"The newest code for {phone} has expired. Tap 'Resend code'.")
        return None

    for i in range(1000000):
        candidate = str(i).zfill(6)
        if hashlib.sha256(f"{row.salt}{candidate}".encode()).hexdigest() == row.otp_hash:
            print(f"\n  {phone}  ->  {candidate}")
            print(f"  expires {row.expires_at}   failed attempts so far: {row.attempts}\n")
            return candidate

    # Only reachable if OTP_LENGTH changed without updating this helper.
    print("Could not recover the code -- has OTP_LENGTH changed?")
    return None


def reset(phone_number=None):
    """Clear rate limits and issued codes for a number. Unblocks a test account."""
    _assert_dev_only()

    from clinic_core.api.v1 import patient_auth

    phone = normalize(phone_number) if phone_number else None
    if phone:
        frappe.db.delete("Patient OTP Request", {"phone_e164": phone})
    patient_auth.clear_rate_limit(phone_number=phone_number)
    frappe.db.commit()

    print(f"Cleared codes and rate limits for {phone or 'this IP'}.")
    return {"reset": phone}
