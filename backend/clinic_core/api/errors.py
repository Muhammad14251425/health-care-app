"""Developer helper: dump recent clinic_core Error Log entries.

The API deliberately returns a generic message to clients; the real traceback is
written to the Error Log. This surfaces it during development.

Run: bench --site clinic.localhost execute clinic_core.api.errors.dump
"""

import frappe


def dump(limit=5):
    rows = frappe.get_all(
        "Error Log",
        filters={"error": ["like", "%clinic_core%"]},
        fields=["name", "creation", "method", "error"],
        order_by="creation desc",
        limit_page_length=int(limit),
    )
    if not rows:
        rows = frappe.get_all(
            "Error Log",
            fields=["name", "creation", "method", "error"],
            order_by="creation desc",
            limit_page_length=int(limit),
        )

    for r in rows:
        print("=" * 78)
        print(r.creation, "|", r.method)
        print("=" * 78)
        # Only the tail matters -- the innermost frames.
        text = r.error or ""
        print(text[-2500:])
        print()
    return len(rows)
