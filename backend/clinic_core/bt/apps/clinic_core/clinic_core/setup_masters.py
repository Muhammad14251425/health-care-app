"""
Install baseline master data that the ERPNext setup wizard would normally create.

This bench created its Company programmatically rather than through the wizard, so
several global masters are absent. Their absence surfaces as confusing link errors
far from the real cause, e.g.:

    LinkValidationError: Could not find Gender: Male
    LinkValidationError: Could not find Warehouse Type: Transit
    LinkValidationError: Could not find Default Unit of Measure: Nos
    LinkValidationError: Could not find Parent Department: All Departments

Idempotent. Run:
    bench --site clinic.localhost execute clinic_core.setup_masters.run
"""

import frappe

COMPANY = "Test Clinic"

GENDERS = ("Male", "Female", "Other", "Transgender", "Prefer not to say")
SALUTATIONS = ("Mr", "Ms", "Mrs", "Dr", "Prof")
WAREHOUSE_TYPES = ("Transit", "Stores", "Work In Progress", "Finished Goods")

# (uom_name, must_be_whole_number)
UOMS = (
    ("Nos", 1),
    ("Unit", 1),
    ("Hour", 0),
    ("Minute", 0),
    ("Day", 0),
)

ITEM_GROUPS = ("Services", "Consultation")


def log(*a):
    print("[masters]", *a)


def _ensure_simple(doctype, field, values):
    made = 0
    for v in values:
        if not frappe.db.exists(doctype, v):
            frappe.get_doc({"doctype": doctype, field: v}).insert(ignore_permissions=True)
            log("created", doctype, v)
            made += 1
    return made


SERVICE_UNIT = "Consultation Room 1"
PRICE_LIST = "Standard Selling"


def _find_account(company, account_names, root_type=None, is_group=0):
    """Find an existing account by any of several likely names."""
    for nm in account_names:
        acc = frappe.db.get_value(
            "Account",
            {"company": company, "account_name": nm, "is_group": is_group},
            "name",
        )
        if acc:
            return acc
    if root_type:
        return frappe.db.get_value(
            "Account",
            {"company": company, "root_type": root_type, "is_group": 0},
            "name",
        )
    return None


def _ensure_company_accounts():
    """Fill in the Company account defaults ERPNext expects on transactions."""
    company = COMPANY
    if not frappe.db.exists("Company", company):
        return

    comp = frappe.get_doc("Company", company)
    changed = []

    def setdefault(field, names, root_type=None, create_under=None, acc_type=None):
        if comp.get(field):
            return
        acc = _find_account(company, names, root_type)
        if not acc and create_under:
            parent = frappe.db.get_value(
                "Account", {"company": company, "account_name": create_under,
                            "is_group": 1}, "name")
            if parent:
                new = frappe.get_doc({
                    "doctype": "Account",
                    "account_name": names[0],
                    "parent_account": parent,
                    "company": company,
                    "is_group": 0,
                    "root_type": root_type,
                    "account_type": acc_type,
                })
                new.flags.ignore_mandatory = True
                new.insert(ignore_permissions=True)
                acc = new.name
                log("created Account", acc)
        if acc:
            comp.set(field, acc)
            changed.append(f"{field}={acc}")

    setdefault("round_off_account", ["Round Off", "Rounded Off"],
               root_type="Expense", create_under="Indirect Expenses",
               acc_type="Round Off")
    setdefault("write_off_account", ["Write Off"],
               root_type="Expense", create_under="Indirect Expenses")
    setdefault("default_receivable_account", ["Debtors"], root_type="Asset")
    setdefault("default_payable_account", ["Creditors"], root_type="Liability")
    setdefault("default_income_account", ["Sales", "Service"], root_type="Income")
    setdefault("default_expense_account", ["Cost of Goods Sold"], root_type="Expense")
    setdefault("default_cash_account", ["Cash"], root_type="Asset")
    setdefault("exchange_gain_loss_account", ["Exchange Gain/Loss"], root_type="Expense")
    setdefault("round_off_cost_center", [], None)

    if not comp.get("cost_center"):
        cc = frappe.db.get_value("Cost Center",
                                 {"company": company, "is_group": 0}, "name")
        if cc:
            comp.cost_center = cc
            changed.append(f"cost_center={cc}")
    if not comp.get("round_off_cost_center"):
        comp.round_off_cost_center = comp.get("cost_center")
        changed.append("round_off_cost_center")

    if changed:
        comp.flags.ignore_mandatory = True
        comp.save(ignore_permissions=True)
        log("company defaults set:", ", ".join(changed))


