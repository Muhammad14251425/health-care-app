"""
Self-test for the Evolution API OTP provider, against a stub HTTP server.

Proves the real behaviour without needing live credentials or sending a real
message:

  * a number WITH WhatsApp    -> code sent; correct endpoint, payload and header
  * a number WITHOUT WhatsApp -> NotAWhatsAppNumberError, and NOTHING is sent
  * the checker itself fails  -> inconclusive, the send is still attempted
  * missing credentials       -> OtpDeliveryError, with no network call at all
  * request_otp end-to-end    -> the patient-facing "use a WhatsApp number" error

Run:

    bench --site clinic.localhost execute clinic_core.otp.evo_selftest.run

It restores every site_config value it touches, and creates no OTP rows.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import frappe

# Shared state between the stub server and the assertions.
CALLS = []
NUMBERS_WITH_WA = {"923001111111"}
CHECK_FAILS = {"value": False}

CONF_KEYS = (
    "clinic_evolution_url",
    "clinic_evolution_api_key",
    "clinic_evolution_instance",
    "clinic_evolution_verify_number",
    "clinic_otp_provider",
)


class _StubEvolution(BaseHTTPRequestHandler):
    """Minimal stand-in for an Evolution instance."""

    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _reply(self, status, payload):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        CALLS.append({
            "path": self.path,
            "body": body,
            "apikey": self.headers.get("apikey"),
        })

        if "/chat/whatsappNumbers/" in self.path:
            if CHECK_FAILS["value"]:
                self._reply(500, {"error": "boom"})
                return
            number = (body.get("numbers") or [""])[0]
            self._reply(200, [{
                "exists": number in NUMBERS_WITH_WA,
                "number": number,
                "jid": f"{number}@s.whatsapp.net",
            }])
            return

        if "/message/sendText/" in self.path:
            self._reply(201, {"key": {"id": "STUB"}})
            return

        self._reply(404, {"error": "not found"})

    def do_GET(self):
        if "/instance/connectionState/" in self.path:
            self._reply(200, {"instance": {"state": "open"}})
            return
        self._reply(404, {"error": "not found"})


def run():
    from clinic_core.api.v1 import patient_auth as pa
    from clinic_core.otp import get_provider
    from clinic_core.otp.base import NotAWhatsAppNumberError, OtpDeliveryError
    from clinic_core.otp.providers import WhatsAppOtpProvider

    tally = {"passed": 0, "failed": 0}

    def check(name, condition, detail=""):
        if condition:
            tally["passed"] += 1
            print(f"  PASS  {name}")
        else:
            tally["failed"] += 1
            print(f"  FAIL  {name}  {detail}")

    server = ThreadingHTTPServer(("127.0.0.1", 0), _StubEvolution)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    original = {k: frappe.conf.get(k) for k in CONF_KEYS}

    try:
        frappe.conf["clinic_evolution_url"] = f"http://127.0.0.1:{port}"
        frappe.conf["clinic_evolution_api_key"] = "TEST-APIKEY-123"
        frappe.conf["clinic_evolution_instance"] = "clinic"
        frappe.conf["clinic_evolution_verify_number"] = 1

        provider = WhatsAppOtpProvider()

        # ---- a number that HAS WhatsApp ---------------------------------- #
        print("\n=== number WITH WhatsApp ===")
        CALLS.clear()
        outcome = provider.send("+923001111111", "424242", "login")

        check("send reports delivered", outcome.get("delivered") is True, str(outcome))
        check("exactly 2 calls: check then send", len(CALLS) == 2, str(len(CALLS)))
        if len(CALLS) == 2:
            check("1st call checks the number",
                  "/chat/whatsappNumbers/clinic" in CALLS[0]["path"], CALLS[0]["path"])
            check("2nd call is sendText",
                  "/message/sendText/clinic" in CALLS[1]["path"], CALLS[1]["path"])
            check("apikey travels in the header (not the URL)",
                  CALLS[1]["apikey"] == "TEST-APIKEY-123", str(CALLS[1]["apikey"]))
            check("number sent without the leading '+'",
                  CALLS[1]["body"].get("number") == "923001111111", str(CALLS[1]["body"]))
            check("the code is in the message body",
                  "424242" in (CALLS[1]["body"].get("text") or ""), str(CALLS[1]["body"]))

        # ---- a number that does NOT have WhatsApp ------------------------ #
        print("\n=== number WITHOUT WhatsApp ===")
        CALLS.clear()
        try:
            provider.send("+923009999999", "555555", "login")
            check("refuses an unregistered number", False, "no exception raised")
        except NotAWhatsAppNumberError:
            check("refuses an unregistered number", True)
        except Exception as exc:
            check("refuses an unregistered number", False,
                  f"wrong type: {type(exc).__name__}")
        check("no message was sent",
              all("/message/sendText" not in c["path"] for c in CALLS),
              str([c["path"] for c in CALLS]))

        # ---- the checker itself fails: must fail OPEN -------------------- #
        print("\n=== number check errors -> inconclusive, still send ===")
        CALLS.clear()
        CHECK_FAILS["value"] = True
        try:
            outcome = provider.send("+923009999999", "777777", "login")
            check("still attempts the send", outcome.get("delivered") is True, str(outcome))
            check("sendText was called",
                  any("/message/sendText" in c["path"] for c in CALLS))
        except Exception as exc:
            check("still attempts the send", False, f"{type(exc).__name__}: {exc}")
        CHECK_FAILS["value"] = False

        # ---- has_whatsapp() directly ------------------------------------- #
        print("\n=== has_whatsapp() ===")
        check("True for a registered number",
              provider.has_whatsapp("+923001111111") is True)
        check("False for an unregistered number",
              provider.has_whatsapp("+923009999999") is False)
        CHECK_FAILS["value"] = True
        check("None (not False) when the check errors",
              provider.has_whatsapp("+923001111111") is None)
        CHECK_FAILS["value"] = False

        # ---- missing credentials ----------------------------------------- #
        print("\n=== missing credentials ===")
        frappe.conf["clinic_evolution_api_key"] = None
        CALLS.clear()
        try:
            provider.send("+923001111111", "111111", "login")
            check("refuses without credentials", False, "no exception raised")
        except NotAWhatsAppNumberError:
            check("refuses without credentials", False, "wrong exception type")
        except OtpDeliveryError:
            check("refuses without credentials", True)
        check("no network call attempted", len(CALLS) == 0, str(len(CALLS)))
        frappe.conf["clinic_evolution_api_key"] = "TEST-APIKEY-123"

        # ---- end to end through request_otp ------------------------------ #
        print("\n=== request_otp for a non-WhatsApp number ===")
        frappe.conf["clinic_otp_provider"] = "whatsapp"
        frappe.db.delete("Patient OTP Request", {"phone_e164": "+923009999999"})
        frappe.db.commit()
        pa.clear_rate_limit(phone_number="+923009999999")

        frappe.set_user("Guest")
        result = pa.request_otp(phone_number="03009999999")
        print("   ->", json.dumps(result)[:200])

        check("request_otp refuses", result.get("success") is False, str(result))
        message = (result.get("error") or {}).get("message", "")
        check("the message names WhatsApp and is actionable",
              "WhatsApp" in message, message)
        check("no OTP row was left behind",
              frappe.db.count("Patient OTP Request",
                              {"phone_e164": "+923009999999"}) == 0)

        # ---- provider aliasing ------------------------------------------- #
        print("\n=== 'evolution' selects the same provider ===")
        frappe.conf["clinic_otp_provider"] = "evolution"
        check("evolution -> WhatsAppOtpProvider",
              type(get_provider()).__name__ == "WhatsAppOtpProvider")
        frappe.conf["clinic_otp_provider"] = "whatsapp"
        check("whatsapp -> WhatsAppOtpProvider",
              type(get_provider()).__name__ == "WhatsAppOtpProvider")

    finally:
        for key, value in original.items():
            frappe.conf[key] = value
        frappe.set_user("Administrator")
        server.shutdown()

    print(f"\n{'=' * 58}")
    print(f"RESULT: {tally['passed']} passed, {tally['failed']} failed")
    print(f"{'=' * 58}\n")
    return tally
