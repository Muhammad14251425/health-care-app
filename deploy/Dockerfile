# Clinic platform image: Frappe v16 + ERPNext + Healthcare (Marley) + clinic_core.
#
# Built on the official frappe/build image rather than assembled from scratch --
# it already carries the exact node/python/wkhtmltopdf combination Frappe v16
# expects, and getting that wrong produces PDF and asset failures that are
# tedious to diagnose.
#
# Versions are pinned to what the development bench actually runs (frappe
# 16.33.1, erpnext 16.34.2, healthcare 16.5.2), so the deployed stack matches the
# one the app was written and tested against.

ARG FRAPPE_BRANCH=version-16
ARG PYTHON_VERSION=3.11.9
ARG NODE_VERSION=20.19.0

FROM frappe/build:${FRAPPE_BRANCH} AS build

ARG FRAPPE_BRANCH
ARG PYTHON_VERSION
ARG NODE_VERSION

USER frappe
WORKDIR /home/frappe

# apps.json lists the PUBLIC apps (erpnext, marley). clinic_core is private, so
# it is copied in below instead of cloned -- that keeps the build from needing a
# git credential, and means the image always carries the committed source rather
# than whatever a remote branch happens to hold.
COPY --chown=frappe:frappe deploy/apps.json /opt/frappe/apps.json

RUN set -eux; \
    export PYENV_ROOT=/home/frappe/.pyenv; \
    export PATH="${PYENV_ROOT}/bin:${PYENV_ROOT}/shims:${PATH}"; \
    bench init \
        --frappe-branch="${FRAPPE_BRANCH}" \
        --apps_path=/opt/frappe/apps.json \
        --no-procfile \
        --no-backups \
        --skip-redis-config-generation \
        --verbose \
        /home/frappe/frappe-bench

WORKDIR /home/frappe/frappe-bench

# clinic_core: copied from the build context, then installed as a bench app.
# `bench get-app` on a local path registers it in sites/apps.txt and pip-installs
# it in one step, which is what makes `install-app` work later.
COPY --chown=frappe:frappe backend/clinic_core /home/frappe/frappe-bench/apps/clinic_core

RUN set -eux; \
    export PYENV_ROOT=/home/frappe/.pyenv; \
    export PATH="${PYENV_ROOT}/bin:${PYENV_ROOT}/shims:${PATH}"; \
    /home/frappe/frappe-bench/env/bin/pip install --no-cache-dir -e /home/frappe/frappe-bench/apps/clinic_core; \
    echo "clinic_core" >> /home/frappe/frappe-bench/sites/apps.txt; \
    # Assets for every installed app. Without this the desk UI 404s on its own
    # bundles, which looks like a broken site rather than a missing build step.
    bench build --production || bench build

# --- runtime -----------------------------------------------------------------
# A separate, slimmer stage: the build toolchain (compilers, yarn caches) is not
# needed to serve requests and would roughly double the image.
FROM frappe/base:${FRAPPE_BRANCH} AS runtime

USER frappe
WORKDIR /home/frappe/frappe-bench

COPY --from=build --chown=frappe:frappe /home/frappe/frappe-bench /home/frappe/frappe-bench

ENV PATH="/home/frappe/frappe-bench/env/bin:${PATH}"
ENV PYTHONUNBUFFERED=1

VOLUME [ "/home/frappe/frappe-bench/sites" ]

EXPOSE 8000 9000

# Overridden per service in docker-compose (gunicorn, scheduler, workers,
# websocket all run from this same image with different commands).
CMD [ \
    "/home/frappe/frappe-bench/env/bin/gunicorn", \
    "--chdir=/home/frappe/frappe-bench/sites", \
    "--bind=0.0.0.0:8000", \
    "--threads=2", \
    "--workers=2", \
    "--worker-class=gthread", \
    "--worker-tmp-dir=/dev/shm", \
    "--timeout=120", \
    "--preload", \
    "frappe.app:application" \
]
