"""
clinic_core.otp.diagnose -- check the Evolution API setup before trusting it.

An OTP transport that is misconfigured fails at the worst possible moment: a
patient taps Continue and waits for a code that never comes. This checks the
whole chain up front, and never prints the apikey.

    bench --site clinic.localhost execute clinic_core.otp.diagnose.check

    # also confirm a specific number has WhatsApp:
    bench --site clinic.localhost execute clinic_core.otp.diagnose.check \
        --kwargs "{'phone_number': '03001234567'}"

    # actually send a real test message (uses a throwaway code, not a login OTP):
    bench --site clinic.localhost execute clinic_core.otp.diagnose.send_test \
        --kwargs "{'phone_number': '03001234567'}"
"""

import frappe


def _mask(value):
    """Show enough of a secret to recognise it, never enough to use it."""
    if not value:
        return "(not set)"
    text = str(value)
    if len(text) <= 8:
        return "*" * len(text)
    return f"{text[:4]}…{text[-4:]} ({len(text)} chars)"


def check(phone_number=None):
    """Report the Evolution configuration, connectivity and instance state."""
    conf = frappe.conf

    print("\n--- clinic_core OTP configuration ---")
    print(f"  clinic_otp_provider        : {conf.get('clinic_otp_provider') or '(unset -> console)'}")
    print(f"  developer_mode             : {conf.get('developer_mode') or 0}")
    print(f"  clinic_evolution_url       : {conf.get('clinic_evolution_url') or '(not set)'}")
    print(f"  clinic_evolution_instance  : {conf.get('clinic_evolution_instance') or '(not set)'}")
    print(f"  clinic_evolution_api_key   : {_mask(conf.get('clinic_evolution_api_key'))}")
    print(f"  verify_number              : {conf.get('clinic_evolution_verify_number', 1)}")
    print(f"  timeout                    : {conf.get('clinic_evolution_timeout') or 10}s")

    url = (conf.get("clinic_evolution_url") or "").rstrip("/")
    key = conf.get("clinic_evolution_api_key")
    instance = conf.get("clinic_evolution_instance")

    if not (url and key and instance):
        print("\n  RESULT: incomplete -- set the three clinic_evolution_* keys.")
        print("  See backend/site_config.example.json\n")
        return {"ok": False, "reason": "incomplete configuration"}

    try:
        import requests
    except ImportError:
        print("\n  RESULT: the 'requests' package is unavailable in this bench env.\n")
        return {"ok": False, "reason": "requests missing"}

    timeout = int(conf.get("clinic_evolution_timeout") or 10)

    # 1. Is the instance reachable and CONNECTED to WhatsApp?
    print("\n--- instance state ---")
    try:
        response = requests.get(
            f"{url}/instance/connectionState/{instance}",
            headers={"apikey": key},
            timeout=timeout,
        )
        print(f"  GET /instance/connectionState/{instance} -> HTTP {response.status_code}")
        if response.status_code == 401:
            print("  The apikey was rejected. Check clinic_evolution_api_key.")
            return {"ok": False, "reason": "unauthorised"}
        if response.status_code == 404:
            print(f"  No instance named '{instance}'. Check clinic_evolution_instance.")
            return {"ok": False, "reason": "unknown instance"}

        body = response.json()
        state = (
            (body.get("instance") or {}).get("state")
            if isinstance(body, dict) else None
        ) or body
        print(f"  state: {state}")

        if str(state).lower() not in ("open", "connected"):
            print("\n  RESULT: the instance is not connected to WhatsApp.")
            print("  Scan the QR in the Evolution manager, then re-run this.\n")
            return {"ok": False, "reason": "instance not connected", "state": state}
    except Exception as exc:
        print(f"  Could not reach {url} -- {type(exc).__name__}: {exc}")
        print("\n  RESULT: unreachable. Check the URL, and that this server can")
        print("  route to it (a container may need a host IP, not localhost).\n")
        return {"ok": False, "reason": "unreachable"}

    result = {"ok": True, "state": "connected"}

    # 2. Optionally, does a specific number have WhatsApp?
    if phone_number:
        from clinic_core.api.v1.phone import normalize
        from clinic_core.otp.providers import WhatsAppOtpProvider

        phone = normalize(phone_number)
        print(f"\n--- number check: {phone} ---")
        exists = WhatsAppOtpProvider().has_whatsapp(phone)
        if exists is True:
            print("  registered on WhatsApp -- an OTP would be delivered.")
        elif exists is False:
            print("  NOT on WhatsApp -- request_otp would refuse with a clear error.")
        else:
            print("  inconclusive (the check failed). The send would be attempted anyway.")
        result["number"] = phone
        result["has_whatsapp"] = exists

    print("\n  RESULT: configuration looks good.\n")
    return result


def send_test(phone_number=None):
    """Send a real WhatsApp message to prove delivery end to end.

    Uses an obviously-fake code, so a message that leaks cannot be mistaken for
    a live OTP, and no `Patient OTP Request` row is created.
    """
    if not phone_number:
        frappe.throw("phone_number is required.")

    from clinic_core.api.v1.phone import normalize
    from clinic_core.otp import get_provider
    from clinic_core.otp.base import NotAWhatsAppNumberError, OtpDeliveryError

    phone = normalize(phone_number)
    provider = get_provider()
    print(f"\nprovider: {provider.name}  ->  {phone}")

    try:
        outcome = provider.send(phone, "000000", "login")
    except NotAWhatsAppNumberError:
        print("  REFUSED: that number is not registered on WhatsApp.\n")
        return {"ok": False, "reason": "not a whatsapp number"}
    except OtpDeliveryError as exc:
        print(f"  FAILED: {exc}")
        print("  Run clinic_core.otp.diagnose.check for detail.\n")
        return {"ok": False, "reason": str(exc)}

    print(f"  sent: {outcome}")
    print("  Check the handset -- the body should read '000000 is your clinic verification code'.\n")
    return {"ok": True, **(outcome or {})}
