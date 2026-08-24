# Client–Server Separation — Execution Plan

**Goal (standup, 2026-08-20):** a clean client/server split, proven by hosting
rowboat-server on a remote machine (e.g. AWS) with the client connecting from
another. Same-machine stays the default. Mobile is parked and reconnects once
the separation is done.

**How this runs:** every phase is one PR against `arch/server-client-separation`.
Nothing merges without your review. Each phase has an explicit verification step
and, where a real choice exists, a **DECIDE** marker — those are yours to call
before that phase starts. The integration branch gets rebased on `main` after
every phase (it has conflicted every time we've waited longer).

**Where we are:** the transport, auth, WS event protocol, and hardening are done
and merged (#758, #887). 17 of 356 channels are migrated; the desktop forwards
them over localhost HTTP in all builds (`ROWBOAT_FORWARD_MIGRATED=0` kill
switch). The standing rule: any new or touched core channel goes into
`apps/server/src/channels.ts` + `core-deps.ts` and gets forwarded.

---

## Phase 1 — Read-only queries (~50 channels)

Migrate every request/response channel that only *reads* core state: models
catalog/config reads, knowledge queries, settings/config getters, session/run
listings not yet covered, billing/account reads.

- Zero write risk; a bad handler shows stale data, corrupts nothing.
- Proves the per-group rhythm: add to `channels.ts`, lift handler into
  `core-deps.ts`, forwarder picks it up automatically.
- **Verify:** desktop runs a full day with forwarding on; per-channel smoke
  script (`curl` each new channel) added to the server tests.

## Phase 2 — Workspace & knowledge writes (~40)

`workspace:*` writes (write/mkdir/rename/remove), notes, tagging, knowledge
commits, todo/home/deck state.

- First phase that can corrupt user data if wrong — handlers stay verbatim
  lifts, no logic changes.
- **Verify:** create/edit/rename/delete notes + todos through the UI; git
  history in `~/.rowboat` shows clean commits.

## Phase 3 — Connectors & OAuth relocation (~60)

`gmail:*`, `slack:*`, `composio:*`, `google-docs:*`, `chatgpt:*`,
`githubAuth:*`, `oauth:*`, `channels:*`, plus moving the OAuth loopback server
(`auth-server.ts` / `oauth-handler.ts` orchestration) into rowboat-server per
RFC Q10 (`oauth:start` → server returns authUrl → client opens browser →
redirect lands on the server's loopback).

- **DECIDE before starting:** connect/disconnect one low-stakes provider as the
  test account, or a throwaway Google account? (Re-auth flows get exercised.)
- **Verify:** disconnect + reconnect Gmail and Slack end-to-end; token refresh
  works; email sync resumes.

## Phase 4 — Models/LLM, voice config, remaining feature channels (~80)

`models:*`, `llm:*`, `voice:*` (server-side pieces only — capture stays edge),
`live-note:*`, `bg-task:*`, `agent-schedule:*`, `meeting:*` (server pieces),
`apps:*`, `runs:*`, misc.

- **Verify:** model picker, live notes, background tasks, meeting notes all
  work with forwarding on.

## Phase 5 — Code-mode & terminal (~30)

`codeSession:*`, `codeMode:*`, `codeProject:*`, `terminal:*`; the PTY
(`node-pty`) moves from main's bundle into the server's (RFC Q13 — the
terminal must show the machine core runs on).

- Riskiest migration (native module packaging + streams).
- **Verify:** full code session incl. terminal echo/scrollback replay.

## Phase 6 — Init & schedulers move server-side

The ~25 `init*()` lifecycle calls (knowledge sync, event processor, live-note +
bg-task schedulers, meeting detection glue, graph builder…) boot in
`standalone.ts`; main keeps only client-local concerns (windows, dialogs,
capture, tray, popouts, deep links, updater).

- The reverse-call seam (notifications → WS capability requests per RFC Q14)
  lands here: server-side events must still notify the desktop.
- **Verify:** standalone server on an isolated workdir runs sync/schedulers
  correctly with no Electron running.

## Phase 7 — The flip

Main stops booting core: spawns `standalone.ts` as a child process, becomes a
pure client (HTTP for calls, WS for events). Delete the in-process handler
path, the dual event fan-out, and the per-channel flag.

- **DECIDE:** keep a release cycle where the old path is still reachable
  behind an env var, or delete outright?
- **Verify (exit criteria):** desktop UX byte-for-byte identical; phone works
  with the desktop window closed (app resident); `apps/main/src/ipc.ts`
  contains only client-local handlers.

## Phase 8 — Remote validation (the standup goal)

- TLS guidance (reverse proxy — caddy/nginx) + docs; token encryption at rest
  (cipher seam exists, headless needs a non-keychain impl); hosted OAuth claim
  flow for remote; headless distribution (npm/binary).
- **DECIDE:** AWS instance type/region, and Tailscale vs public TLS for the
  test.
- **Verify:** rowboat-server on the remote box, desktop client from your Mac:
  chat streams, notes sync, connectors work. This closes the milestone.

## Phase 9 — Merge to main

One reviewed merge of `arch/server-client-separation` → `main` (auto-closes
#879–882). Release follows the normal cycle.

---

## Not in this plan (parked)

Mobile: device dev build, voice push-to-talk, TestFlight. Chrome-extension
sync server is same-machine-only and stays parked (RFC known limitation).

## Standing risks

- **Integration-branch drift** — rebase on main after every phase, no
  exceptions.
- **PR-triggered CI is flaky on this repo** — dispatch `gh workflow run
  rowboat --ref <branch>` manually until fixed.
- **Split-brain** — the workdir lock now enforces one host; never run
  standalone against a live `~/.rowboat`.
