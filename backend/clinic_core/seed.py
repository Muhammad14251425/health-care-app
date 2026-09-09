"""
Seed DEVELOPMENT test data for the clinic platform.

NEVER contains real patient information. All names/emails/phones are synthetic.
Idempotent: safe to run repeatedly.

Run:
    bench --site clinic.localhost execute clinic_core.seed.run

IMPORTANT: run this via `bench execute`, NOT by piping into `bench console`.
`bench console` is an IPython REPL and blank lines inside a function body
terminate the block, which silently breaks the definitions.
"""

import frappe

COMPANY = "Test Clinic"
PASSWORD = "TestPass123!"  # DEV ONLY -- never use anywhere real

# NOTE: Marley/ERPNext ship NO "Healthcare Receptionist" role. Verified roles are:
# Healthcare Administrator, Physician, Nursing User, Laboratory User, Patient.
# The receptionist persona uses "Nursing User" (front-desk/clinical-support) and is
# deliberately NOT given Physician. clinic_core hardens this at the API layer.
USERS = [
    # "Item Manager" is required for billing: ERPNext's get_item_details() calls
    # item.check_permission(), and Accounts Manager alone does NOT grant read on
    # the Item doctype -- Sales Invoice creation fails with a bare PermissionError
    # ("does not have doctype access via role permission for document Item").
    ("admin.clinic@test.local", "Clinic", "Admin",
     ["Healthcare Administrator", "Accounts Manager", "System Manager",
      "Item Manager", "Stock User"]),
    # Reception books and takes payment, so it needs the same Item read access
    # plus Accounts User to raise/settle invoices.
    ("reception@test.local", "Test", "Receptionist",
     ["Nursing User", "Accounts User", "Item Manager"]),
    ("doctor@test.local", "Test", "Doctor", ["Physician"]),
    ("doctor2@test.local", "Second", "Doctor", ["Physician"]),
    ("patienta@test.local", "Patient", "A", ["Patient"]),
    ("patientb@test.local", "Patient", "B", ["Patient"]),
]

GENDERS = ("Male", "Female", "Other", "Transgender", "Prefer not to say")
SALUTATIONS = ("Mr", "Ms", "Mrs", "Dr", "Prof")

PRACTITIONERS = [
    ("Dr Test Doctor", "doctor@test.local"),
    ("Dr Second Doctor", "doctor2@test.local"),
]

PATIENTS = [
    ("Test Patient A", "patienta@test.local", "Male", "1990-01-15", "+923001234567"),
    ("Test Patient B", "patientb@test.local", "Female", "1985-06-20", "+923007654321"),
]

DEPARTMENT = "General Medicine"
SCHEDULE = "Weekday 9to5"
APPT_TYPE = "Consultation"


def log(*a):
    print("[seed]", *a)


def _ensure_masters():
    """Gender/Salutation are normally created by the ERPNext setup wizard."""
    for g in GENDERS:
        if not frappe.db.exists("Gender", g):
            frappe.get_doc({"doctype": "Gender", "gender": g}).insert(ignore_permissions=True)
            log("created Gender", g)
    if frappe.db.exists("DocType", "Salutation"):
        for s in SALUTATIONS:
            if not frappe.db.exists("Salutation", s):
                frappe.get_doc({"doctype": "Salutation", "salutation": s}).insert(
                    ignore_permissions=True)
                log("created Salutation", s)


def ensure_user(email, first, last, roles):
    if frappe.db.exists("User", email):
        u = frappe.get_doc("User", email)
    else:
        u = frappe.get_doc({
            "doctype": "User",
            "email": email,
            "first_name": first,
            "last_name": last,
            "send_welcome_email": 0,
            "enabled": 1,
        })
        u.flags.ignore_permissions = True
        u.insert(ignore_permissions=True)
        log("created user", email)

    existing = {r.role for r in u.roles}
    changed = False
    for r in roles:
        if frappe.db.exists("Role", r) and r not in existing:
            u.append("roles", {"role": r})
            changed = True

    # Always (re)set the known dev password so tests can log in deterministically.
    u.new_password = PASSWORD
    u.save(ignore_permissions=True)
    if changed:
        log("roles set for", email, roles)
    return u


