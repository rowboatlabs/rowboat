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
   - `GET /schedules` — Hermes's cron jobs as Maritime schedule entries: a cron job as its
     expression, a one-off as its time, an interval ("every hour") as a cron line on the
     matching grid, or as its next occurrence when no grid fits (then re-pushed after each run).
   - `POST /chat` — a scheduled delivery (`source: scheduled`, prompt `rowboat-cron <id>`)
     fires that job through the gateway at once; anything else runs one `hermes chat`
     turn, answering within Maritime's reply budget or with "working on it".
   - `GET /` — status: gateway pid, restarts, last schedule push.
4. Pushes the schedule list to Maritime (`POST $MARITIME_BACKEND_URL/api/agents/internal/schedules`,
   the SDK's `push_schedules`) at boot and whenever `cron/jobs.json` changes, so a job
   created inside Hermes becomes a wake trigger within seconds. Maritime's own poll of
   `/schedules` runs only every few minutes and only while the box is awake.
5. Keeps the box awake while a fired job runs: the pushed list then carries a one-minute
   trigger (`rowboat-keepalive`) whose delivery to `/chat` counts as activity, which a
   schedule push on its own does not. It leaves the list when Hermes stamps the run's
   `last_run_at`, or after `KEEPALIVE_MAX_S` (45 minutes). Without it Maritime checkpoints
   the box about two minutes after its last activity with the job half done, and the next
   wake kills the frozen run and skips its own. One minute, not two: the sweep runs every
   two minutes and checkpoints at about 115 s idle, so a two-minute trigger lost every other toss.

New managed Hermes members use the Rowboat platform plugin pinned in the Dockerfile.
The image carries the Spaces skill. Harbor supplies the org URL, member key and owner DM after
creating the member and provisioning model access. On the managed image the shim applies the
profile configuration before starting the gateway and reloads it when the relevant environment
changes. Harbor waits for capabilities and an authenticated live connection before marking the
member ready. The plugin owns replies, including native background notifications. Existing
members with a Maritime connection continue through the CLI.

## Releasing

Bump `FROM` in the Dockerfile and `VERSION` (`<hermes version>-<image revision>`), then
let the workflow push `ghcr.io/rowboatlabs/hermes-maritime:<VERSION>`. Point
`HERMES_IMAGE` at the new tag in the same change. The package must be public on GHCR for
Maritime to pull it.

Tests: `python3 -m unittest discover -s apps/harbor/images/hermes-maritime`.

From the monorepo root, exercise fresh managed creation, first reply and native watcher delivery with a local Harbor, a simulated Maritime API, the built image and a scripted model endpoint:

```sh
docker buildx build --load --platform linux/amd64 -t rowboat-hermes-managed:local --build-context rowboat-spaces=./skills/rowboat-spaces apps/harbor/images/hermes-maritime
cd apps/harbor
pnpm install --frozen-lockfile
pnpm -r build
pnpm --filter @rowboat/harbor exec tsx scripts/managed-hermes-smoke.ts
```
