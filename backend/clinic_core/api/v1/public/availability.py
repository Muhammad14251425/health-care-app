"""
clinic_core.api.v1.public.availability

Guest-facing slot lookup for steps 3 and 4 of the booking flow.

The slot derivation itself lives in `clinic_core.api.v1.slots` and is shared
with the staff endpoint, so guests and staff read the same calendar through the
same code. This module is only the public guard plus input validation.
"""

import frappe
from frappe import _
from frappe.utils import getdate

from clinic_core.api.response import ApiError, Code
from clinic_core.api.v1 import slots as slot_engine
from clinic_core.api.v1.public.guard import assert_choice, clean_date, public_api

# Re-exported for callers/tests that imported them from here previously.
DEFAULT_SLOT_MINUTES = slot_engine.DEFAULT_SLOT_MINUTES
MIN_LEAD_MINUTES = slot_engine.MIN_LEAD_MINUTES


@public_api("read")
def slots(practitioner, date=None):
    """Discrete bookable times for one practitioner on one date.

    Response:
        { practitioner, practitioner_name, date, available,
          duration, slots: [{time, label, available}], message }

    `available: false` with an explanatory message is a normal answer (the
    doctor does not work that day), not an error.
    """
    name = assert_choice(
        practitioner, "Healthcare Practitioner", "Practitioner", {"status": "Active"}
    )
    day = clean_date(date) if date else getdate()
    return slot_engine.compute_slots(name, day)


@public_api("read")
def days(practitioner, start_date=None, limit=14):
    """Which of the next N days the doctor works -- powers the date strip."""
    name = assert_choice(
        practitioner, "Healthcare Practitioner", "Practitioner", {"status": "Active"}
    )
    begin = clean_date(start_date) if start_date else getdate()

    out = slot_engine.working_days(name, begin, limit)
    if out is None:
        raise ApiError(Code.VALIDATION, _("This doctor has no published schedule."))
    return {"practitioner": name, "days": out}
