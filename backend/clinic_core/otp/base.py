"""The OtpProvider contract every transport implements."""

from frappe import _


class OtpDeliveryError(Exception):
    """The code could not be handed to the transport.

    Raised by providers, caught by patient_auth, and translated into a generic
    "we could not send the code" -- the caller never learns which provider ran
    or why it failed.
    """


class NotAWhatsAppNumberError(OtpDeliveryError):
    """The number the patient typed has no WhatsApp account.

    Deliberately distinct from its parent: this is the one delivery failure the
    patient can actually DO something about, so it earns a specific message
    ("use a number with WhatsApp") instead of the generic "we could not send".

    It is a subclass, so any handler that only knows about OtpDeliveryError
    still catches it and fails safe.

    Note the privacy trade-off, which is deliberate. Every other OTP response is
    identical regardless of the number, so the endpoint cannot be used to probe
    which numbers hold accounts. This one is different -- it reveals whether a
    number is on WhatsApp. That is a fact about WhatsApp, not about this clinic:
    it says nothing about whether the number belongs to a patient here, and
    anyone can learn it from WhatsApp directly. The alternative is leaving a
    patient staring at a code that can never arrive.
    """


class OtpProvider:
    """Send a one-time code to a phone number.

    Implementations must:
      * never persist or log the plaintext code (ConsoleOtpProvider is the one
        deliberate, developer-mode-only exception)
      * raise OtpDeliveryError on failure rather than returning a falsy value,
        so a silent non-delivery cannot be mistaken for success
      * be safe to call from a web request (short timeouts, no retries that
        would hold the request open)
    """

    #: Shown in diagnostics; keep it short and non-secret.
    name = "base"

    def send(self, phone_e164, code, purpose="login"):
        raise NotImplementedError

    def message(self, code, purpose="login"):
        """The SMS/WhatsApp body. Kept here so every transport words it alike."""
        if purpose == "change_phone":
            return _(
                "{0} is your verification code to change the mobile number on your "
                "clinic account. It expires in 5 minutes. If you did not request "
                "this, ignore this message."
            ).format(code)
        return _(
            "{0} is your clinic verification code. It expires in 5 minutes. "
            "Never share it with anyone, including clinic staff."
        ).format(code)
