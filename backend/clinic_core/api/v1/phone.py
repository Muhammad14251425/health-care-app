"""
clinic_core.api.v1.phone

ONE phone normalisation, used by everything that treats a phone number as an
identity (OTP login, account mapping, phone change).

Why this module exists
----------------------
`Patient.mobile` is a free-text Data field and the live database already holds
the same country's numbers in two different shapes:

    Final Check   +923005551234
    Syed Azaan     03009332202

Those are the same format of Pakistani mobile number written two ways. A login
that did `get_value("Patient", {"mobile": user_input})` would match one and miss
the other, and which one it matched would depend on how the patient happened to
type it that day. Worse, `get_value` returns an ARBITRARY row when several match,
so a duplicated number would silently log someone into a stranger's medical
record.

So: never compare raw phone text. Everything goes through `normalize()` first,
and the normalised value is what gets stored and indexed.

The client may format for display however it likes; the server does not trust it.
"""

import re

from frappe import _

from clinic_core.api.response import ApiError, Code

# Default country applied to national-format numbers (no country code given).
# Pakistan for this deployment; a multi-country clinic would read this from
# site config rather than hard-coding it.
DEFAULT_COUNTRY_CODE = "92"

# National significant number lengths we accept once the country code is off.
# Pakistani mobiles are 10 digits after the leading 0 (3XX XXXXXXX).
_MIN_NSN = 8
_MAX_NSN = 13

# E.164 allows at most 15 digits including the country code.
_E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")

# Characters humans put in phone numbers that carry no information.
_NOISE_RE = re.compile(r"[\s\-(). ‎‏]")


def normalize(raw, field=None):
    """Return a phone number in E.164 (`+923001234567`), or raise ApiError.

    Accepted inputs (all yield +923001234567):

        03001234567        national with trunk prefix
        3001234567         national without trunk prefix
        923001234567       country code, no plus
        +923001234567      already E.164
        0092 300 1234567   international prefix
        +92 300 123 4567   spaced / dashed / bracketed

    Deliberately total: every caller gets either a valid E.164 string or an
    ApiError. There is no "unparseable but pass it through" path, because that
    is how an unnormalised value ends up in the identity column.
    """
    label = field or _("Phone number")

    if raw is None or not isinstance(raw, (str, int)):
        raise ApiError(Code.VALIDATION, _("{0} is required.").format(label))

    text = str(raw).strip()
    if not text:
        raise ApiError(Code.VALIDATION, _("{0} is required.").format(label))

    # Strip formatting noise, but keep a leading '+' if present.
    text = _NOISE_RE.sub("", text)

    # Reject anything that is not a plus followed by digits. Doing this before
    # the prefix juggling below means no other branch has to worry about junk.
    if not re.fullmatch(r"\+?[0-9]{5,20}", text):
        raise ApiError(Code.VALIDATION, _("Please enter a valid phone number."))

    if text.startswith("+"):
        digits = text[1:]
    elif text.startswith("00"):
        # International access prefix -- 0092... means +92...
        digits = text[2:]
    elif text.startswith("0"):
        # National trunk prefix: drop exactly one leading zero, prepend country.
        digits = DEFAULT_COUNTRY_CODE + text[1:]
    elif text.startswith(DEFAULT_COUNTRY_CODE) and len(text) > len(DEFAULT_COUNTRY_CODE) + _MIN_NSN - 1:
        # Already carries the country code without a plus.
        digits = text
    else:
        # A bare national number with no trunk prefix (3001234567).
        digits = DEFAULT_COUNTRY_CODE + text

    digits = digits.lstrip("0") if digits.startswith("0") else digits

    candidate = "+" + digits
    if not _E164_RE.match(candidate):
        raise ApiError(Code.VALIDATION, _("Please enter a valid phone number."))

    # Sanity-check the national part length for the default country so obvious
    # typos (a digit short, a digit long) are caught at entry rather than
    # becoming an account nobody can log into.
    if digits.startswith(DEFAULT_COUNTRY_CODE):
        nsn = digits[len(DEFAULT_COUNTRY_CODE):]
        if not (_MIN_NSN <= len(nsn) <= _MAX_NSN):
            raise ApiError(Code.VALIDATION, _("Please enter a valid phone number."))

    return candidate


def try_normalize(raw):
    """`normalize` but returns None instead of raising -- for bulk/backfill use."""
    try:
        return normalize(raw)
    except ApiError:
        return None


def mask(phone_e164):
    """`+923001234567` -> `+92 300 ****567`, for echoing a number back safely.

    Used in OTP screens so the patient can confirm they typed the right number
    without the response becoming a way to read a full number off an account.
    """
    if not phone_e164 or len(phone_e164) < 6:
        return "****"
    return f"{phone_e164[:-7]} ****{phone_e164[-3:]}"


def display(phone_e164):
    """Pretty national form for UI echo: +923001234567 -> +92 300 1234567."""
    if not phone_e164 or not phone_e164.startswith("+"):
        return phone_e164 or ""
    digits = phone_e164[1:]
    if digits.startswith(DEFAULT_COUNTRY_CODE):
        nsn = digits[len(DEFAULT_COUNTRY_CODE):]
        if len(nsn) == 10:
            return f"+{DEFAULT_COUNTRY_CODE} {nsn[:3]} {nsn[3:]}"
    return phone_e164


def variants(phone_e164):
    """Every raw spelling of `phone_e164` that might sit in legacy free-text data.

    Used ONLY to find existing `Patient.mobile` rows written before normalisation
    existed. It is a migration/matching aid, never an authentication comparison:
    the identity check always happens on the unique normalised column.
    """
    if not phone_e164 or not phone_e164.startswith("+"):
        return []
    digits = phone_e164[1:]
    out = {phone_e164, digits}
    if digits.startswith(DEFAULT_COUNTRY_CODE):
        nsn = digits[len(DEFAULT_COUNTRY_CODE):]
        out.update({
            "0" + nsn,
            nsn,
            "00" + digits,
            f"+{DEFAULT_COUNTRY_CODE} {nsn[:3]} {nsn[3:]}" if len(nsn) == 10 else "",
            f"0{nsn[:3]} {nsn[3:]}" if len(nsn) == 10 else "",
            f"0{nsn[:3]}-{nsn[3:]}" if len(nsn) == 10 else "",
        })
    return [v for v in out if v]
