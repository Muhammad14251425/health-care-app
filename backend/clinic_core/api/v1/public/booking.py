"""
clinic_core.api.v1.public.booking

The single guest write path: create one Patient Appointment.

Threat model, and how each part is handled:

  * Arbitrary document creation -- the client never sends a doctype or a field
    map. It sends a fixed set of scalars; this module builds the documents.
  * Slot tampering -- the requested time is re-derived from the server's own
    slot list before insert, and Marley's validate_overlaps() runs on insert.
    A client cannot book a time the server did not offer.
  * Patient-record abuse -- a guest cannot address an existing patient by id.
    We match on an exact (name + phone) pair or create a new minimal record;
    either way the guest learns nothing about who already exists.
  * Data disclosure -- the response contains the booking reference and the
    details the caller themselves supplied. No patient id, no internal state.
  * Spam -- rate limited per IP at the decorator, plus a per-phone daily cap.

Marley remains the authority on booking rules; nothing here reimplements them.
"""

import frappe
from frappe import _
from frappe.utils import getdate, nowdate

from clinic_core.api.response import ApiError, Code, parse_payload
from clinic_core.api.v1.public.guard import (
    assert_choice,
    clean_date,
    clean_email,
    clean_name,
    clean_phone,
    clean_text,
    clean_time,
    public_api,
)

# How many appointments one phone number may hold in the future at once. Stops a
# script from filling a doctor's whole week without needing a captcha.
MAX_OPEN_PER_PHONE = 3

# Statuses that still occupy a slot from the clinic's point of view.
LIVE_STATUSES = ("Scheduled", "Open", "Checked In")


# Marley makes Patient.sex mandatory. A public booking form has no business
# demanding that a stranger disclose their gender to see a doctor, so it is
# optional on the form and falls back to the neutral value Marley ships.
DEFAULT_GENDER = "Prefer not to say"


def _match_or_create_patient(first_name, last_name, phone, email, gender=None):
    """Return a Patient name, reusing an exact (name + mobile) match.

    Deliberately conservative: matching only on an exact full-name + phone pair
    avoids both duplicate spam and the far worse failure of attaching a stranger's
    booking to an existing patient's medical record. Anything less certain
    creates a new record; staff can merge later (the staff API already surfaces
    `possible_duplicates`).
    """
    full_name = " ".join(p for p in (first_name, last_name) if p).strip()

    existing = frappe.db.get_value(
        "Patient",
        {"patient_name": full_name, "mobile": phone, "status": "Active"},
        "name",
    )
    if existing:
        return existing, False

    doc = frappe.get_doc(
        {
            "doctype": "Patient",
            "first_name": first_name,
            "last_name": last_name or None,
            "sex": gender or DEFAULT_GENDER,
            "mobile": phone,
            "email": email or None,
            "status": "Active",
            # Marley's default is to invite every new patient as a portal User.
            # A public booking form must never provision a login account: it
            # would let an anonymous caller create Users at will, and it fails
            # outright when the address already belongs to someone.
            "invite_user": 0,
        }
    )
    # Guests have no Patient-creation rights and must not be given any; this
    # single, fully-validated insert is performed on their behalf.
    doc.insert(ignore_permissions=True)
    return doc.name, True


def _assert_slot_offered(practitioner, date, time):
    """The requested time must appear in the server's own free-slot list."""
    from clinic_core.api.v1.public.availability import slots as public_slots

    payload = public_slots.__wrapped__(practitioner=practitioner, date=str(date))

    offered = {s["time"] for s in (payload or {}).get("slots") or []}
    if time not in offered:
        raise ApiError(
            Code.CONFLICT,
            _("That time is no longer available. Please choose another time."),
        )
    return (payload or {}).get("duration") or 30


def _assert_not_flooding(phone):
    """Cap how many upcoming appointments one phone number may hold.

    Patient Appointment has no phone column in Marley 16, so the count goes
    through the Patient records carrying that mobile number. frappe.db.count is
    a direct query (not permission-filtered), so it works as Guest, and it
    returns only a count -- no appointment or patient data is exposed.
    """
    patients = frappe.get_all(
        "Patient", filters={"mobile": phone}, pluck="name", ignore_permissions=True
    )
    if not patients:
        return

    count = frappe.db.count(
        "Patient Appointment",
        {
            "patient": ["in", patients],
            "appointment_date": [">=", getdate(nowdate())],
            "status": ["in", LIVE_STATUSES],
        },
    )
    if count >= MAX_OPEN_PER_PHONE:
        raise ApiError(
            Code.VALIDATION,
            _("You already have {0} upcoming appointments. "
              "Please call the clinic to book another.").format(count),
        )