def _ensure_price_list():
    """Create the default Selling price list and make it the selling default."""
    currency = (frappe.db.get_value("Company", COMPANY, "default_currency")
                or frappe.db.get_single_value("Global Defaults", "default_currency")
                or "PKR")

    if not frappe.db.exists("Price List", PRICE_LIST):
        pl = frappe.get_doc({
            "doctype": "Price List",
            "price_list_name": PRICE_LIST,
            "selling": 1,
            "buying": 0,
            "enabled": 1,
            "currency": currency,
        })
        pl.flags.ignore_mandatory = True
        pl.insert(ignore_permissions=True)
        log("created Price List", PRICE_LIST, currency)
    else:
        # Make sure it is enabled and flagged for selling.
        pl = frappe.get_doc("Price List", PRICE_LIST)
        if not pl.selling or not pl.enabled:
            pl.selling = 1
            pl.enabled = 1
            pl.save(ignore_permissions=True)
            log("enabled Price List for selling", PRICE_LIST)

    # Selling Settings drives the default on new Sales Invoices.
    ss = frappe.get_doc("Selling Settings")
    if ss.get("selling_price_list") != PRICE_LIST:
        ss.selling_price_list = PRICE_LIST
        ss.flags.ignore_mandatory = True
        ss.save(ignore_permissions=True)
        log("set Selling Settings.selling_price_list =", PRICE_LIST)


def _ensure_service_unit():
    """Create an OP service unit and attach it to every practitioner schedule row."""
    company = frappe.db.get_single_value("Global Defaults", "default_company") or COMPANY

    # The service unit tree needs a root group ("All Healthcare Service Units").
    root = frappe.db.get_value("Healthcare Service Unit", {"is_group": 1}, "name")
    if not root:
        root_doc = frappe.get_doc({
            "doctype": "Healthcare Service Unit",
            "healthcare_service_unit_name": "All Healthcare Service Units",
            "is_group": 1,
            "company": company,
        })
        root_doc.flags.ignore_mandatory = True
        root_doc.insert(ignore_permissions=True)
        root = root_doc.name
        log("created root Healthcare Service Unit", root)

    # A Healthcare Service Unit Type is mandatory (a Link, so ignore_mandatory
    # does not bypass it): "Healthcare Service Unit Type None not found".
    unit_type = "Consultation Room"
    if not frappe.db.exists("Healthcare Service Unit Type", unit_type):
        t = frappe.get_doc({
            "doctype": "Healthcare Service Unit Type",
            "service_unit_type": unit_type,
            "allow_appointments": 1,
            "is_billable": 0,
        })
        t.flags.ignore_mandatory = True
        t.insert(ignore_permissions=True)
        log("created Healthcare Service Unit Type", unit_type)

    unit = frappe.db.get_value("Healthcare Service Unit",
                               {"healthcare_service_unit_name": SERVICE_UNIT}, "name")
    if not unit:
        u = frappe.get_doc({
            "doctype": "Healthcare Service Unit",
            "healthcare_service_unit_name": SERVICE_UNIT,
            "parent_healthcare_service_unit": root,
            "is_group": 0,
            "company": company,
            "service_unit_type": unit_type,
            "allow_appointments": 1,
        })
        u.flags.ignore_mandatory = True
        u.insert(ignore_permissions=True)
        unit = u.name
        log("created Healthcare Service Unit", unit)

    # Attach it to any practitioner schedule row that lacks one.
    for p in frappe.get_all("Healthcare Practitioner", pluck="name"):
        doc = frappe.get_doc("Healthcare Practitioner", p)
        changed = False
        for row in (doc.get("practitioner_schedules") or []):
            if not row.get("service_unit"):
                row.service_unit = unit
                changed = True
        if changed:
            doc.save(ignore_permissions=True)
            log("attached service unit to practitioner", p)


