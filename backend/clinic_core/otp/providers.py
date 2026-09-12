"""Concrete OTP transports.

Only `console` and `null` are usable out of the box. `sms` (Frappe's SMS
Settings gateway) and `whatsapp` (a self-hosted Evolution API instance) are real
implementations, but both stay inert until the clinic configures credentials --
they raise OtpDeliveryError rather than pretending to send.
"""

import frappe
from frappe import _

from clinic_core.otp.base import (
    NotAWhatsAppNumberError,
    OtpDeliveryError,
    OtpProvider,
)


class NullOtpProvider(OtpProvider):
    """Drops the code. For automated tests, which read the hash directly."""

    name = "null"

    def send(self, phone_e164, code, purpose="login"):
        return {"provider": self.name, "delivered": False}


class ConsoleOtpProvider(OtpProvider):
    """Prints the code to the bench log. DEVELOPMENT ONLY.

    This is the one place in the codebase that touches a plaintext OTP after it
    leaves the generator, so it is fenced twice: it refuses outside
    developer_mode, and it says loudly what it is doing.
    """

    name = "console"

    def send(self, phone_e164, code, purpose="login"):
        if not frappe.conf.get("developer_mode"):
            # Failing closed matters here. If a production site is missing its
            # provider config, the right outcome is "no code was sent" -- not
            # "the code went to a log file that support staff can read".
            frappe.log_error(
                title="clinic_core: OTP console provider blocked",
                message=(
                    "ConsoleOtpProvider refused to run because developer_mode is "
                    "off. Set 'clinic_otp_provider' in site_config.json to a real "
                    "transport (sms/whatsapp)."
                ),
            )
            raise OtpDeliveryError("console provider is not allowed outside developer_mode")

        print(f"\n[clinic_core OTP] {purpose} code for {phone_e164}: {code}\n", flush=True)
        frappe.logger("clinic_core").info(f"OTP({purpose}) issued for {phone_e164}")
        return {"provider": self.name, "delivered": True}


class SmsOtpProvider(OtpProvider):
    """Sends via Frappe's built-in SMS Settings gateway."""

    name = "sms"

    def send(self, phone_e164, code, purpose="login"):
        try:
            from frappe.core.doctype.sms_settings.sms_settings import send_sms
        except Exception as exc:
            raise OtpDeliveryError(f"SMS module unavailable: {exc}")

        gateway = frappe.db.get_single_value("SMS Settings", "sms_gateway_url")
        if not gateway:
            raise OtpDeliveryError("SMS Settings is not configured")

        try:
            send_sms([phone_e164], self.message(code, purpose))
        except Exception as exc:
            # The gateway's own error text may contain the request URL, which can
            # embed an API key -- never let it propagate to the caller.
            frappe.log_error(
                title="clinic_core: SMS OTP send failed",
                message=frappe.get_traceback(),
            )
            raise OtpDeliveryError("sms gateway rejected the message") from exc

        return {"provider": self.name, "delivered": True}


class WhatsAppOtpProvider(OtpProvider):
    """WhatsApp via a self-hosted **Evolution API** instance.

    Configuration (site_config.json):

        "clinic_evolution_url":       "https://evo.example.com"   (no trailing /)
        "clinic_evolution_api_key":   "<the instance's apikey>"
        "clinic_evolution_instance":  "<instance name>"
        "clinic_evolution_verify_number": 1     (optional, default 1)
        "clinic_evolution_timeout":   10        (optional, seconds)

    Evolution is a WhatsApp Web bridge, not Meta's Cloud API, so there is no
    template approval step -- a plain text message is sent from the linked
    account. That is why the code goes out as `message(...)` text rather than a
    template payload.

    Two calls per send:

      1. POST /chat/whatsappNumbers/{instance}  -- does this number have WhatsApp?
      2. POST /message/sendText/{instance}      -- send the code

    Step 1 exists because Evolution's send accepts an unregistered number and
    reports success while the message silently goes nowhere. A patient would sit
    on the verify screen waiting for a code that can never arrive; checking first
    turns that into an immediate, actionable "this number has no WhatsApp".
    """

    name = "whatsapp"

    # --- configuration ---------------------------------------------------- #
    def _config(self):
        url = (frappe.conf.get("clinic_evolution_url") or "").rstrip("/")
        key = frappe.conf.get("clinic_evolution_api_key")
        instance = frappe.conf.get("clinic_evolution_instance")
        if not url or not key or not instance:
            raise OtpDeliveryError("Evolution API credentials are not configured")
        return url, key, instance

    def _timeout(self):
        try:
            return max(3, int(frappe.conf.get("clinic_evolution_timeout") or 10))
        except (TypeError, ValueError):
            return 10

    # --- number validation ------------------------------------------------ #
    def has_whatsapp(self, phone_e164):
        """True/False if Evolution could answer, None if it could not.

        None (rather than False) matters: a network blip or an unexpected
        response shape must NOT be reported as "this number has no WhatsApp".
        Telling a patient their number is invalid when the checker simply failed
        would lock them out of their own records, so an inconclusive check falls
        through to attempting the send.
        """
        url, key, instance = self._config()
        number = phone_e164.lstrip("+")

        try:
            import requests

            response = requests.post(
                f"{url}/chat/whatsappNumbers/{instance}",
                headers={"apikey": key, "Content-Type": "application/json"},
                json={"numbers": [number]},
                timeout=self._timeout(),
            )
            response.raise_for_status()
            payload = response.json()
        except Exception:
            frappe.log_error(
                title="clinic_core: Evolution number check failed",
                message=frappe.get_traceback(),
            )
            return None

        # Evolution returns a list like:
        #   [{"exists": true, "jid": "923001234567@s.whatsapp.net", "number": "..."}]
        rows = payload if isinstance(payload, list) else payload.get("data") or []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if str(row.get("number", "")).lstrip("+").endswith(number[-9:]) or len(rows) == 1:
                exists = row.get("exists")
                if isinstance(exists, bool):
                    return exists

        # Understood the call but not the answer -- treat as inconclusive.
        return None

    # --- send -------------------------------------------------------------- #
    def send(self, phone_e164, code, purpose="login"):
        url, key, instance = self._config()
        number = phone_e164.lstrip("+")

        # Verify first, unless explicitly disabled.
        if frappe.conf.get("clinic_evolution_verify_number", 1):
            exists = self.has_whatsapp(phone_e164)
            if exists is False:
                raise NotAWhatsAppNumberError(
                    "the number is not registered on WhatsApp"
                )
            # exists is None -> inconclusive; fall through and try the send.

        try:
            import requests

            response = requests.post(
                f"{url}/message/sendText/{instance}",
                headers={"apikey": key, "Content-Type": "application/json"},
                json={
                    "number": number,
                    "text": self.message(code, purpose),
                },
                timeout=self._timeout(),
            )
            response.raise_for_status()
        except NotAWhatsAppNumberError:
            raise
        except Exception as exc:
            frappe.log_error(
                title="clinic_core: Evolution OTP send failed",
                # The traceback carries the URL and status but never the apikey,
                # which travels in a header.
                message=frappe.get_traceback(),
            )
            raise OtpDeliveryError("evolution api rejected the message") from exc

        return {"provider": self.name, "delivered": True}
