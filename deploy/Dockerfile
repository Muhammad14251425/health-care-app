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

# clinic_core.
#
# A bench app is TWO levels: an outer repo directory holding pyproject.toml, and
# an inner Python package of the same name. Only the inner package is in git
# (backend/clinic_core), so the outer level is assembled here -- copying the
# inner package straight to apps/clinic_core leaves pip with no package to find,
# which is exactly how the first build failed.
#
#   apps/clinic_core/                <- outer: pyproject.toml lives here
#   apps/clinic_core/clinic_core/    <- inner: hooks.py, api/, doctypes
COPY --chown=frappe:frappe backend/clinic_core /home/frappe/frappe-bench/apps/clinic_core/clinic_core

RUN set -eux; \
    export PYENV_ROOT=/home/frappe/.pyenv; \
    export PATH="${PYENV_ROOT}/bin:${PYENV_ROOT}/shims:${PATH}"; \
    cd /home/frappe/frappe-bench/apps/clinic_core; \
    # pyproject.toml and README are committed inside the package; flit needs them
    # at the repo root, next to (not inside) the module it builds.
    mv clinic_core/pyproject.toml .; \
    mv clinic_core/README.md .; \
    echo "--- layout before install ---"; ls -la .; ls -la clinic_core | head -20; \
    # flit_core builds this app but is not part of the bench venv by default --
    # without it the editable install fails while resolving the build backend.
    /home/frappe/frappe-bench/env/bin/pip install --no-cache-dir "flit_core>=3.4,<4"; \
    # Verbose, and the log is echoed on failure: a bare `pip install -e` reports
    # only "exit code 1" in the CI summary, which says nothing about the cause.
    /home/frappe/frappe-bench/env/bin/pip install --no-cache-dir --no-build-isolation -e . -v > /tmp/pip.log 2>&1 \
      || { echo "=== PIP INSTALL FAILED ==="; tail -80 /tmp/pip.log; exit 1; }; \
    /home/frappe/frappe-bench/env/bin/python -c "import clinic_core; print('import OK', clinic_core.__version__)"; \
    # apps.txt has NO trailing newline, so a plain `>>` would weld the new entry
    # onto the last one and Frappe would go looking for `erpnextclinic_core`.
    # sed -i '$a\' appends a newline only when one is missing.
    sed -i -e '$a\' /home/frappe/frappe-bench/sites/apps.txt; \
    echo "clinic_core" >> /home/frappe/frappe-bench/sites/apps.txt; \
    echo "--- apps.txt ---"; cat -A /home/frappe/frappe-bench/sites/apps.txt; \
    cd /home/frappe/frappe-bench; \
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

# `bench init` writes the LOCAL development defaults into common_site_config.json
# (redis on 127.0.0.1:11000-11003, from a single-machine bench). Those values win
# over the REDIS_* environment variables, so without this the workers and the
# socketio server die on startup with:
#
#   Error 111 connecting to 127.0.0.1:11000. Connection refused.
#
# Overwritten here with the compose service names so the shipped image is correct
# for this stack rather than needing a manual fix after every deploy.
RUN printf '%s\n' \
    '{' \
    ' "db_host": "db",' \
    ' "db_port": 3306,' \
    ' "redis_cache": "redis://redis-cache:6379",' \
    ' "redis_queue": "redis://redis-queue:6379",' \
    ' "redis_socketio": "redis://redis-queue:6379",' \
    ' "socketio_port": 9000,' \
    ' "webserver_port": 8000,' \
    ' "developer_mode": 0' \
    '}' > /home/frappe/frappe-bench/sites/common_site_config.json

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
