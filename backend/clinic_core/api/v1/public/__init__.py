"""
clinic_core.api.v1.public

The ONLY guest-reachable surface in the system, besides auth.login.

Design rules for everything under this package -- treat them as invariants:

  1. Read-mostly. The single write is booking.create, and it creates exactly one
     Patient Appointment (plus, when necessary, one minimal Patient record).
  2. Never return anything a stranger should not see. No patient lists, no
     existing patient records, no visit history, no clinical notes, no invoices,
     no staff contact details, no internal ids beyond the booking reference the
     caller needs to quote back.
  3. Never accept a doctype, fieldname or filter from the client. Guests choose
     from server-supplied enumerations only.
  4. Rate limited. A guest endpoint is an unauthenticated write path onto a
     medical calendar; abuse protection is not optional.
  5. Staff authentication is untouched. Nothing here relaxes a check that
     applies elsewhere.

Submodules are imported eagerly so that `clinic_core.api.v1.public.<module>`
resolves through Frappe's successive getattr() lookup on a cold worker.
"""

from clinic_core.api.v1.public import (  # noqa: F401
    availability,
    booking,
    departments,
    practitioners,
)
