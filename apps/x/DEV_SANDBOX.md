# Sandboxed dev instances

`npm run dev:sandbox` (at `apps/x`) boots a dev instance that coexists with the
production app and with other dev instances — including when launched from a
worktree inside Rowboat code mode.

```bash
cd apps/x
npm run dev:sandbox                    # isolated workdir, auto-picked ports
npm run dev:sandbox -- --seed-config   # first boot: copy ~/.rowboat/config in
                                       # (minus server.json) so providers work
npm run dev:sandbox -- --no-deps       # skip the workspace deps build
```

Each instance gets a workdir at `~/.rowboat-dev/<instance-id>` (id derived from
the checkout/worktree path, stable across restarts) plus its own Electron
profile (`<workdir>/.electron-data`) and three free ports. Plain `npm run dev`
is unchanged: default `~/.rowboat` workdir, ports 3220/3210/5173.

## What makes it work

| Problem | Mechanism |
|---------|-----------|
| Code-mode shells leak `ELECTRON_RUN_AS_NODE` (set for the ACP adapter spawn in `core/src/code-mode/acp/agents.ts`), so `electron .` boots as plain Node and crashes at the first `app.` access | `apps/main` start script strips the var (`env -u`); `apps/main/src/node-guard.ts` fails fast with a real error if it still leaks through |
| rowboat-server refuses a second instance on its port (split-brain guard in `apps/server/src/server.ts`) | `ROWBOAT_SERVER_PORT` env override in `apps/server/src/config.ts` (explicit `opts.port` from tests still wins) |
| Apps server port was the hardcoded 3210 | `ROWBOAT_APPS_PORT` env override in `core/src/apps/constants.ts`; `appOrigin()` derives from it |
| Vite port | vite runs with `--port --strictPort`; main already honors `ROWBOAT_DEV_SERVER_URL` (`apps/main/src/dev-server.ts`) |
| Shared state | `ROWBOAT_WORKDIR` (already supported by core config) + per-instance `userData` set in `apps/main/src/main.ts` when `ROWBOAT_WORKDIR` is set in dev |

Known shared resource left alone: the OAuth loopback server uses a fixed port
(registered redirect URIs), so two instances can't run an interactive OAuth
flow at the same moment.