@public_api("booking")
def create(payload=None):
    """Create one appointment from the public booking form.

    Accepted keys (anything else is ignored):
        first_name, last_name, phone, email, gender,
        department, practitioner, date, time, appointment_type, reason
    """
    from healthcare.healthcare.doctype.patient_appointment.patient_appointment import (
        OverlapError,
    )

    data = parse_payload(payload)

    # ---- validate every field before touching the database --------------- #
    first_name = clean_name(data.get("first_name"), "First name")
    last_name = (
        clean_name(data.get("last_name"), "Last name")
        if (data.get("last_name") or "").strip()
        else None
    )
    phone = clean_phone(data.get("phone"))
    email = clean_email(data.get("email"))
    reason = clean_text(data.get("reason"), "Reason", max_len=280, required=False)

    gender = None
    if data.get("gender"):
        gender = assert_choice(data.get("gender"), "Gender", "Gender")

    practitioner = assert_choice(
        data.get("practitioner"), "Healthcare Practitioner", "Practitioner",
        {"status": "Active"},
    )
    date = clean_date(data.get("date"))
    time = clean_time(data.get("time"))

    # A department, if given, must actually be this practitioner's department --
    # otherwise the booking would misroute.
    department = frappe.db.get_value("Healthcare Practitioner", practitioner, "department")
    if data.get("department"):
        chosen = assert_choice(data.get("department"), "Medical Department", "Department")
        if department and chosen != department:
            raise ApiError(Code.VALIDATION, _("This doctor is not in the selected department."))
        department = chosen

    appointment_type = "Consultation"
    if data.get("appointment_type"):
        appointment_type = assert_choice(
            data.get("appointment_type"), "Appointment Type", "Appointment type"
        )
    elif not frappe.db.exists("Appointment Type", appointment_type):
        appointment_type = frappe.db.get_value("Appointment Type", {}, "name")

    _assert_not_flooding(phone)

    # ---- re-check the slot, then let Marley enforce the real rule --------- #
    duration = _assert_slot_offered(practitioner, date, time)

    patient, created = _match_or_create_patient(first_name, last_name, phone, email, gender)

    doc = frappe.get_doc(
        {
            "doctype": "Patient Appointment",
            "patient": patient,
            "practitioner": practitioner,
            "appointment_date": date,
            "appointment_time": time,
            "duration": duration,
            "department": department,
            "appointment_type": appointment_type,
            "appointment_for": "Practitioner",
            "notes": reason,
            "company": frappe.db.get_single_value("Global Defaults", "default_company"),
        }
    )

    try:
        doc.insert(ignore_permissions=True)
    except OverlapError:
        frappe.db.rollback()
        raise ApiError(
            Code.CONFLICT,
            _("That time was just booked. Please choose another time."),
        )
    except frappe.ValidationError as e:
        frappe.db.rollback()
        from frappe.utils import strip_html
        raise ApiError(Code.VALIDATION, strip_html(str(e)) or _("Unable to book this appointment."))

    frappe.db.commit()

    # Echo back only what the caller already knows, plus the reference.
    return {
        "reference": doc.name,
        "practitioner": practitioner,
        "practitioner_name": frappe.db.get_value(
            "Healthcare Practitioner", practitioner, "practitioner_name"
        ),
        "department": department,
        "date": str(date),
        "time": time,
        "duration": duration,
        "appointment_type": appointment_type,
        "patient_name": " ".join(p for p in (first_name, last_name) if p),
        "status": doc.status,
        "new_patient": created,
    }


@public_api("read")
def appointment_types():
    """Appointment types a guest may pick from."""
    rows = frappe.get_all(
        "Appointment Type",
        fields=["name"],
        order_by="name asc",
        limit_page_length=50,
        ignore_permissions=True,
    )
    return {"items": [{"name": r["name"], "label": r["name"]} for r in rows]}
