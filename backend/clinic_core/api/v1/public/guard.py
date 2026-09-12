"""
clinic_core.api.v1.public.guard

Shared protection for the guest surface: rate limiting, input sanitising and the
`public_api` decorator every public endpoint wears.

Why a separate decorator instead of `clinic_api(allow_guest=True)`:
a guest endpoint needs rate limiting and must be hostile to unexpected input in
ways an authenticated endpoint does not. Keeping it distinct also makes the
guest surface greppable -- `public_api` marks every unauthenticated entry point.
"""

import re
import time

import frappe
from frappe import _

from clinic_core.api.response import ApiError, Code, clinic_api

# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #
# Counters live in Frappe's redis cache, keyed by caller IP. This is deliberately
# simple: it throttles casual scripted abuse and accidental client retry storms.
# It is NOT a substitute for an edge WAF / real DDoS protection in production --
# see docs/06_KNOWN_LIMITATIONS in the mobile docs.
RATE_LIMITS = {
    # endpoint group: (max calls, window seconds)
    "read": (60, 60),     # browsing departments/doctors/slots
    "booking": (5, 600),  # actually creating appointments
}


def _client_ip():
    return (getattr(frappe.local, "request_ip", None) or "unknown")


def enforce_rate_limit(group):
    """Fixed-window counter per IP. Raises 429-ish CONFLICT-free VALIDATION error."""
    limit, window = RATE_LIMITS[group]
    bucket = int(time.time() // window)
    key = f"clinic_public_rl:{group}:{_client_ip()}:{bucket}"

    cache = frappe.cache()
    try:
        count = cache.incr(key)
        if count == 1:
            cache.expire(key, window * 2)
    except Exception:
        # Never let a cache hiccup take the booking flow down; failing open on
        # rate limiting is the right trade-off for a clinic booking page.
        return

    if count > limit:
        raise ApiError(
            Code.RATE_LIMITED,
            _("Too many requests. Please wait a moment and try again."),
        )


def public_api(group="read"):
    """Guest-reachable endpoint: rate limited, enveloped, no auth required."""
    def decorator(fn):
        guarded = clinic_api(allow_guest=True)(fn)

        @frappe.whitelist(allow_guest=True)
        def wrapper(*args, **kwargs):
            try:
                enforce_rate_limit(group)
            except ApiError as e:
                from clinic_core.api.response import err
                return err(e.code, e.message, e.http_status)
            return guarded(*args, **kwargs)

        wrapper.__name__ = fn.__name__
        wrapper.__doc__ = fn.__doc__
        wrapper.__module__ = fn.__module__
        # Expose the undecorated function so sibling endpoints can reuse the
        # logic server-side without paying the rate limit or re-enveloping.
        wrapper.__wrapped__ = fn
        return wrapper
    return decorator


# --------------------------------------------------------------------------- #
# Input sanitising
# --------------------------------------------------------------------------- #
# Deliberately permissive about international names (accents, apostrophes,
# hyphens) and strict about everything that could be markup or a control char.
_NAME_RE = re.compile(r"^[^\W\d_][^\d<>{}\[\]\\/|^~`$%*+=@#]{0,79}$", re.UNICODE)
_PHONE_RE = re.compile(r"^\+?[0-9][0-9\s\-()]{5,19}$")
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$")
_TIME_RE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$")


def clean_text(value, field, max_len=140, required=True):
    """Trim, collapse whitespace, reject control characters and markup."""
    text = (value or "").strip() if isinstance(value, str) else ""
    text = re.sub(r"\s+", " ", text)
    if not text:
        if required:
            raise ApiError(Code.VALIDATION, _("{0} is required.").format(field))
        return None
    if len(text) > max_len:
        raise ApiError(Code.VALIDATION, _("{0} is too long.").format(field))
    if re.search(r"[<>]|[\x00-\x1f\x7f]", text):
        raise ApiError(Code.VALIDATION, _("{0} contains invalid characters.").format(field))
    return text


def clean_name(value, field):
    name = clean_text(value, field, max_len=80)
    if not _NAME_RE.match(name):
        raise ApiError(Code.VALIDATION, _("Please enter a valid {0}.").format(field.lower()))
    return name


def clean_phone(value):
    phone = clean_text(value, "Phone", max_len=20)
    compact = re.sub(r"[\s\-()]", "", phone)
    if not _PHONE_RE.match(phone) or not (6 <= len(compact.lstrip("+")) <= 15):
        raise ApiError(Code.VALIDATION, _("Please enter a valid phone number."))
    return compact


def clean_email(value):
    if not value or not str(value).strip():
        return None
    email = clean_text(value, "Email", max_len=120)
    if not _EMAIL_RE.match(email):
        raise ApiError(Code.VALIDATION, _("Please enter a valid email address."))
    return email.lower()


def clean_time(value):
    text = clean_text(value, "Time", max_len=8)
    if not _TIME_RE.match(text):
        raise ApiError(Code.VALIDATION, _("Please choose a valid time."))
    parts = text.split(":")
    return f"{int(parts[0]):02d}:{parts[1]}:{parts[2] if len(parts) > 2 else '00'}"


def clean_date(value):
    """Accept YYYY-MM-DD only, and refuse dates in the past or absurdly far out."""
    from frappe.utils import add_days, getdate, nowdate

    text = clean_text(value, "Date", max_len=10)
    try:
        date = getdate(text)
    except Exception:
        raise ApiError(Code.VALIDATION, _("Please choose a valid date."))

    if date < getdate(nowdate()):
        raise ApiError(Code.VALIDATION, _("Please choose a date that is not in the past."))
    # A public form has no business scheduling years ahead.
    if date > getdate(add_days(nowdate(), 180)):
        raise ApiError(Code.VALIDATION, _("Please choose a date within the next six months."))
    return date


def assert_choice(value, doctype, field, filters=None):
    """The client may only name a record the server already offered it.

    Guests never pass a doctype or filter -- they pass one value which must exist
    within a server-defined set. This is what keeps the guest surface from
    becoming a generic document reader.
    """
    name = clean_text(value, field, max_len=140)
    lookup = {"name": name}
    lookup.update(filters or {})
    if not frappe.db.exists(doctype, lookup):
        raise ApiError(Code.VALIDATION, _("Please choose a valid {0}.").format(field.lower()))
    return name
