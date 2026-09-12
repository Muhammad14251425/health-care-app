"""clinic_core.api

Frappe resolves a whitelisted path like `clinic_core.api.v1.patients.list_patients`
with successive getattr() calls, so the `v1` subpackage must be bound as an
attribute of this package. An empty __init__ leaves it unbound until something
else happens to import it first, which makes endpoint availability depend on
request order on a cold worker. Importing it here makes resolution deterministic.
"""

from clinic_core.api import v1  # noqa: F401
