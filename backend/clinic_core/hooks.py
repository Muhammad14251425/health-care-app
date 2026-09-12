"""
Frappe app manifest for clinic_core.

Frappe reads this at install and on every boot: it is how the app announces its
name, its modules, and the background work it needs run. Without it `bench
get-app` does not recognise the directory as an app at all.

Deliberately minimal. clinic_core adds API endpoints and two doctypes on top of
ERPNext and Healthcare (Marley); it overrides none of their documents, so there
are no doc_events here. Anything this app does to an ERPNext document goes
through the normal API with the caller's own permissions, which is what keeps
the role matrix enforceable server-side.
"""

app_name = "clinic_core"
app_title = "Clinic Core"
app_publisher = "Meadow Clinic"
app_description = "Clinic API layer: scheduling, patient portal and public booking on top of ERPNext Healthcare"
app_email = "muhammadfawwad88@gmail.com"
app_license = "MIT"

# Required apps -- Frappe installs these first and refuses if they are missing.
# clinic_core imports from both directly (erpnext.accounts, healthcare.*), so a
# site without them would fail at import time rather than at first request.
required_apps = ["erpnext", "healthcare"]

# ---------------------------------------------------------------------------
# Scheduled jobs
# ---------------------------------------------------------------------------
# One job, and it matters: every OTP request is persisted as a row carrying a
# hashed code, a salt and the requesting IP. Without a purge those rows
# accumulate for the life of the site. Two days is well past the few minutes an
# OTP is valid for, so this deletes only records that can no longer be used.
scheduler_events = {
    "daily": [
        "clinic_core.clinic_core.doctype.patient_otp_request.patient_otp_request.purge_expired",
    ],
}

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
# None. The clinic's masters (departments, practitioners, service units) are
# seeded per-site via `setup_masters.py`, not shipped with the app -- they
# differ per deployment and a fixture would overwrite a live clinic's own data
# on every migrate.
