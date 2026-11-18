# hermes-maritime

Hermes packaged as a Maritime **custom** container: `nousresearch/hermes-agent` plus
`shim.py` as the main process. Harbor creates every managed Hermes from this image
(`HERMES_IMAGE` in `packages/server/src/connectors/maritime/runtimes.ts`).

What the shim does, in order:

1. Links `/opt/data` to `/data` (Maritime's volume), writes `127.0.0.1 localhost` to
   `/etc/hosts`, and gives `/data` to the `hermes` user.
2. Starts `hermes gateway run` as the `hermes` user and restarts it whenever it exits,
   with a short backoff. The gateway holds Hermes's sessions and its cron scheduler.
3. Serves Maritime's contract on `$PORT`:
   - `GET /health` — `{"ok": true}`.
   - `GET /schedules` — Hermes's cron jobs as Maritime schedule entries.
   - `POST /chat` — a scheduled delivery (`source: scheduled`, prompt `rowboat-cron <id>`)
     fires that job through the gateway at once; anything else runs one `hermes chat`
     turn, answering within Maritime's reply budget or with "working on it".
   - `GET /` — status: gateway pid, restarts, last schedule push.
4. Pushes the schedule list to Maritime (`POST $MARITIME_BACKEND_URL/api/agents/internal/schedules`,
   the SDK's `push_schedules`) at boot and whenever `cron/jobs.json` changes, so a job
   created inside Hermes becomes a wake trigger within seconds. Maritime's own poll of
   `/schedules` runs only every few minutes and only while the box is awake.

Harbor drives turns through Maritime's exec API exactly as before; nothing here is on
that path except the gateway being up.

## Releasing

Bump `FROM` in the Dockerfile and `VERSION` (`<hermes version>-<image revision>`), then
let the workflow push `ghcr.io/rowboatlabs/hermes-maritime:<VERSION>`. Point
`HERMES_IMAGE` at the new tag in the same change. The package must be public on GHCR for
Maritime to pull it.

Tests: `python3 -m unittest discover -s apps/harbor/images/hermes-maritime`.
