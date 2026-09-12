"""
clinic_core.otp -- OTP delivery, decoupled from any one provider.

The clinic may send codes by SMS today and WhatsApp tomorrow, or run both. None
of that belongs in the authentication logic, so `patient_auth` only ever calls
`get_provider().send(...)` and never knows which transport ran.

Selection (site_config.json):

    "clinic_otp_provider": "console" | "null" | "sms" | "whatsapp"

Provider credentials live in site_config.json on the SERVER. A mobile app never
holds an SMS gateway key -- it would be extractable from the bundle, and any
holder could send messages billed to the clinic.

Safety rail: `console` prints the code to the server log. That is fine for
development and catastrophic in production, so it refuses to run unless the site
is in developer_mode (see ConsoleOtpProvider.send).
"""

import frappe

from clinic_core.otp.base import (
    NotAWhatsAppNumberError,
    OtpDeliveryError,
    OtpProvider,
)
from clinic_core.otp.providers import (
    ConsoleOtpProvider,
    NullOtpProvider,
    SmsOtpProvider,
    WhatsAppOtpProvider,
)

_REGISTRY = {
    "console": ConsoleOtpProvider,
    "null": NullOtpProvider,
    "sms": SmsOtpProvider,
    # Both names select the same transport. "whatsapp" says what the patient
    # receives; "evolution" says which server sends it. Accepting both means a
    # config written either way works rather than silently falling back to the
    # console provider.
    "whatsapp": WhatsAppOtpProvider,
    "evolution": WhatsAppOtpProvider,
}

DEFAULT_PROVIDER = "console"


def get_provider(name=None):
    """Instantiate the configured provider.

    Unknown names fall back to the default rather than raising: an OTP transport
    misconfiguration should surface as "we could not send the code", not as a
    500 that leaks the config value back to the caller.
    """
    key = (name
           or frappe.conf.get("clinic_otp_provider")
           or DEFAULT_PROVIDER).strip().lower()

    provider = _REGISTRY.get(key)
    if not provider:
        frappe.log_error(
            title="clinic_core: unknown OTP provider",
            message=f"clinic_otp_provider={key!r} is not registered; using {DEFAULT_PROVIDER}.",
        )
        provider = _REGISTRY[DEFAULT_PROVIDER]

    return provider()


__all__ = [
    "get_provider",
    "OtpProvider",
    "OtpDeliveryError",
    "NotAWhatsAppNumberError",
    "ConsoleOtpProvider",
    "NullOtpProvider",
    "SmsOtpProvider",
    "WhatsAppOtpProvider",
]
