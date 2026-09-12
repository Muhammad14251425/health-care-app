"""clinic_core.api.v1

Each endpoint module is imported so that `clinic_core.api.v1.<module>` resolves
via getattr() on a cold worker -- see the note in clinic_core/api/__init__.py.
"""

from clinic_core.api.v1 import (  # noqa: F401
    appointments,
    auth,
    encounters,
    invoices,
    patients,
    payments,
    practitioners,
    public,
)