def _ensure_department():
    if not frappe.db.exists("Medical Department", DEPARTMENT):
        frappe.get_doc({"doctype": "Medical Department",
                        "department": DEPARTMENT}).insert(ignore_permissions=True)
        log("created Medical Department", DEPARTMENT)


def _ensure_schedule():
    if frappe.db.exists("Practitioner Schedule", SCHEDULE):
        return
    sched = frappe.get_doc({"doctype": "Practitioner Schedule", "schedule_name": SCHEDULE})
    for day in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday"):
        sched.append("time_slots", {"day": day, "from_time": "09:00:00", "to_time": "17:00:00"})
    sched.insert(ignore_permissions=True)
    log("created Practitioner Schedule", SCHEDULE, "(Mon-Fri 09:00-17:00)")


def _ensure_practitioners():
    for pname, puser in PRACTITIONERS:
        if frappe.db.get_value("Healthcare Practitioner", {"practitioner_name": pname}, "name"):
            log("practitioner exists:", pname)
            continue
        p = frappe.get_doc({
            "doctype": "Healthcare Practitioner",
            "first_name": pname,
            "practitioner_name": pname,
            "department": DEPARTMENT,
            "user_id": puser,
            "op_consulting_charge": 1500,
            "status": "Active",
        })
        p.append("practitioner_schedules", {"schedule": SCHEDULE})
        p.flags.ignore_mandatory = True
        p.insert(ignore_permissions=True)
        log("created practitioner", p.name)


def _ensure_patients():
    for pname, puser, sex, dob, mobile in PATIENTS:
        if frappe.db.get_value("Patient", {"patient_name": pname}, "name"):
            log("patient exists:", pname)
            continue
        pat = frappe.get_doc({
            "doctype": "Patient",
            "first_name": pname,
            "sex": sex,
            "dob": dob,
            "mobile": mobile,
            "email": puser,
            "user_id": puser,
        })
        pat.flags.ignore_mandatory = True
        pat.insert(ignore_permissions=True)
        log("created patient", pat.name)


def _ensure_appointment_type():
    if not frappe.db.exists("Appointment Type", APPT_TYPE):
        frappe.get_doc({
            "doctype": "Appointment Type",
            "appointment_type": APPT_TYPE,
            "default_duration": 30,
        }).insert(ignore_permissions=True)
        log("created Appointment Type", APPT_TYPE)


def run():
    frappe.set_user("Administrator")

    log("=== MASTERS ===")
    _ensure_masters()

    log("=== USERS ===")
    for email, first, last, roles in USERS:
        ensure_user(email, first, last, roles)

    log("=== DEPARTMENT / SCHEDULE ===")
    _ensure_department()
    _ensure_schedule()

    log("=== PRACTITIONERS ===")
    _ensure_practitioners()

    log("=== PATIENTS ===")
    _ensure_patients()

    log("=== APPOINTMENT TYPE ===")
    _ensure_appointment_type()

    frappe.db.commit()

    log("=== SUMMARY ===")
    for dt in ("User", "Healthcare Practitioner", "Patient",
               "Practitioner Schedule", "Medical Department", "Appointment Type"):
        log(f"  {dt:26s} {frappe.db.count(dt)}")

    log("practitioners:")
    for p in frappe.get_all("Healthcare Practitioner",
                            fields=["name", "practitioner_name", "user_id", "department"]):
        log("   ", p)
    log("patients:")
    for p in frappe.get_all("Patient", fields=["name", "patient_name", "user_id", "sex"]):
        log("   ", p)
    log("test users:")
    for email, _, _, roles in USERS:
        if frappe.db.exists("User", email):
            actual = frappe.get_all("Has Role", filters={"parent": email}, pluck="role")
            log(f"    {email:28s} {sorted(actual)}")

    log("DONE")
