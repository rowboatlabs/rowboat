# Hermes for Maritime, as a plain "custom" container.
#
# Why this image exists (2026-11-11): Maritime's own wrapper for the `hermes`
# framework was written for its template's Hermes 0.14, where the gateway is
# the container's main process. Current Hermes images supervise the gateway
# with s6 and keep the container alive with `sleep infinity`; on a snapshot
# restore the wrapper takes that keepalive for the "main gateway", stops the
# real one as a duplicate, and nothing restarts it, so cron jobs inside Hermes
# run on every other scheduled wake, and the wrapper rewrites config.yaml on
# every cold boot. Under the `custom` framework Maritime does none of that: it
# wants one main process serving /health, /chat and /schedules on $PORT, and
# leaves everything else alone. The shim is that process; it also starts
# `hermes gateway run` and keeps it running. Measured on probes 2026-11-10/11.
#
# Build: the workflow .github/workflows/hermes-maritime-image.yml pushes
# ghcr.io/rowboatlabs/hermes-maritime:<VERSION>. Bump FROM and VERSION together.
FROM nousresearch/hermes-agent:v0.22.5

COPY shim.py /app/shim.py

# Maritime's volume is /data (HOME there too); the shim links /opt/data to it so
# Harbor's turn script, written for the template's layout, keeps its paths.
ENV HERMES_HOME=/data \
    HOME=/data \
    PATH=/opt/hermes/bin:/opt/hermes/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# No s6: the image's dispatcher would hand PID 1 to /init and supervise the
# gateway under it, which is the layout Maritime's wrapper mishandles.
ENTRYPOINT []
# Exec form only: Maritime's init re-executes the CMD as one flattened string.
CMD ["/opt/hermes/.venv/bin/python", "/app/shim.py"]
