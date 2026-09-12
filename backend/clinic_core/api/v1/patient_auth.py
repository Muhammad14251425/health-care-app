"""
clinic_core.api.v1.patient_auth -- phone + OTP authentication for the patient app.

    POST clinic_core.api.v1.patient_auth.request_otp   {phone_number}
    POST clinic_core.api.v1.patient_auth.verify_otp    {phone_number, otp}
    POST clinic_core.api.v1.patient_auth.register      {full_name, gender, ...}
    POST clinic_core.api.v1.patient_auth.logout
    POST clinic_core.api.v1.patient_auth.request_phone_change  {new_phone}
    POST clinic_core.api.v1.patient_auth.confirm_phone_change  {new_phone, otp}

Threat model
------------
An unauthenticated caller can reach request_otp/verify_otp with any phone number
they like, so both are written to give an attacker as little as possible:

  * **No account oracle.** request_otp returns an identical response whether or
    not the number is known to the clinic. An attacker cannot use it to test
    "is Ali Khan a patient here?".
  * **No plaintext codes at rest.** Only sha256(salt + code) is stored. A dump of
    the OTP table does not let anyone log in.
  * **Uniform verification failures.** Wrong code, expired code, already-used
    code, no code ever issued, and unknown number all produce ONE message. Any
    difference would be a signal to enumerate against.
  * **Bounded guessing.** 5 attempts per issued code, then the code dies. A
    6-digit code with 5 guesses is a 1-in-200,000 shot per issuance.
  * **Bounded issuance.** Per-phone and per-IP fixed windows stop an attacker
    (or a broken client) from generating codes indefinitely -- both to protect
    the account and because every SMS costs the clinic money.
  * **Constant-time comparison.** hmac.compare_digest, so the hash check cannot
    be timed.

Ambiguity is refused, never guessed. If a phone number matches two Patient
records, login fails with a neutral "contact the clinic" error rather than
picking one -- picking one means logging somebody into a stranger's records.
"""

import hashlib
import hmac
import secrets
import time

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime, get_datetime

from clinic_core.api.response import (
    ApiError, Code, clinic_api, current_patient, err, ok,
    parse_payload, pick,
)
from clinic_core.api.v1.phone import display, normalize

# --------------------------------------------------------------------------- #
# Policy
# --------------------------------------------------------------------------- #
OTP_LENGTH = 6
OTP_TTL_SECONDS = 5 * 60          # a code is valid for 5 minutes
MAX_VERIFY_ATTEMPTS = 5           # then the code is dead, resend required
RESEND_COOLDOWN_SECONDS = 45      # matches the app's "Resend in 00:45" timer

# Fixed-window issuance caps: (max, window seconds)
RATE_PER_PHONE = (5, 60 * 60)     # 5 codes per number per hour
RATE_PER_IP = (20, 60 * 60)       # 20 codes per IP per hour (shared networks)
RATE_VERIFY_PER_IP = (30, 10 * 60)

# Internal login addresses. Patients authenticate by phone; the email is an
# implementation detail of Frappe's User doctype and is never shown to anyone.
USER_DOMAIN = "patient.clinic.internal"

PATIENT_ROLE = "Patient"

# Marley makes Patient.sex mandatory. The public booking flow already settled on
# this neutral default rather than forcing a stranger to disclose gender.
DEFAULT_GENDER = "Prefer not to say"


# --------------------------------------------------------------------------- #
# Rate limiting
# --------------------------------------------------------------------------- #
def _client_ip():
    return getattr(frappe.local, "request_ip", None) or "unknown"


