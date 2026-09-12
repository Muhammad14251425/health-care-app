"""
Patient account: phone normalisation, OTP policy, and cross-patient isolation.

Run:
    bench --site clinic.localhost run-tests --app clinic_core \
        --module clinic_core.tests.test_patient_portal

These tests exercise the real endpoints in-process. The HTTP-level equivalents
(which also prove session issuance and the mobile client's behaviour) live in
mobile/docs/PATIENT_SECURITY_TESTS.md.

Note on recovering OTP codes: the plaintext is never stored, so the tests
brute-force sha256(salt + code) over the 10^6 six-digit space -- exactly the work
an attacker would face offline, and fast enough here. The implementation is NOT
weakened to make testing easier.
"""

import hashlib

import frappe
from frappe.tests.utils import FrappeTestCase

from clinic_core.api.response import ApiError
from clinic_core.api.v1 import (
    patient as patient_api,
    patient_appointments as appt_api,
    patient_auth,
    patient_billing as billing_api,
    patient_records as records_api,
)
from clinic_core.api.v1.phone import normalize

# Numbers reserved for THIS suite.
#
# They must not collide with any other fixture: a phone number is a unique
# identity, so if another test (or a manual HTTP run) has already bound one of
# these to a different Patient, the mapping correctly refuses to move it and
# these tests would fail for a data reason rather than a code one.
PHONE_A = "+923451220001"
PHONE_B = "+923451220002"

# National spelling of PHONE_A, used to prove format equivalence.
PHONE_A_NATIONAL = "03451220001"


class _NullProvider:
    """Force the OTP transport to `null` for the duration of a test class.

    Without this the suite inherits whatever the SITE is configured to use. Once
    a real WhatsApp provider is configured, these tests' fictional numbers are
    (correctly) refused as not-on-WhatsApp, so no code is ever issued and every
    login-dependent test fails -- for a reason that has nothing to do with what
    it is testing.

    The transport is not what these tests are about: they exercise hashing,
    expiry, single use, the attempt cap and cross-patient isolation, all of which
    are transport-independent. The provider itself is covered separately by
    clinic_core.otp.evo_selftest.
    """

    def __enter__(self):
        self._saved = frappe.conf.get("clinic_otp_provider")
        frappe.conf["clinic_otp_provider"] = "null"
        return self

    def __exit__(self, *exc):
        frappe.conf["clinic_otp_provider"] = self._saved
        return False


def _reset_rate_limits(phone):
    """Clear the OTP issuance counters for `phone` and this caller's IP.

    The limiter is a fixed-window counter in redis with an hour-long window, so
    without this a test run that issues several codes exhausts the real budget
    and every later test sees RATE_LIMITED -- including a fresh run minutes
    later, since the window outlives the process.

    Clearing the counter is the honest thing to do here: the limit itself is
    verified by its own test (`test_issuance_is_rate_limited`), so suppressing
    it elsewhere removes interference rather than hiding a failure.
    """
    patient_auth.clear_rate_limit(phone_number=phone)


def _clear_cooldown(phone):
    """Remove issued codes so the 45s resend cooldown does not suppress a new one.

    NOTE the normalize() call. Rows are stored against the E.164 form, so
    deleting by the raw spelling ("03451220001") matches nothing and the
    cooldown silently survives -- which is the very mistake this feature exists
    to prevent, reproduced in its own test helper.
    """
    frappe.db.delete("Patient OTP Request", {"phone_e164": normalize(phone)})
    frappe.db.commit()


def _recover_code(phone, purpose="login"):
    """Find the plaintext of the newest unconsumed OTP for `phone`.

    Normalises first, for the same reason as `_clear_cooldown`: the row is keyed
    by the E.164 form, not by whatever the caller typed.
    """
    row = frappe.db.get_value(
        "Patient OTP Request",
        {"phone_e164": normalize(phone), "purpose": purpose, "consumed": 0},
        ["salt", "otp_hash"],
        order_by="creation desc",
        as_dict=True,
    )
    if not row:
        return None
    for i in range(1000000):
        code = str(i).zfill(6)
        if hashlib.sha256(f"{row.salt}{code}".encode()).hexdigest() == row.otp_hash:
            return code
    return None