def _ensure_encounter_permissions():
    """Let a Healthcare Administrator record a consultation note.

    Marley ships Patient Encounter with a DocPerm for `Physician` ONLY, so an
    admin got `403 "You are not allowed to perform this action."` from
    doc.insert() -- even though clinic_core's own CLINICAL_ROLES lists
    Healthcare Administrator and the mobile app offers them the screen. The
    action was permitted at every layer except the doctype itself.

    Granted through Custom DocPerm, which is Frappe's supported override: it
    leaves the app's shipped DocPerm untouched (so a Marley upgrade cannot
    silently revert it, and we are not patching vendor code).

    This does NOT make the admin a clinician. `create_encounter` still requires
    an explicit `practitioner`, Marley's own validation still runs, and the
    encounter is attributed to the named doctor while `owner` records the admin
    who typed it -- see api/v1/encounters.py.

    `amend` and `cancel` are deliberately withheld: correcting a signed clinical
    record is the clinician's call, not the front office's.
    """
    doctype = "Patient Encounter"
    role = "Healthcare Administrator"

    if not frappe.db.exists("DocType", doctype):
        log("skipped encounter permissions: Marley not installed")
        return
    if not frappe.db.exists("Role", role):
        log(f"skipped encounter permissions: no role {role}")
        return

    if frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": role}):
        log(f"encounter permissions already set for {role}")
        return

    # Copy the shipped Physician row so the permlevel/if_owner semantics match,
    # then narrow it.
    frappe.get_doc({
        "doctype": "Custom DocPerm",
        "parent": doctype,
        "parenttype": "DocType",
        "parentfield": "permissions",
        "role": role,
        "permlevel": 0,
        "read": 1,
        "write": 1,
        "create": 1,
        "submit": 1,
        "amend": 0,
        "cancel": 0,
        "delete": 0,
        "report": 1,
        "export": 0,
        "share": 0,
        "print": 1,
        "email": 1,
    }).insert(ignore_permissions=True)

    # Custom DocPerm REPLACES the shipped permissions wholesale for this
    # doctype, so Physician must be restated or doctors lose their own access.
    if not frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": "Physician"}):
        frappe.get_doc({
            "doctype": "Custom DocPerm",
            "parent": doctype,
            "parenttype": "DocType",
            "parentfield": "permissions",
            "role": "Physician",
            "permlevel": 0,
            "read": 1, "write": 1, "create": 1, "submit": 1,
            "amend": 1, "cancel": 1, "delete": 0,
            "report": 1, "export": 1, "share": 1, "print": 1, "email": 1,
        }).insert(ignore_permissions=True)
        log("restated Physician permissions on Patient Encounter")

    frappe.clear_cache(doctype=doctype)
    log(f"granted {role} create/write on {doctype}")


def run():
    frappe.set_user("Administrator")

    _ensure_simple("Gender", "gender", GENDERS)
    if frappe.db.exists("DocType", "Salutation"):
        _ensure_simple("Salutation", "salutation", SALUTATIONS)
    _ensure_simple("Warehouse Type", "name", WAREHOUSE_TYPES)

    # --- UOM: required by every Item, and none exist on this site ---
    for uom, whole in UOMS:
        if not frappe.db.exists("UOM", uom):
            frappe.get_doc({
                "doctype": "UOM",
                "uom_name": uom,
                "must_be_whole_number": whole,
            }).insert(ignore_permissions=True)
            log("created UOM", uom)

    # --- Item Groups for service billing ---
    parent = frappe.db.get_value("Item Group", {"is_group": 1}, "name") or "All Item Groups"
    for g in ITEM_GROUPS:
        if not frappe.db.exists("Item Group", g):
            frappe.get_doc({
                "doctype": "Item Group",
                "item_group_name": g,
                "parent_item_group": parent,
                "is_group": 0,
            }).insert(ignore_permissions=True)
            log("created Item Group", g)

    # --- Fiscal Year ---
    if not frappe.db.count("Fiscal Year"):
        frappe.get_doc({
            "doctype": "Fiscal Year",
            "year": "2026",
            "year_start_date": "2026-01-01",
            "year_end_date": "2026-12-31",
        }).insert(ignore_permissions=True)
        log("created Fiscal Year 2026")

    # --- Mode of Payment (needed to record payments cleanly) ---
    for mop in ("Cash", "Bank Draft"):
        if not frappe.db.exists("Mode of Payment", mop):
            frappe.get_doc({
                "doctype": "Mode of Payment",
                "mode_of_payment": mop,
                "type": "Cash" if mop == "Cash" else "Bank",
            }).insert(ignore_permissions=True)
            log("created Mode of Payment", mop)

    # --- Company default accounts ---
    # Creating the Company programmatically leaves several account defaults unset,
    # each surfacing only when a document needs it, e.g.
    #   "Please mention 'Round Off Account' in Company: Test Clinic"
    _ensure_company_accounts()

    # --- Selling Price List ---
    # Sales Invoice requires selling_price_list / price_list_currency /
    # plc_conversion_rate. Without a default Selling price list, every invoice
    # fails validation with those three field names.
    _ensure_price_list()

    # --- Healthcare Service Unit ---
    # Marley's get_available_slots() refuses to compute slots unless the
    # Practitioner Schedule row carries a Service Unit:
    #   "Practitioner <X> does not have a Service Unit set against the
    #    Practitioner Schedule <Y>."
    _ensure_service_unit()

    _ensure_encounter_permissions()

    frappe.db.commit()

    log("=== VERIFY ===")
    for dt in ("Gender", "UOM", "Warehouse Type", "Fiscal Year",
               "Item Group", "Mode of Payment"):
        log(f"  {dt:18s} {frappe.db.count(dt)}")
    log("  Nos exists:", bool(frappe.db.exists("UOM", "Nos")))
    log("DONE")
