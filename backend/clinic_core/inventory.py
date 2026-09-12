"""
Inventory of what is actually installed on the site.

Answers "do we have all of Frappe / ERPNext / Marley?" with counts from the live
database rather than from a screenshot.

Run: bench --site clinic.localhost execute clinic_core.inventory.run
"""

import frappe


def run():
    print("=" * 64)
    print("INSTALLED APPS")
    print("=" * 64)
    for app in frappe.get_installed_apps():
        try:
            ver = frappe.get_attr(f"{app}.__version__")
        except Exception:
            ver = "?"
        n = frappe.db.count("DocType", {"app": app}) if frappe.db.has_column("DocType", "app") else None
        print(f"  {app:14s} {ver}")

    print()
    print("=" * 64)
    print("DOCTYPES PER MODULE OWNER")
    print("=" * 64)
    rows = frappe.db.sql(
        """
        SELECT m.app_name, COUNT(*) AS n
        FROM `tabDocType` d
        JOIN `tabModule Def` m ON d.module = m.name
        GROUP BY m.app_name
        ORDER BY n DESC
        """,
        as_dict=True,
    )
    total = 0
    for r in rows:
        print(f"  {r.app_name or '(none)':14s} {r.n:5d} doctypes")
        total += r.n
    print(f"  {'TOTAL':14s} {total:5d}")

    print()
    print("=" * 64)
    print("WORKSPACES (the icons on /desk)")
    print("=" * 64)
    for w in frappe.get_all("Workspace", fields=["name", "module", "public"],
                            order_by="name"):
        app = frappe.db.get_value("Module Def", w.module, "app_name") or "-"
        print(f"  {w.name:26s} module={w.module or '-':22s} app={app}")

    print()
    print("=" * 64)
    print("MARLEY (healthcare) DOCTYPES — sample of the clinical core")
    print("=" * 64)
    key = [
        "Patient", "Healthcare Practitioner", "Patient Appointment",
        "Patient Encounter", "Practitioner Schedule", "Medical Department",
        "Healthcare Service Unit", "Clinical Procedure", "Lab Test",
        "Inpatient Record", "Therapy Plan", "Diagnostic Report",
        "Medication", "Service Request", "Observation", "Vital Signs",
    ]
    for dt in key:
        if frappe.db.exists("DocType", dt):
            print(f"  OK      {dt:28s} rows={frappe.db.count(dt)}")
        else:
            print(f"  MISSING {dt}")

    print()
    print("=" * 64)
    print("ERPNEXT DOCTYPES WE RELY ON FOR BILLING")
    print("=" * 64)
    for dt in ("Company", "Customer", "Item", "Sales Invoice", "Payment Entry",
               "Account", "Fiscal Year", "Price List", "Mode of Payment", "UOM"):
        if frappe.db.exists("DocType", dt):
            print(f"  OK      {dt:20s} rows={frappe.db.count(dt)}")
        else:
            print(f"  MISSING {dt}")

    print()
    print("=" * 64)
    print("OUR DATA")
    print("=" * 64)
    for dt in ("Patient", "Healthcare Practitioner", "Patient Appointment",
               "Patient Encounter", "Sales Invoice", "Payment Entry", "User"):
        print(f"  {dt:26s} {frappe.db.count(dt)}")