def _rl_key(scope, key, window):
    """The cache key for one fixed window. Also used by `clear_rate_limit`."""
    bucket = int(time.time() // window)
    return f"clinic_otp_rl:{scope}:{key}:{bucket}"


def _hit_limit(scope, key, limit, window):
    """Fixed-window counter in redis. True when the caller is over the limit.

    Counting is done with get/set rather than redis INCR. INCR stores a bare
    integer that Frappe's own `get_value`/`delete_value` cannot round-trip --
    they pickle their payloads, so an INCR-written counter reads back as None
    and, crucially, CANNOT BE CLEARED through the cache API. That left an
    operator with no way to unblock a patient who had exhausted their quota
    short of flushing the whole site cache.

    Using set_value keeps the counter readable and clearable (see
    `clear_rate_limit`). The read-modify-write is not atomic, so two truly
    simultaneous requests can share a slot; for a throttle whose job is to stop
    scripted abuse and runaway retries that is an acceptable trade for being
    able to operate it. The hard guarantees -- hashing, expiry, single use and
    the attempt cap -- do not depend on this counter.

    Fails OPEN on a cache error: a redis hiccup must not lock every patient out
    of their medical records.
    """
    cache_key = _rl_key(scope, key, window)
    try:
        cache = frappe.cache()
        count = int(cache.get_value(cache_key) or 0) + 1
        # expires_in_sec keeps the window self-cleaning even if nothing clears it.
        cache.set_value(cache_key, count, expires_in_sec=window * 2)
        return count > limit
    except Exception:
        return False


def clear_rate_limit(phone_number=None):
    """Reset OTP throttling for one number (or this IP). Operator/test tool.

    Run as an administrator when a patient has locked themselves out by
    requesting codes repeatedly:

        bench --site <site> execute \
            clinic_core.api.v1.patient_auth.clear_rate_limit \
            --kwargs "{'phone_number': '03001234567'}"

    Clears the neighbouring buckets too, so a call that lands near a window
    boundary still takes effect.
    """
    cache = frappe.cache()
    targets = [("ip", _client_ip()), ("verify", _client_ip())]
    if phone_number:
        targets.append(("phone", normalize(phone_number)))

    cleared = 0
    for scope, key in targets:
        for window in {RATE_PER_PHONE[1], RATE_PER_IP[1], RATE_VERIFY_PER_IP[1]}:
            base = int(time.time() // window)
            for bucket in (base - 1, base, base + 1):
                try:
                    cache.delete_value(f"clinic_otp_rl:{scope}:{key}:{bucket}")
                    cleared += 1
                except Exception:
                    pass
    return {"cleared": cleared}


def _seconds_since_last_otp(phone_e164, purpose):
    last = frappe.db.get_value(
        "Patient OTP Request",
        {"phone_e164": phone_e164, "purpose": purpose},
        "creation",
        order_by="creation desc",
    )
    if not last:
        return None
    return (now_datetime() - get_datetime(last)).total_seconds()


# --------------------------------------------------------------------------- #
# OTP primitives
# --------------------------------------------------------------------------- #
def _generate_code():
    """A uniformly random numeric code. secrets, never random."""
    upper = 10 ** OTP_LENGTH
    return str(secrets.randbelow(upper)).zfill(OTP_LENGTH)


def _hash_code(salt, code):
    return hashlib.sha256(f"{salt}{code}".encode()).hexdigest()


def _issue_otp(phone_e164, purpose="login"):
    """Create the challenge row and hand the code to the provider.

    The plaintext code exists only as a local variable and inside the outgoing
    message. It is never returned, stored or logged (outside developer_mode's
    console provider).
    """
    from clinic_core.otp import get_provider
    from clinic_core.otp.base import NotAWhatsAppNumberError, OtpDeliveryError

    code = _generate_code()
    salt = secrets.token_hex(16)

    doc = frappe.get_doc({
        "doctype": "Patient OTP Request",
        "phone_e164": phone_e164,
        "purpose": purpose,
        "otp_hash": _hash_code(salt, code),
        "salt": salt,
        "expires_at": add_to_date(now_datetime(), seconds=OTP_TTL_SECONDS),
        "attempts": 0,
        "consumed": 0,
        "requested_ip": _client_ip(),
    })
    doc.insert(ignore_permissions=True)

    try:
        delivery = get_provider().send(phone_e164, code, purpose) or {}
    except NotAWhatsAppNumberError:
        # The one delivery failure the patient can act on. Surfaced specifically
        # so they are told to use a WhatsApp number instead of being left to
        # wait for a code that can never arrive. See the note on the exception
        # about why this is an acceptable exception to the uniform-response rule.
        frappe.db.rollback()
        raise ApiError(
            Code.VALIDATION,
            _("This number is not registered on WhatsApp. "
              "Please use a number that has WhatsApp."),
        )
    except OtpDeliveryError:
        # The row is useless without delivery; drop it so the cooldown/limit is
        # not consumed by a code the patient never received.
        frappe.db.rollback()
        raise ApiError(
            Code.INTERNAL,
            _("We could not send your verification code right now. Please try again."),
        )

    frappe.db.commit()
    return {
        "name": doc.name,
        # Which transport actually ran. Surfaced so a DEVELOPMENT client can say
        # "printed to the server log" instead of "sent to your phone" -- claiming
        # an SMS was sent when the console provider merely printed it is a lie
        # the UI should not tell. Suppressed outside developer_mode (see
        # request_otp) so it never becomes a hint to a real caller.
        "channel": delivery.get("provider"),
        "delivered": bool(delivery.get("delivered")),
    }


def _consume_otp(phone_e164, code, purpose="login"):
    """Validate `code`, marking it used. Raises a uniform error on any failure.

    Every rejection path returns the SAME message. An attacker must not be able
    to tell "wrong code" from "no such number" from "expired" -- each distinction
    would be a free bit of information about an account they do not own.
    """
    generic = ApiError(
        Code.VALIDATION,
        _("That code is not valid or has expired. Please request a new one."),
    )

    if not code or not str(code).strip().isdigit():
        raise generic

    row = frappe.db.get_value(
        "Patient OTP Request",
        {"phone_e164": phone_e164, "purpose": purpose, "consumed": 0},
        ["name", "otp_hash", "salt", "expires_at", "attempts"],
        order_by="creation desc",
        as_dict=True,
    )
    if not row:
        raise generic

    if get_datetime(row.expires_at) < now_datetime():
        raise generic

    if int(row.attempts or 0) >= MAX_VERIFY_ATTEMPTS:
        raise generic

    expected = row.otp_hash
    supplied = _hash_code(row.salt, str(code).strip())

    if not hmac.compare_digest(expected, supplied):
        # Count the miss, then fail identically to every other rejection.
        frappe.db.set_value("Patient OTP Request", row.name,
                            "attempts", int(row.attempts or 0) + 1,
                            update_modified=False)
        frappe.db.commit()
        raise generic

    # Single use: burn it before issuing any session.
    frappe.db.set_value("Patient OTP Request", row.name, "consumed", 1,
                        update_modified=False)
    frappe.db.commit()
    return True


# --------------------------------------------------------------------------- #
# Account resolution
# --------------------------------------------------------------------------- #
def _find_mapping(phone_e164):
    return frappe.db.get_value(
        "Patient Phone Mapping",
        {"phone_e164": phone_e164},
        ["name", "patient", "user", "status"],
        as_dict=True,
    )


def _candidate_patients(phone_e164):
    """Active Patients whose stored contact number matches, across formats.

    Legacy rows hold unnormalised text (`03009332202` next to `+923005551234`),
    so a single equality test would miss real matches. We compare against every
    plausible spelling and then de-duplicate by patient.

    This is a MATCHING aid for first login only. It never decides identity on its
    own: an ambiguous result is refused (see `_resolve_account`), and once a
    mapping exists this function is not consulted again.
    """
    from clinic_core.api.v1.phone import variants

    forms = variants(phone_e164)
    if not forms:
        return []

    rows = frappe.get_all(
        "Patient",
        filters={"status": "Active"},
        or_filters=[["mobile", "in", forms], ["phone", "in", forms]],
        fields=["name", "patient_name", "user_id"],
        ignore_permissions=True,
    )

    # Defence in depth: re-normalise what we matched, so a lookalike that merely
    # shares a substring cannot slip through the `in` comparison.
    from clinic_core.api.v1.phone import try_normalize
    confirmed = []
    for r in rows:
        stored = frappe.db.get_value("Patient", r["name"], ["mobile", "phone"], as_dict=True)
        for value in (stored.get("mobile"), stored.get("phone")):
            if value and try_normalize(value) == phone_e164:
                confirmed.append(r)
                break
    return confirmed


def _make_user(phone_e164, full_name=None, email=None):
    """Create the Frappe User that will own this patient's sessions.

    The username is derived from a hash of the phone number, not the number
    itself: User names are visible in a number of places Frappe does not treat as
    confidential (owner fields, share dialogs, error text), and a patient's
    mobile number should not be sitting in any of them.
    """
    handle = hashlib.sha256(f"clinic:{phone_e164}".encode()).hexdigest()[:16]
    login = f"p{handle}@{USER_DOMAIN}"

    if frappe.db.exists("User", login):
        return login

    first, last = _split_name(full_name or _("Patient"))

    user = frappe.get_doc({
        "doctype": "User",
        "email": login,
        "first_name": first,
        "last_name": last,
        "mobile_no": phone_e164,
        "send_welcome_email": 0,
        # Website User, not System User: a patient must never reach the desk.
        "user_type": "Website User",
        "enabled": 1,
    })
    user.insert(ignore_permissions=True)

    # The account authenticates by OTP only. Give it a long random password so
    # the password path cannot be used against it at all.
    from frappe.utils.password import update_password
    update_password(login, secrets.token_urlsafe(48))

    user.reload()
    if not any(r.role == PATIENT_ROLE for r in user.roles):
        user.append("roles", {"role": PATIENT_ROLE})
        user.save(ignore_permissions=True)

    if email:
        # Contact email lives on the Patient record; keeping it off the login
        # User avoids Frappe treating it as an alternate login identity.
        pass

    return login


def _split_name(full_name):
    parts = [p for p in (full_name or "").strip().split() if p]
    if not parts:
        return _("Patient"), None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


def _resolve_account(phone_e164):
    """Decide what a verified phone number means. Never guesses.

    Returns (state, mapping_or_none):
        "linked"    -> an account exists and is usable
        "blocked"   -> mapping exists but is disabled
        "ambiguous" -> several patients share the number; staff must resolve
        "new"       -> nothing matches; the caller may register
    """
    mapping = _find_mapping(phone_e164)
    if mapping:
        if mapping.status != "Active":
            return "blocked", mapping
        return "linked", mapping

    candidates = _candidate_patients(phone_e164)
    if len(candidates) > 1:
        return "ambiguous", None
    if len(candidates) == 1:
        return "match", candidates[0]
    return "new", None


def _link_existing_patient(phone_e164, patient_row):
    """Case A: the clinic already knows this person -- attach a login to them."""
    user = patient_row.get("user_id")
    if not user or not frappe.db.exists("User", user):
        user = _make_user(phone_e164, patient_row.get("patient_name"))

    mapping = frappe.get_doc({
        "doctype": "Patient Phone Mapping",
        "phone_e164": phone_e164,
        "patient": patient_row["name"],
        "user": user,
        "status": "Active",
        "verified_on": now_datetime(),
    })
    mapping.insert(ignore_permissions=True)
    frappe.db.commit()
    return mapping


def _start_session(user):
    """Issue a real Frappe session for `user` and return the sid.

    LoginManager.login_as() is Frappe's own supported "log in as this user
    without a password" entry point -- the same machinery the password login
    uses, so the session is indistinguishable from a normal one downstream.

    LoginManager.__init__ reads `frappe.local.request.path`, which only exists
    inside an HTTP request. Called from a bench console, a background job or a
    test runner it raises AttributeError('request'), which the decorator would
    turn into a 500 -- so the caller would see "an unexpected error occurred"
    for what is really "there is no HTTP request here". Fall back to switching
    the user directly in that case: the verification has already happened, and
    a non-HTTP caller has no cookie jar for a sid to be useful in anyway.
    """
    from frappe.auth import LoginManager

    try:
        lm = LoginManager()
        lm.login_as(user)
        lm.post_login()
        frappe.local.login_manager = lm
    except AttributeError:
        # No request context (console / job / test). frappe.set_user resets
        # session.data, so anything relying on it must re-read after this --
        # see the note in api/v1/slots.py about set_user's side effects.
        frappe.set_user(user)

    frappe.db.commit()
    return frappe.session.sid


def _profile_payload(patient=None):
    """The identity block the app needs after login. No other patient's data."""
    user = frappe.session.user
    patient = patient or current_patient()

    data = {
        "user": user,
        "roles": sorted(set(frappe.get_roles())),
        "persona": "patient",
        "patient": patient,
        "needs_registration": not patient,
    }

    if patient:
        row = frappe.db.get_value(
            "Patient", patient,
            ["patient_name", "mobile", "email", "sex", "dob"],
            as_dict=True,
        ) or {}
        data.update({
            "full_name": row.get("patient_name"),
            "patient_name": row.get("patient_name"),
            "mobile": row.get("mobile"),
            "email": row.get("email"),
        })
    else:
        data["full_name"] = frappe.db.get_value("User", user, "full_name")

    return data


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@frappe.whitelist(allow_guest=True)
def request_otp(phone_number=None, payload=None):
    """Send a login code.

    ALWAYS reports success for a well-formed number, whether or not it belongs to
    a patient. The only errors a caller can distinguish are "that is not a phone
    number" and "you are asking too often".

    Not wrapped in @clinic_api because the uniform response is the security
    property here -- it is built explicitly rather than derived from an exception.
    """
    try:
        data = parse_payload(payload) if payload else {}
        raw = phone_number or data.get("phone_number") or data.get("phone")
        phone_e164 = normalize(raw)

        if _hit_limit("ip", _client_ip(), *RATE_PER_IP):
            return err(Code.RATE_LIMITED,
                       _("Too many requests. Please try again later."))

        if _hit_limit("phone", phone_e164, *RATE_PER_PHONE):
            # Deliberately the same message as the IP limit: telling an attacker
            # they hit a PER-NUMBER cap would confirm the number is being used.
            return err(Code.RATE_LIMITED,
                       _("Too many requests. Please try again later."))

        since = _seconds_since_last_otp(phone_e164, "login")
        if since is not None and since < RESEND_COOLDOWN_SECONDS:
            return ok(
                {
                    "sent": True,
                    "phone": display(phone_e164),
                    "expires_in": OTP_TTL_SECONDS,
                    "resend_in": int(RESEND_COOLDOWN_SECONDS - since),
                },
                message=_("Verification code sent."),
            )

        state, _mapping = _resolve_account(phone_e164)

        # An ambiguous or blocked number gets no code -- but the response is
        # identical to the happy path, so the caller learns nothing. The patient
        # who is genuinely affected finds out when they contact the clinic, which
        # is the only safe channel for it anyway.
        issued = None
        if state in ("linked", "match", "new"):
            issued = _issue_otp(phone_e164, "login")
        else:
            frappe.log_error(
                title="clinic_core: OTP withheld",
                message=f"state={state} for a number that requested a login code.",
            )

        # In DEVELOPMENT only, tell the client which transport ran, so the app
        # can say "printed to the server log" rather than claiming an SMS was
        # sent. Never exposed on a real site: whether a code was truly dispatched
        # is exactly the kind of per-number detail the uniform response hides.
        dev_channel = None
        if frappe.conf.get("developer_mode") and issued:
            dev_channel = {
                "channel": issued.get("channel"),
                "delivered_to_device": issued.get("delivered")
                and issued.get("channel") not in ("console", "null"),
            }

        return ok(
            {
                "sent": True,
                "phone": display(phone_e164),
                **({"dev": dev_channel} if dev_channel else {}),
                "expires_in": OTP_TTL_SECONDS,
                "resend_in": RESEND_COOLDOWN_SECONDS,
            },
            message=_("Verification code sent."),
        )

    except ApiError as e:
        return err(e.code, e.message, e.http_status)
    except Exception:
        frappe.log_error(title="clinic_core: request_otp failed",
                         message=frappe.get_traceback(with_context=True))
        return err(Code.INTERNAL, _("An unexpected error occurred."))


@frappe.whitelist(allow_guest=True)
def verify_otp(phone_number=None, otp=None, payload=None):
    """Verify a code and start a patient session.

    On success returns the session id plus the caller's OWN profile. When the
    number is not yet a patient, the session is still issued but flagged
    `needs_registration` -- the app then calls `register` to finish setup.
    """
    try:
        data = parse_payload(payload) if payload else {}
        raw = phone_number or data.get("phone_number") or data.get("phone")
        code = otp or data.get("otp") or data.get("code")

        phone_e164 = normalize(raw)

        if _hit_limit("verify", _client_ip(), *RATE_VERIFY_PER_IP):
            return err(Code.RATE_LIMITED,
                       _("Too many attempts. Please try again later."))

        state, found = _resolve_account(phone_e164)

        if state == "ambiguous":
            # Consume the attempt first so this branch is not a free probe.
            _consume_otp(phone_e164, code, "login")
            return err(
                Code.CONFLICT,
                _("We could not verify this number automatically. "
                  "Please contact the clinic to access your account."),
            )

        if state == "blocked":
            _consume_otp(phone_e164, code, "login")
            return err(
                Code.FORBIDDEN,
                _("This account is not available. Please contact the clinic."),
            )

        # Validate the code BEFORE creating or touching any account.
        _consume_otp(phone_e164, code, "login")

        if state == "linked":
            mapping = found
            frappe.db.set_value("Patient Phone Mapping", mapping.name, {
                "verified_on": now_datetime(),
                "last_login_on": now_datetime(),
            }, update_modified=False)
            patient = mapping.patient
            user = mapping.user

        elif state == "match":
            mapping = _link_existing_patient(phone_e164, found)
            patient = mapping.patient
            user = mapping.user

        else:  # "new" -- no patient record yet
            user = _make_user(phone_e164)
            patient = None

        frappe.db.commit()
        sid = _start_session(user)

        profile = _profile_payload(patient)
        profile["sid"] = sid
        profile["phone"] = display(phone_e164)

        return ok(profile, message=_("Signed in."))

    except ApiError as e:
        return err(e.code, e.message, e.http_status)
    except Exception:
        frappe.log_error(title="clinic_core: verify_otp failed",
                         message=frappe.get_traceback(with_context=True))
        return err(Code.INTERNAL, _("An unexpected error occurred."))


@frappe.whitelist()
@clinic_api()
def register(payload=None):
    """Complete first-time setup for a verified number with no Patient record.

    Only callable by a session that has already proven the phone number, and only
    while that session has no patient. It cannot be used to create a second
    patient or to attach to an existing one.
    """
    if current_patient():
        raise ApiError(Code.VALIDATION, _("This account is already set up."))

    user = frappe.session.user
    mapping_phone = frappe.db.get_value(
        "Patient Phone Mapping", {"user": user}, "phone_e164"
    )
    phone_e164 = mapping_phone or frappe.db.get_value("User", user, "mobile_no")
    if not phone_e164:
        raise ApiError(Code.FORBIDDEN, _("Verify your phone number first."))

    data = pick(parse_payload(payload), ["full_name", "gender", "sex", "dob", "email"])

    full_name = (data.get("full_name") or "").strip()
    if not full_name or len(full_name) < 2:
        raise ApiError(Code.VALIDATION, _("Please enter your full name."))
    if len(full_name) > 80 or any(c in full_name for c in "<>{}[]\\/|"):
        raise ApiError(Code.VALIDATION, _("Please enter a valid name."))

    gender = data.get("gender") or data.get("sex") or DEFAULT_GENDER
    if not frappe.db.exists("Gender", gender):
        gender = DEFAULT_GENDER

    email = (data.get("email") or "").strip() or None
    if email:
        from clinic_core.api.v1.public.guard import clean_email
        email = clean_email(email)

    first, last = _split_name(full_name)

    # Re-check for an existing patient at commit time: someone may have been
    # registered by reception between OTP and this call.
    state, found = _resolve_account(phone_e164)
    if state == "ambiguous":
        raise ApiError(
            Code.CONFLICT,
            _("We could not set up your account automatically. "
              "Please contact the clinic."),
        )
    if state == "match":
        mapping = _link_existing_patient(phone_e164, found)
        return _profile_payload(mapping.patient)
    if state == "linked":
        return _profile_payload(found.patient)

    patient = frappe.get_doc({
        "doctype": "Patient",
        "first_name": first,
        "last_name": last,
        "sex": gender,
        "dob": data.get("dob") or None,
        "mobile": phone_e164,
        "email": email,
        "status": "Active",
        # We provision the User ourselves; Marley's invite flow would try to send
        # a welcome email to an internal address that does not receive mail.
        "invite_user": 0,
    })
    patient.insert(ignore_permissions=True)

    frappe.get_doc({
        "doctype": "Patient Phone Mapping",
        "phone_e164": phone_e164,
        "patient": patient.name,
        "user": user,
        "status": "Active",
        "verified_on": now_datetime(),
        "last_login_on": now_datetime(),
    }).insert(ignore_permissions=True)

    frappe.db.commit()
    return _profile_payload(patient.name)


@frappe.whitelist()
@clinic_api()
def logout():
    """End the session server-side."""
    from frappe.auth import LoginManager

    lm = LoginManager()
    lm.logout()
    frappe.db.commit()
    return ok({"logged_out": True}, message=_("Signed out."))


@frappe.whitelist()
@clinic_api()
def request_phone_change(new_phone=None, payload=None):
    """Start moving this account to a different mobile number.

    The code goes to the NEW number, which is what proves the patient controls
    it. A number already used by another account is refused -- otherwise this
    would be a way to take one over.
    """
    patient = current_patient()
    if not patient:
        raise ApiError(Code.FORBIDDEN, _("No patient record linked to this account."))

    data = parse_payload(payload) if payload else {}
    phone_e164 = normalize(new_phone or data.get("new_phone") or data.get("phone_number"))

    existing = _find_mapping(phone_e164)
    if existing and existing.patient != patient:
        # Neutral wording: do not confirm that the number belongs to someone.
        raise ApiError(
            Code.VALIDATION,
            _("This number cannot be used. Please contact the clinic."),
        )
    if existing and existing.patient == patient:
        raise ApiError(Code.VALIDATION, _("That is already your number."))

    if _hit_limit("phone", phone_e164, *RATE_PER_PHONE):
        raise ApiError(Code.RATE_LIMITED, _("Too many requests. Please try again later."))

    _issue_otp(phone_e164, "change_phone")
    return {
        "sent": True,
        "phone": display(phone_e164),
        "expires_in": OTP_TTL_SECONDS,
        "resend_in": RESEND_COOLDOWN_SECONDS,
    }


@frappe.whitelist()
@clinic_api()
def confirm_phone_change(new_phone=None, otp=None, payload=None):
    """Finish the phone change once the new number's code is verified."""
    patient = current_patient()
    if not patient:
        raise ApiError(Code.FORBIDDEN, _("No patient record linked to this account."))

    data = parse_payload(payload) if payload else {}
    phone_e164 = normalize(new_phone or data.get("new_phone") or data.get("phone_number"))
    code = otp or data.get("otp") or data.get("code")

    existing = _find_mapping(phone_e164)
    if existing and existing.patient != patient:
        raise ApiError(
            Code.VALIDATION,
            _("This number cannot be used. Please contact the clinic."),
        )

    _consume_otp(phone_e164, code, "change_phone")

    mapping_name = frappe.db.get_value(
        "Patient Phone Mapping", {"patient": patient}, "name"
    )
    if not mapping_name:
        raise ApiError(Code.NOT_FOUND, _("No phone login found for this account."))

    frappe.db.set_value("Patient Phone Mapping", mapping_name, {
        "phone_e164": phone_e164,
        "verified_on": now_datetime(),
    })
    # Keep the visible contact number in step with the login identity.
    frappe.db.set_value("Patient", patient, "mobile", phone_e164)
    frappe.db.commit()

    return {"phone": display(phone_e164), "updated": True}


@frappe.whitelist()
@clinic_api()
def session_valid():
    """Cheap probe used by the app on cold start."""
    return {"valid": True, "user": frappe.session.user, "patient": current_patient()}
