#!/usr/bin/env python3
"""
End-to-end validation of the clinic backend over REAL HTTP.

Exercises the full Step-18 scenario against the clinic_core API:
  ADMIN        -> verify seeded doctor / receptionist / patients
  RECEPTIONIST -> find patient, list slots, book appointment
               -> attempt the SAME slot again  => must CONFLICT (409)
  DOCTOR       -> see appointment, open patient, create + submit encounter
  BILLING      -> create consultation invoice, submit, record partial payment,
                  then settle in full; verify outstanding/status at each step
  SECURITY     -> patient A vs patient B, guest access, role boundaries

Exit code 0 only if every check passes.

Usage: python3 e2e_scenario.py [base_url]
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar
from datetime import date, timedelta

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
API = f"{BASE}/api/method/clinic_core.api.v1"

PASSWORD = "TestPass123!"
ADMIN = ("admin.clinic@test.local", PASSWORD)
RECEPTION = ("reception@test.local", PASSWORD)
DOCTOR = ("doctor@test.local", PASSWORD)
PATIENT_A = ("patienta@test.local", PASSWORD)
PATIENT_B = ("patientb@test.local", PASSWORD)

PASSED, FAILED = [], []


# --------------------------------------------------------------------------- #
class Client:
    """One HTTP session (own cookie jar) = one logged-in user."""

    def __init__(self, label):
        self.label = label
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, path, payload=None, method="POST"):
        url = f"{API}.{path}"
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=60) as r:
                body = json.loads(r.read().decode() or "{}")
                return r.status, body
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                return e.code, json.loads(raw or "{}")
            except ValueError:
                return e.code, {"_raw": raw[:400]}

    def login(self, creds):
        status, body = self.call("auth.login", {"usr": creds[0], "pwd": creds[1]})
        msg = body.get("message", body)
        if not (isinstance(msg, dict) and msg.get("success")):
            raise SystemExit(f"LOGIN FAILED for {creds[0]}: {status} {body}")
        return msg["data"]


def envelope(body):
    """Frappe wraps whitelisted return values in {"message": ...}."""
    return body.get("message", body) if isinstance(body, dict) else body


def check(name, cond, detail=""):
    if cond:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append(f"{name} :: {detail}")
        print(f"  FAIL  {name}  {detail}")


def section(t):
    print(f"\n{'=' * 68}\n{t}\n{'=' * 68}")


# --------------------------------------------------------------------------- #
def next_weekday(offset_weeks=0):
    """A weekday in the future -- the seeded schedule is Mon-Fri 09:00-17:00."""
    d = date.today() + timedelta(days=1)
    while d.weekday() > 4:  # 5=Sat, 6=Sun
        d += timedelta(days=1)
    return d + timedelta(weeks=offset_weeks)


def unique_booking():
    """Pick a (date, time) unlikely to collide with a previous run.

    The scenario must be re-runnable. Two constraints from Marley matter:
      * an identical practitioner/date/time is the CONFLICT we deliberately test
      * Marley also rejects a second appointment for the SAME PATIENT on the same
        day ("Patient already has an appointment booked for the same day!")
    So each run picks a distinct future weekday, not just a distinct time.
    """
    import datetime as _dt
    now = _dt.datetime.now()
    # Spread runs across the next ~8 working weeks.
    offset_days = (now.timetuple().tm_yday * 24 + now.hour) % 40
    d = date.today() + timedelta(days=1 + offset_days)
    while d.weekday() > 4:
        d += timedelta(days=1)
    idx = (now.minute + now.second) % 15
    hour = 9 + idx // 2
    minute = 30 if idx % 2 else 0
    return d.isoformat(), f"{hour:02d}:{minute:02d}:00"


def main():
    section("1. ADMIN — verify seeded data")
    admin = Client("admin")
    prof = admin.login(ADMIN)
    check("admin logs in", prof["user"] == ADMIN[0], str(prof))
    check("admin has admin persona",
          prof["persona"] in ("admin", "practitioner"), prof.get("persona"))

    s, b = admin.call("practitioners.list_practitioners", {}, "POST")
    env = envelope(b)
    items = (env.get("data") or {}).get("items", [])
    names = [i["name"] for i in items]
    check("Dr Test Doctor exists", "Dr Test Doctor" in names, str(names))
    doctor_name = "Dr Test Doctor"

    s, b = admin.call("practitioners.availability", {"practitioner": doctor_name})
    env = envelope(b)
    scheds = (env.get("data") or {}).get("schedules", [])
    days = {sl["day"] for sc in scheds for sl in sc["slots"]}
    check("doctor scheduled Mon-Fri",
          {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday"} <= days, str(days))

    # ---------------------------------------------------------------------- #
    section("2. RECEPTIONIST — find patient and book")
    recep = Client("reception")
    rprof = recep.login(RECEPTION)
    check("receptionist logs in", rprof["user"] == RECEPTION[0])

    s, b = recep.call("patients.list_patients", {"search": "Test Patient A"})
    env = envelope(b)
    found = (env.get("data") or {}).get("items", [])
    check("receptionist can search patients", len(found) >= 1, str(env)[:200])
    patient_a = found[0]["name"] if found else None

    book_date, book_time = unique_booking()
    print(f"  (booking {doctor_name} on {book_date} at {book_time})")

    s, b = recep.call("appointments.available_slots",
                      {"practitioner": doctor_name, "date": book_date})
    env = envelope(b)
    check("slots endpoint responds", env.get("success") is True, str(env)[:300])
    slots = (env.get("data") or {}).get("slot_details", [])
    check("slots returned for a working weekday", bool(slots), str(env)[:250])

    appt_payload = {"payload": {
        "patient": patient_a,
        "practitioner": doctor_name,
        "appointment_date": book_date,
        "appointment_time": book_time,
        "duration": 30,
    }}
    s, b = recep.call("appointments.create_appointment", appt_payload)
    env = envelope(b)
    ok1 = env.get("success") is True
    check("receptionist books appointment", ok1, str(env)[:300])
    appt_id = (env.get("data") or {}).get("name") if ok1 else None

    s, b = recep.call("appointments.list_appointments", {"patient": patient_a})
    env = envelope(b)
    ids = [a["name"] for a in (env.get("data") or {}).get("items", [])]
    check("appointment appears in list", appt_id in ids if appt_id else False, str(ids))

    # -- the conflict test --------------------------------------------------
    s, b = recep.call("appointments.create_appointment", appt_payload)
    env = envelope(b)
    is_conflict = (env.get("success") is False
                   and (env.get("error") or {}).get("code") == "CONFLICT")
    check("DOUBLE-BOOKING REJECTED (409 CONFLICT)", is_conflict, str(env)[:300])

    # ---------------------------------------------------------------------- #
    section("3. DOCTOR — encounter")
    doc = Client("doctor")
    dprof = doc.login(DOCTOR)
    check("doctor logs in", dprof["user"] == DOCTOR[0])
    check("doctor linked to practitioner record",
          dprof.get("practitioner") == doctor_name, str(dprof.get("practitioner")))

    s, b = doc.call("appointments.list_appointments", {})
    env = envelope(b)
    dids = [a["name"] for a in (env.get("data") or {}).get("items", [])]
    check("doctor sees the appointment", appt_id in dids if appt_id else False, str(dids)[:200])

    s, b = doc.call("encounters.create_encounter", {"payload": {
        "patient": patient_a,
        "practitioner": doctor_name,
        "appointment": appt_id,
        "symptoms": "TEST symptom: headache",
        "diagnosis": "TEST diagnosis: tension headache",
        "encounter_comment": "TEST clinical note - synthetic data only",
    }})
    env = envelope(b)
    enc_ok = env.get("success") is True
    check("doctor creates encounter", enc_ok, str(env)[:300])
    enc_id = (env.get("data") or {}).get("name") if enc_ok else None

    if enc_id:
        s, b = doc.call("encounters.get_encounter", {"encounter": enc_id})
        env = envelope(b)
        d = env.get("data") or {}
        check("doctor sees clinical detail", d.get("clinical_access") is True, str(d)[:200])

        s, b = doc.call("encounters.submit_encounter", {"encounter": enc_id})
        env = envelope(b)
        check("doctor submits encounter", env.get("success") is True, str(env)[:200])

    # ---------------------------------------------------------------------- #
    section("4. BILLING — invoice and payment")
    s, b = admin.call("invoices.create_consultation_invoice", {"payload": {
        "patient": patient_a,
        "practitioner": doctor_name,
        "rate": 1000,
        "submit": True,
    }})
    env = envelope(b)
    inv_ok = env.get("success") is True
    check("consultation invoice created+submitted", inv_ok, str(env)[:400])
    inv = (env.get("data") or {}) if inv_ok else {}
    inv_id = inv.get("name")
    check("invoice total is 1000", float(inv.get("grand_total") or 0) == 1000.0, str(inv))
    check("invoice starts unpaid", inv.get("payment_status") == "unpaid", str(inv.get("payment_status")))

    if inv_id:
        # partial payment
        s, b = admin.call("payments.record_payment",
                          {"payload": {"invoice": inv_id, "amount": 400}})
        env = envelope(b)
        pay_ok = env.get("success") is True
        check("partial payment recorded", pay_ok, str(env)[:400])
        if pay_ok:
            d = env["data"]
            check("outstanding is 600 after partial",
                  abs(float(d["outstanding_amount"]) - 600.0) < 0.01, str(d))
            check("not fully paid yet", d["fully_paid"] is False, str(d))

        s, b = admin.call("invoices.get_invoice", {"invoice": inv_id})
        env = envelope(b)
        d = env.get("data") or {}
        check("status reads partially_paid",
              d.get("payment_status") == "partially_paid", str(d.get("payment_status")))

        # settle remainder
        s, b = admin.call("payments.record_payment",
                          {"payload": {"invoice": inv_id, "amount": 600}})
        env = envelope(b)
        if env.get("success"):
            d = env["data"]
            check("outstanding is 0 after full payment",
                  abs(float(d["outstanding_amount"])) < 0.01, str(d))
            check("invoice fully paid", d["fully_paid"] is True, str(d))
        else:
            check("final payment recorded", False, str(env)[:300])

        s, b = admin.call("invoices.get_invoice", {"invoice": inv_id})
        env = envelope(b)
        d = env.get("data") or {}
        check("status reads paid", d.get("payment_status") == "paid", str(d.get("payment_status")))

        # overpayment must be refused
        s, b = admin.call("payments.record_payment",
                          {"payload": {"invoice": inv_id, "amount": 100}})
        env = envelope(b)
        check("overpayment rejected", env.get("success") is False, str(env)[:200])

    # ---------------------------------------------------------------------- #
    section("5. SECURITY — cross-role and horizontal access")
    pa = Client("patientA"); pa.login(PATIENT_A)
    pb = Client("patientB"); pb.login(PATIENT_B)

    s, b = pb.call("auth.me", {})
    patient_b_id = (envelope(b).get("data") or {}).get("patient")

    # A -> B
    s, b = pa.call("patients.get_patient", {"patient": patient_b_id})
    env = envelope(b)
    denied = (env.get("success") is False
              and (env.get("error") or {}).get("code") == "FORBIDDEN")
    check("Patient A CANNOT read Patient B", denied, str(env)[:250])
    check("  -> HTTP 403", s == 403, f"got {s}")

    s, b = pa.call("patients.update_patient",
                   {"patient": patient_b_id, "payload": {"mobile": "+920000000000"}})
    env = envelope(b)
    check("Patient A CANNOT modify Patient B",
          env.get("success") is False, str(env)[:250])

    s, b = pa.call("appointments.list_appointments", {"patient": patient_b_id})
    env = envelope(b)
    rows = (env.get("data") or {}).get("items", [])
    leaked = [r for r in rows if r.get("patient") == patient_b_id]
    check("Patient A CANNOT list Patient B appointments", not leaked, str(rows)[:200])

    # A -> own record must work
    s, b = pa.call("patients.get_patient", {})
    env = envelope(b)
    check("Patient A CAN read own record", env.get("success") is True, str(env)[:200])

    # patient cannot use staff endpoints
    s, b = pa.call("patients.list_patients", {})
    env = envelope(b)
    check("Patient CANNOT list all patients",
          env.get("success") is False, str(env)[:200])

    s, b = pa.call("patients.create_patient", {"payload": {"first_name": "X", "sex": "Male"}})
    env = envelope(b)
    check("Patient CANNOT create patients", env.get("success") is False, str(env)[:200])

    # receptionist clinical-note policy
    if enc_id:
        s, b = recep.call("encounters.get_encounter", {"encounter": enc_id})
        env = envelope(b)
        d = env.get("data") or {}
        check("Receptionist sees encounter WITHOUT clinical detail",
              d.get("clinical_access") is False and "diagnosis" not in d, str(d)[:250])

        s, b = recep.call("encounters.create_encounter",
                          {"payload": {"patient": patient_a, "symptoms": "x"}})
        env = envelope(b)
        check("Receptionist CANNOT create encounter",
              env.get("success") is False, str(env)[:200])

    # patient cannot record payments
    if inv_id:
        s, b = pa.call("payments.record_payment", {"payload": {"invoice": inv_id, "amount": 1}})
        env = envelope(b)
        check("Patient CANNOT record payment", env.get("success") is False, str(env)[:200])

    # unauthenticated
    guest = Client("guest")
    for ep, args in (("patients.list_patients", {}),
                     ("appointments.list_appointments", {}),
                     ("auth.me", {})):
        s, b = guest.call(ep, args)
        env = envelope(b)
        bad = env.get("success") is False or s in (401, 403)
        check(f"Guest blocked from {ep}", bad, f"status={s} {str(env)[:150]}")

    # ---------------------------------------------------------------------- #
    section("RESULT")
    print(f"passed: {len(PASSED)}   failed: {len(FAILED)}")
    if FAILED:
        print("\nFAILURES:")
        for f in FAILED:
            print("  - " + f)
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