class TestPhoneNormalisation(FrappeTestCase):
    """Every spelling of one Pakistani number must collapse to one identity."""

    def test_equivalent_forms_collapse(self):
        forms = [
            "03001234567",
            "3001234567",
            "+923001234567",
            "923001234567",
            "00923001234567",
            "+92 300 1234567",
            "0300 1234567",
            "0300-123-4567",
            "(0300) 1234567",
        ]
        results = {normalize(f) for f in forms}
        self.assertEqual(
            results,
            {"+923001234567"},
            "phone forms must normalise to a single identity",
        )

    def test_foreign_numbers_pass_through(self):
        self.assertEqual(normalize("+14155552671"), "+14155552671")
        self.assertEqual(normalize("+442071838750"), "+442071838750")

    def test_rejects_rubbish(self):
        for bad in ("", None, "abc", "030012", "+", "12", "<script>", "0300123456a"):
            with self.assertRaises(ApiError, msg=f"{bad!r} should be rejected"):
                normalize(bad)


class TestPatientPortalIsolation(FrappeTestCase):
    """Patient A must never reach Patient B's anything."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        # Pin the transport: see _NullProvider. A live WhatsApp provider would
        # (correctly) refuse these fictional numbers and no code would issue.
        cls._provider = _NullProvider()
        cls._provider.__enter__()
        cls.patient_a = cls._ensure_patient("QA Portal A", PHONE_A_NATIONAL, PHONE_A)
        cls.patient_b = cls._ensure_patient("QA Portal B", PHONE_B, PHONE_B)

    @classmethod
    def tearDownClass(cls):
        cls._provider.__exit__(None, None, None)
        super().tearDownClass()

    @staticmethod
    def _ensure_patient(name, mobile, phone_e164):
        """Create the fixture, or bring an existing one back to a known state.

        Reusing a leftover record as-is is not safe here: if a previous run left
        it carrying a different number, the login under test would resolve to
        "no such patient" and the failure would look like a matching bug. So an
        existing fixture has its number reset and any stale mapping dropped,
        which also restores the un-linked starting condition Case A needs.
        """
        existing = frappe.db.get_value("Patient", {"patient_name": name}, "name")
        if existing:
            frappe.db.set_value("Patient", existing, "mobile", mobile)
            frappe.db.set_value("Patient", existing, "user_id", None)
            stale = frappe.db.get_value(
                "Patient Phone Mapping", {"patient": existing}, "name")
            if stale:
                frappe.delete_doc("Patient Phone Mapping", stale,
                                  force=True, ignore_permissions=True)
            frappe.db.commit()
            return existing
        doc = frappe.get_doc({
            "doctype": "Patient",
            "first_name": name,
            "sex": "Prefer not to say",
            "mobile": mobile,
            "status": "Active",
            "invite_user": 0,
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return doc.name

    def _login(self, phone):
        """Drive the real OTP flow and return the resulting patient id."""
        frappe.set_user("Guest")
        _clear_cooldown(phone)
        _reset_rate_limits(phone)

        patient_auth.request_otp(phone_number=phone)
        code = _recover_code(phone)
        self.assertIsNotNone(code, "an OTP should have been issued")

        result = patient_auth.verify_otp(phone_number=phone, otp=code)
        self.assertTrue(result.get("success"), f"login failed: {result}")
        return result["data"]["patient"]

    # ---------------------------------------------------------------- #
    def test_login_links_existing_patient_without_duplicating(self):
        before = frappe.db.count("Patient", {"patient_name": "QA Portal A"})
        patient = self._login(PHONE_A)
        after = frappe.db.count("Patient", {"patient_name": "QA Portal A"})

        self.assertEqual(patient, self.patient_a)
        self.assertEqual(before, after, "login must not create a duplicate Patient")

    def test_national_and_e164_reach_the_same_account(self):
        first = self._login(PHONE_A_NATIONAL)
        second = self._login(PHONE_A)
        self.assertEqual(first, second)

    def test_otp_is_single_use(self):
        frappe.set_user("Guest")
        _clear_cooldown(PHONE_A)
        _reset_rate_limits(PHONE_A)
        patient_auth.request_otp(phone_number=PHONE_A)
        code = _recover_code(PHONE_A)

        first = patient_auth.verify_otp(phone_number=PHONE_A, otp=code)
        self.assertTrue(first.get("success"))

        replay = patient_auth.verify_otp(phone_number=PHONE_A, otp=code)
        self.assertFalse(replay.get("success"), "a used code must not work twice")

    def test_wrong_and_unknown_phone_give_identical_messages(self):
        """Any difference here is an account-existence oracle."""
        frappe.set_user("Guest")
        _clear_cooldown(PHONE_A)
        _reset_rate_limits(PHONE_A)
        patient_auth.request_otp(phone_number=PHONE_A)

        wrong = patient_auth.verify_otp(phone_number=PHONE_A, otp="000000")
        unknown = patient_auth.verify_otp(phone_number="+923451229999", otp="000000")

        self.assertFalse(wrong.get("success"))
        self.assertFalse(unknown.get("success"))
        self.assertEqual(
            wrong["error"]["message"],
            unknown["error"]["message"],
            "failure wording must not distinguish a known from an unknown number",
        )

    def test_request_otp_never_reveals_whether_the_number_is_known(self):
        frappe.set_user("Guest")
        _clear_cooldown(PHONE_A)
        _clear_cooldown("+923451229999")
        _reset_rate_limits(PHONE_A)
        known = patient_auth.request_otp(phone_number=PHONE_A)
        _reset_rate_limits("+923451229999")
        unknown = patient_auth.request_otp(phone_number="+923451229999")

        self.assertTrue(known.get("success"))
        self.assertTrue(unknown.get("success"))
        self.assertEqual(known.get("message"), unknown.get("message"))
        self.assertEqual(set(known["data"]), set(unknown["data"]))

    def test_attempt_cap_kills_the_code(self):
        frappe.set_user("Guest")
        _clear_cooldown(PHONE_A)
        _reset_rate_limits(PHONE_A)
        patient_auth.request_otp(phone_number=PHONE_A)
        good = _recover_code(PHONE_A)
        wrong = "999999" if good != "999999" else "888888"

        for _ in range(patient_auth.MAX_VERIFY_ATTEMPTS):
            patient_auth.verify_otp(phone_number=PHONE_A, otp=wrong)

        after_cap = patient_auth.verify_otp(phone_number=PHONE_A, otp=good)
        self.assertFalse(
            after_cap.get("success"),
            "the correct code must stop working once the attempt cap is hit",
        )

    def test_expired_code_is_refused(self):
        frappe.set_user("Guest")
        _clear_cooldown(PHONE_A)
        _reset_rate_limits(PHONE_A)
        patient_auth.request_otp(phone_number=PHONE_A)
        code = _recover_code(PHONE_A)

        name = frappe.db.get_value(
            "Patient OTP Request",
            {"phone_e164": PHONE_A, "consumed": 0},
            "name",
            order_by="creation desc",
        )
        frappe.db.set_value(
            "Patient OTP Request", name, "expires_at",
            frappe.utils.add_to_date(frappe.utils.now_datetime(), seconds=-1),
            update_modified=False,
        )
        frappe.db.commit()

        result = patient_auth.verify_otp(phone_number=PHONE_A, otp=code)
        self.assertFalse(result.get("success"))

    def test_issuance_is_rate_limited(self):
        """The per-phone cap must actually bite.

        This is the test that justifies clearing the counters elsewhere: the
        limit is proven here, so suppressing it in unrelated tests removes
        interference rather than hiding a broken control.
        """
        frappe.set_user("Guest")
        probe = "+923451228888"
        _clear_cooldown(probe)
        _reset_rate_limits(probe)

        limit = patient_auth.RATE_PER_PHONE[0]
        outcomes = []
        for _ in range(limit + 2):
            # Clearing the ROW each time defeats only the 45s resend cooldown;
            # the redis counter is untouched, so the cap is what we measure.
            _clear_cooldown(probe)
            outcomes.append(patient_auth.request_otp(phone_number=probe))

        self.assertTrue(outcomes[0].get("success"), "the first request should succeed")
        self.assertFalse(
            outcomes[-1].get("success"),
            f"more than {limit} codes per hour should be refused",
        )
        self.assertEqual(outcomes[-1]["error"]["code"], "RATE_LIMITED")

        _reset_rate_limits(probe)
        _clear_cooldown(probe)

    def test_rate_limited_message_does_not_reveal_which_limit(self):
        """Saying 'you hit the PER-NUMBER cap' would confirm the number is in use."""
        frappe.set_user("Guest")
        probe = "+923451227777"
        _clear_cooldown(probe)
        _reset_rate_limits(probe)

        messages = set()
        for _ in range(patient_auth.RATE_PER_PHONE[0] + 3):
            _clear_cooldown(probe)
            result = patient_auth.request_otp(phone_number=probe)
            if not result.get("success"):
                messages.add(result["error"]["message"])

        self.assertLessEqual(
            len(messages), 1,
            "every rate-limit refusal must read identically",
        )
        _reset_rate_limits(probe)
        _clear_cooldown(probe)

    def test_otp_is_not_stored_in_plaintext(self):
        frappe.set_user("Guest")
        _clear_cooldown(PHONE_A)
        _reset_rate_limits(PHONE_A)
        patient_auth.request_otp(phone_number=PHONE_A)
        row = frappe.db.get_value(
            "Patient OTP Request",
            {"phone_e164": PHONE_A},
            ["otp_hash", "salt"],
            order_by="creation desc",
            as_dict=True,
        )
        self.assertEqual(len(row.otp_hash), 64, "must be a sha256 hex digest")
        self.assertTrue(row.salt, "each code must carry its own salt")

    # ---------------------------------------------------------------- #
    def test_patient_endpoints_ignore_a_supplied_patient(self):
        """The endpoints take no patient argument; identity is the session."""
        self._login(PHONE_A)

        profile = patient_api.me()
        self.assertEqual(profile["data"]["patient_id"], self.patient_a)

        # Passing a patient must never yield that patient's data.
        #
        # `me()` accepts no such parameter, so the call fails inside the
        # decorator and comes back as an error envelope rather than a record.
        # Either outcome is acceptable -- ignored or refused -- so the assertion
        # is on the property that matters: B's data does not come back.
        spoofed = patient_api.me(patient=self.patient_b)  # type: ignore[call-arg]
        blob = frappe.as_json(spoofed)

        self.assertNotIn(
            self.patient_b, blob,
            "naming another patient must never return their record",
        )
        if spoofed.get("success"):
            self.assertEqual(spoofed["data"]["patient_id"], self.patient_a)

    def test_booking_rejects_an_explicit_patient(self):
        self._login(PHONE_A)
        result = appt_api.create(payload={"patient": self.patient_b,
                                          "practitioner": "x", "date": "2026-09-20",
                                          "time": "10:00:00"})
        self.assertFalse(result.get("success"))
        self.assertEqual(result["error"]["code"], "VALIDATION_ERROR")

    def test_a_cannot_read_bs_records(self):
        # Give B an appointment to try to steal.
        frappe.set_user("Administrator")
        practitioner = frappe.db.get_value(
            "Healthcare Practitioner", {"status": "Active"}, "name")
        appt = frappe.get_doc({
            "doctype": "Patient Appointment",
            "patient": self.patient_b,
            "practitioner": practitioner,
            "appointment_date": frappe.utils.add_days(frappe.utils.nowdate(), 3),
            "appointment_time": "11:00:00",
            "duration": 30,
            "appointment_type": frappe.db.get_value("Appointment Type", {}, "name"),
            "appointment_for": "Practitioner",
            "company": frappe.db.get_single_value("Global Defaults", "default_company"),
        })
        appt.flags.ignore_validate = True
        appt.insert(ignore_permissions=True)
        frappe.db.commit()

        self._login(PHONE_A)

        stolen = appt_api.get_appointment(appointment=appt.name)
        self.assertFalse(stolen.get("success"), "A must not read B's appointment")
        self.assertEqual(stolen["error"]["code"], "NOT_FOUND")

        cancelled = appt_api.cancel(appointment=appt.name)
        self.assertFalse(cancelled.get("success"), "A must not cancel B's appointment")
        self.assertNotEqual(
            frappe.db.get_value("Patient Appointment", appt.name, "status"),
            "Cancelled",
        )

    def test_forbidden_is_indistinguishable_from_missing(self):
        """Otherwise ids can be enumerated to learn which records exist."""
        frappe.set_user("Administrator")
        practitioner = frappe.db.get_value(
            "Healthcare Practitioner", {"status": "Active"}, "name")
        appt = frappe.get_doc({
            "doctype": "Patient Appointment",
            "patient": self.patient_b,
            "practitioner": practitioner,
            "appointment_date": frappe.utils.add_days(frappe.utils.nowdate(), 4),
            "appointment_time": "12:00:00",
            "duration": 30,
            "appointment_type": frappe.db.get_value("Appointment Type", {}, "name"),
            "appointment_for": "Practitioner",
            "company": frappe.db.get_single_value("Global Defaults", "default_company"),
        })
        appt.flags.ignore_validate = True
        appt.insert(ignore_permissions=True)
        frappe.db.commit()

        self._login(PHONE_A)
        real_but_not_mine = appt_api.get_appointment(appointment=appt.name)
        does_not_exist = appt_api.get_appointment(appointment="HLC-APP-9999-99999")

        self.assertEqual(
            real_but_not_mine["error"], does_not_exist["error"],
            "'not yours' and 'does not exist' must be the same answer",
        )

    def test_lists_contain_only_the_callers_own_rows(self):
        self._login(PHONE_A)

        for payload in (
            appt_api.list_appointments(scope="all"),
            records_api.visits(),
            billing_api.invoices(),
        ):
            blob = frappe.as_json(payload)
            self.assertNotIn(self.patient_b, blob)
            self.assertNotIn("QA Portal B", blob)

    def test_clinical_notes_never_leave_the_server(self):
        """The patient-safe projection must exclude staff-only fields."""
        frappe.set_user("Administrator")
        practitioner = frappe.db.get_value(
            "Healthcare Practitioner", {"status": "Active"}, "name")
        encounter = frappe.get_doc({
            "doctype": "Patient Encounter",
            "patient": self.patient_a,
            "practitioner": practitioner,
            "encounter_date": frappe.utils.nowdate(),
            "appointment_type": frappe.db.get_value("Appointment Type", {}, "name"),
            "company": frappe.db.get_single_value("Global Defaults", "default_company"),
            "encounter_comment": "SECRET-INTERNAL-COMMENT",
            "clinical_notes": "<p>SECRET-CLINICAL-NOTE</p>",
        })
        encounter.insert(ignore_permissions=True)
        encounter.submit()
        frappe.db.commit()

        self._login(PHONE_A)
        result = records_api.visit(encounter=encounter.name)
        blob = frappe.as_json(result)

        self.assertTrue(result.get("success"))
        self.assertNotIn("SECRET-CLINICAL-NOTE", blob)
        self.assertNotIn("SECRET-INTERNAL-COMMENT", blob)
        self.assertNotIn("clinical_notes", blob)
        self.assertNotIn("encounter_comment", blob)

    def test_draft_encounters_are_invisible(self):
        frappe.set_user("Administrator")
        practitioner = frappe.db.get_value(
            "Healthcare Practitioner", {"status": "Active"}, "name")
        draft = frappe.get_doc({
            "doctype": "Patient Encounter",
            "patient": self.patient_a,
            "practitioner": practitioner,
            "encounter_date": frappe.utils.nowdate(),
            "appointment_type": frappe.db.get_value("Appointment Type", {}, "name"),
            "company": frappe.db.get_single_value("Global Defaults", "default_company"),
        })
        draft.insert(ignore_permissions=True)   # left unsubmitted
        frappe.db.commit()

        self._login(PHONE_A)
        result = records_api.visit(encounter=draft.name)
        self.assertFalse(
            result.get("success"),
            "an unsubmitted note is a draft, not a record the patient may read",
        )

    def test_billing_currency_is_the_clinics_not_the_global_default(self):
        """An empty Billing tab must not render another country's currency.

        `Global Defaults.default_currency` on this site is INR -- dragged there by
        the `_Test Company` fixtures ERPNext ships -- while the real clinic is
        PKR. Falling back to the global value showed a Pakistani patient "₹ 0"
        before they had any invoice.
        """
        self._login(PHONE_A)

        summary = billing_api.summary()
        self.assertTrue(summary.get("success"), str(summary))

        company = (frappe.defaults.get_user_default("Company")
                   or frappe.db.get_single_value("Global Defaults", "default_company"))
        expected = frappe.db.get_value("Company", company, "default_currency")

        self.assertEqual(
            summary["data"]["currency"], expected,
            "billing summary must report the CLINIC's currency",
        )

        # And specifically not the global default, when the two disagree.
        global_default = frappe.db.get_single_value(
            "Global Defaults", "default_currency")
        if global_default and global_default != expected:
            self.assertNotEqual(
                summary["data"]["currency"], global_default,
                "must not fall back to Global Defaults.default_currency",
            )

    def test_patient_cannot_reach_staff_endpoints(self):
        from clinic_core.api.v1 import patients as staff_patients

        self._login(PHONE_A)
        result = staff_patients.list_patients()
        self.assertFalse(
            result.get("success"),
            "a patient session must not be able to list every patient",
        )


class TestPhoneMappingInvariants(FrappeTestCase):
    """The mapping doctype's uniqueness is the anti-hijack guarantee."""

    def test_one_phone_maps_to_one_patient(self):
        frappe.set_user("Administrator")
        mapping = frappe.db.get_value(
            "Patient Phone Mapping", {"phone_e164": PHONE_A},
            ["patient", "user"], as_dict=True,
        )
        if not mapping:
            self.skipTest("no mapping yet; run the isolation tests first")

        # A second mapping for the same phone must be impossible.
        with self.assertRaises(Exception):
            frappe.get_doc({
                "doctype": "Patient Phone Mapping",
                "phone_e164": PHONE_A,
                "patient": frappe.db.get_value(
                    "Patient", {"name": ["!=", mapping.patient]}, "name"),
                "user": "Administrator",
                "status": "Active",
            }).insert(ignore_permissions=True)
