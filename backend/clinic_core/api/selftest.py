"""
Import + registration self-test for the clinic_core API surface.

Confirms that every endpoint we intend to expose is actually importable and
registered in Frappe's whitelist, so a typo cannot silently leave an endpoint
unreachable (or, worse, reachable but unguarded).

Run: bench --site clinic.localhost execute clinic_core.api.selftest.run
"""

import importlib

import frappe

MODULES = {
    "clinic_core.api.v1.auth": [
        "login", "logout", "me", "session_valid",
    ],
    "clinic_core.api.v1.patients": [
        "list_patients", "get_patient", "create_patient", "update_patient",
        "visit_history",
    ],
    "clinic_core.api.v1.practitioners": [
        "list_practitioners", "get_practitioner", "list_departments", "availability",
    ],
    "clinic_core.api.v1.appointments": [
        "list_appointments", "get_appointment", "available_slots",
        "create_appointment", "reschedule_appointment", "cancel_appointment",
        "set_status",
    ],
    "clinic_core.api.v1.encounters": [
        "list_encounters", "get_encounter", "create_encounter",
        "update_encounter", "submit_encounter",
    ],
    "clinic_core.api.v1.invoices": [
        "list_invoices", "get_invoice", "create_consultation_invoice",
        "submit_invoice", "outstanding",
    ],
    "clinic_core.api.v1.payments": [
        "payment_history", "record_payment",
    ],
}


def run():
    """Resolve each endpoint the way Frappe does at request time.

    NOTE: `frappe.whitelisted` is NOT a complete registry -- it only holds functions
    imported so far in this process, so membership-by-name is not a valid check.
    The authoritative gate is frappe.is_whitelisted(fn) on the resolved attribute,
    which is exactly what the HTTP handler calls.
    """
    from frappe import handler

    total = ok = 0
    problems = []

    for mod_name, fns in MODULES.items():
        try:
            importlib.import_module(mod_name)
        except Exception as e:
            problems.append(f"IMPORT FAILED {mod_name}: {type(e).__name__}: {e}")
            total += len(fns)
            continue

        for fn_name in fns:
            total += 1
            dotted = f"{mod_name}.{fn_name}"
            try:
                fn = handler.get_attr(dotted)
            except Exception as e:
                problems.append(f"UNRESOLVABLE {dotted}: {type(e).__name__}: {e}")
                continue
            try:
                frappe.is_whitelisted(fn)
            except Exception as e:
                problems.append(f"NOT WHITELISTED {dotted}: {type(e).__name__}")
                continue
            ok += 1
            print(f"  OK  {dotted}")

    print()
    print(f"=== {ok}/{total} endpoints importable and whitelisted ===")
    if problems:
        print("=== PROBLEMS ===")
        for p in problems:
            print("  " + p)
    else:
        print("no problems")
    return {"ok": ok, "total": total, "problems": problems}
