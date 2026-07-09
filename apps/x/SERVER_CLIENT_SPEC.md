# Server/Client Separation — RFC

**Status:** Draft for team review — please critique (see [What we want feedback on](#what-we-want-feedback-on))
**Author:** Ramnique (design finalized via an extended design interview, 2026-07-09)
**Branch:** `server-client-separation`

---

## 1. The problem

Today, Rowboat X is a single Electron process-family: the renderer (React) talks over Electron IPC to the main process, which calls `@x/core` in-process. Everything — the agent runtime, knowledge pipeline, connectors, schedulers — lives and dies inside the desktop app on one machine.

We want to break this into a **server/client model**: `@x/core` becomes an API server ("rowboat-server"), and the Electron app becomes one client among several. This unlocks three things:

1. **Phone app** — a mobile client that talks to the backend running on your Mac (chat with your agents, check live notes, dictate from anywhere on your LAN/Tailscale).
2. **Remote deployments** — rowboat-server on a VPS/home server with the Electron app as a remote client, the way VS Code Remote works: UI local, execution where the code and data live.
3. **Third-party UIs** — others can build their own frontends against a documented API.

The decision (see Q1 below) is to design the **end-state architecture for all three goals up front**, and build toward it in phases.

### Why this is more tractable than it sounds

An architecture audit of the current code found the hard prep work is already done:

- **`@x/core` is already Electron-free.** Zero `electron` imports in `packages/core/src` (there's even a comment at `packages/core/src/apps/github-auth.ts:13`: core stays electron-free). The only Electron touchpoints — notifications, browser control, safeStorage cipher — are dependency-injected interfaces wired in from `apps/main/src/main.ts:391-410`, with fallbacks.
- **The API contract already exists.** All **239 IPC channels** are defined as Zod req/res schemas in one file (`packages/shared/src/ipc.ts`), and main registers handlers through a single typed, exhaustiveness-checked router (`apps/main/src/ipc.ts:439`). 214 channels are request/response (map to HTTP); 25 are push/stream (map to WebSocket).
- **The client bridge is three generic methods.** The preload exposes only `invoke`/`send`/`on` (`apps/preload/src/preload.ts:14-51`); all 239 channels multiplex through them.
- **Storage is parameterized.** Everything lives under `~/.rowboat` behind filesystem repos, overridable via `ROWBOAT_WORKDIR` (`packages/core/src/config/config.ts:7`).
- **Events are already broadcast-shaped.** Main subscribes to core's in-process buses and re-broadcasts to all windows via `webContents.send` (`apps/main/src/ipc.ts:679-788`) — exactly WebSocket pub/sub semantics, with no per-subscriber filtering to untangle.

The genuinely hard spots: features bound to the user's physical machine (mic/camera/screen capture, Granola's local file, drag-drop file paths, native dialogs), the embedded `WebContentsView` browser pane, the OAuth loopback server, the terminal PTY, and single-user assumptions (plaintext token storage, one workdir, one DI container).

---

## 2. Decision log

The design was resolved as a decision tree, one question at a time. Recorded verbatim so reviewers can challenge any individual decision without re-deriving the context. **Bold** = chosen.

### Q1. Which goal drives v1?

Options: Phone → my Mac (recommended) / Remote deployment / Third-party UIs / **All three equally**.

**Decision: all three equally.** Design the end-state architecture up front and build toward it in one arc. Accepted risk: we commit to auth/topology decisions before a real second client exercises the API.

### Q2. Process topology — where does core run?

Options: **Always client/server (recommended)** / Dual transport (in-process locally, HTTP for remote) / Embedded server in Electron main.

**Decision: always client/server.** Core always runs as a standalone `rowboat-server` process — Electron spawns it locally and connects over localhost HTTP/WS, or connects to a remote one. ONE transport, one codepath; the local binary IS the remote deployment artifact. Rejected "dual transport" because the Electron app would never exercise the network path and the API would rot.

### Q3. Local server lifecycle

Options: **Child of Electron (recommended)** / Detached daemon / User choice.

**Decision: child process.** Electron spawns rowboat-server on launch, kills it on quit. No version skew after auto-update, no orphaned daemons. Costs app-closed background work (schedulers, live notes) — but that's today's behavior, so no regression. Daemon-izing is a later flip, not an architecture change.

### Q4. Client seam — how does the Electron renderer reach the server?

Options: **Main-as-proxy (recommended)** / Preload talks HTTP directly.

**Decision: main-as-proxy** (proposed by Ramnique during the interview). Renderer/preload/IPC contract stay completely untouched. Main keeps its ~35 Electron-local handlers and gains one generic forwarder for the ~200 core channels (`POST /rpc/{channel}` with the payload, allowlist derived from shared schemas). It re-broadcasts server WS events via `webContents.send`, exactly mirroring how it re-broadcasts core bus events today. Main must exist anyway for the client-local channels, so this repurposes a required layer rather than adding one. The API can't rot because even locally, every core call crosses HTTP.

### Q5. Wire protocol for request/response channels

Options: **RPC-over-HTTP (recommended)** / WS-only JSON-RPC / REST redesign.

**Decision: RPC-over-HTTP.** `POST /rpc/{channel}`, body/response = the existing Zod req/res schemas, router **generated** from `ipcSchemas` — mechanical, no hand-written handlers, no redesign of 239 channels mid-migration. curl-able for third parties; OpenAPI derivable from the Zod schemas. A curated resource-oriented REST layer can be added on top later if a public API warrants it.

### Q6. Event transport

Options: **WebSocket (recommended)** / SSE / WS now + SSE later.

**Decision: WebSocket** — one WS at `/events` carrying all 25 push channels. SSE was seriously considered (auto-reconnect + `Last-Event-ID` pair nicely with event-sourced turns) but loses on: text-only frames (TTS audio chunks would need base64, +33%), one-way (subscription management and terminal input need side-channel POSTs), and React Native needs a polyfill for SSE but supports WS natively. SSE endpoint for JSON-only events can be added off the same event hub later (~a day) if browser-only third parties want it.

### Q7. Voice — where do STT/TTS run?

Raised by Ramnique: with a remote server, streaming mic audio to the server only for it to stream to Deepgram is a pointless double-hop; the transcript is the internal currency anyway.

**Decision: voice is a client ("edge") capability.** Audio is captured, transcribed (STT), and synthesized (TTS) at the edge; only text crosses the client↔server boundary. This generalizes into an **edge-capability principle**: meeting transcription, video-mode frame capture, and Granola local-file ingest are also edge capabilities (frames/transcripts are still *sent* to the server as turn input — capture and permissioning are client-side).

Credentials sub-decision — options: **Client calls voice proxy directly (recommended)** / Server vends short-lived voice tokens / Keep voice through the server.

**Decision: client calls the Rowboat backend voice proxy** (`api.x.rowboatlabs.com/v1/voice`) directly with the user's bearer token — same proxy as today, called from the edge. User-provided Deepgram/ElevenLabs keys, when set, are stored client-side. No raw vendor keys transit rowboat-server.

### Q8. API auth — who may call rowboat-server?

Options: **Server key + QR pairing (recommended)** / Rowboat account as API auth / None on localhost.

**Decision: server key + QR pairing.** Server generates a random bearer token on first boot (`~/.rowboat/server-key`). The Electron child reads it off disk — zero-friction local. Phone pairs by scanning a QR in the desktop app encoding `{url, token}`. Server binds `127.0.0.1` by default; LAN/Tailscale exposure is explicit opt-in. Remote deployments put TLS in front and reuse the same scheme. Rotating the key revokes everything. Notably rejected "no auth on localhost": this API can drive the agent runtime, read notes, and use connected Gmail/Slack tokens — any local process could otherwise abuse it.

The instance stays **single-user** (one process = one user = one workdir, like code-server). Multi-tenancy inside core is explicitly out of scope; "multi-user" = multiple server instances.

### Q9. Rowboat account token custody

Clients now also need the account token (for the edge voice proxy). Options: **Server custodian, clients fetch (recommended)** / Client custodian, pushes to server / Both hold refresh tokens.

**Decision: server is the sole custodian.** The `oauthRepo` and all refresh logic stay server-side. Clients call an authenticated endpoint (e.g. `account:getAccessToken`) for a current access token, re-fetching on expiry/401. One refresh path, no dual-custody races; sign-in UI runs on the client but tokens land server-side.

### Q10. OAuth connector flows (Gmail, Slack, Composio, GitHub…)

Today: main hosts a loopback server on `localhost:8080+` (`auth-server.ts`) and opens the browser (`oauth-handler.ts`). With a remote server, a redirect to the *server's* localhost is meaningless.

Options: **Server-side, client opens URL (recommended)** / Client-side loopback always / Webapp claim flow for everything.

**Decision: flows move server-side.** `oauth:start` → server returns `authUrl` → client opens the browser → redirect lands on the server's loopback → server stores tokens, emits `oauth:didConnect`. Works unchanged for the local child-process server; zero per-client implementation. Remote servers use the hosted-webapp claim flow (already built for rowboat-mode Google — the template). Accepted limitation: BYO-key connectors on a *remote* server need the webapp flow extended or a client-side fallback — deferred until remote ships.

### Q11. WS reconnect/replay semantics

Electron IPC never drops; a phone's WS drops constantly. Options: **Refetch-on-reconnect + gap detection (recommended)** / Server-side replay buffer / Dumb broadcast.

**Decision: refetch-on-reconnect + gap detection.** Server stamps each WS message with a per-connection sequence number; broadcast is fire-and-forget, no server-side buffer. On reconnect or detected gap, the client refetches what it displays — the event-sourced turn design makes this exact (`sessions:getTurn` returns the full event log; `reduceTurn` rebuilds state), and list views re-invoke their queries. A replay buffer was rejected because an evicted cursor needs the refetch path anyway — you'd build both.

### Q12. Multi-client delivery

Options: **Broadcast to all clients (recommended)** / Topic subscriptions from day one.

**Decision: broadcast to all authenticated clients** — the direct network translation of today's all-windows semantics. Start a turn on desktop, watch it stream on the phone. Per-topic subscription filtering is a later optimization the subscribe-message protocol can grow into.

### Q13. Terminal PTY placement

Context: `node-pty` powers one feature — the code-mode terminal pane. One login-shell PTY per code session, cwd = the session's worktree, ~400KB scrollback replay on re-attach (`apps/main/src/terminal.ts`). After the split, worktrees/git/coding engines live with the server.

Options: **Server-side PTY (recommended)** / Client-side PTY / Server-side but migrate later.

**Decision: server-side.** The terminal must show the machine where code sessions execute — a client-side shell against a remote server is the wrong machine, effectively a bug. This is the VS Code Remote model. The wire shape needs zero redesign (`terminal:write` up / `terminal:data` down is already a stream). Note: `node-pty` is a native module (see the bundling carve-out in `bundle.mjs`) — packaging moves with it.

### Q14. Reverse calls — server-initiated client capabilities

Context: core dependency-injects `INotificationService` (OS notifications) and `IBrowserControlService` (agent drives the embedded `WebContentsView` browser you can watch). Both are implemented by the Electron side. After the split, these calls travel **server → client** — opposite to everything else.

Options: **Capability-request events over WS (recommended)** / Server-side headless implementations (push infra + Playwright) / Hybrid (notify via WS, browser headless).

**Decision: capability-request events over WS.** Clients declare capabilities at WS handshake (`notifications`, `browser-control`, …). Notification requests broadcast — each client surfaces them natively (Mac: OS notification; phone: local notification). Browser-control requests route to **one** capable client; the server awaits its reply over the socket. The handshake capability declaration doubles as general feature negotiation (phone says "no embedded browser"). The "no client connected" gap is moot while the server is a child of Electron; a server-side Playwright implementation remains a clean later swap behind the existing DI seam, without protocol changes.

### Q15. Migration strategy

Options: **Strangler-fig (recommended)** / Big-bang cutover / Big-bang on a long-lived branch.

**Decision: strangler-fig.** Main gains the generic forwarder next to its existing in-process handlers, with a per-channel flag: unmigrated channels run in-process as today; migrated ones forward to the server. Ship continuously, bisect regressions to a channel group, delete the in-process path at the end. The transitional dual-mode is the cost — **timeboxed**, it must not linger.

### Q16. Third-party API posture

Options: **All open, explicitly v0 (recommended)** / Curated stable subset now / Internal-only.

**Decision: all open, explicitly v0.** The entire RPC surface + WS is reachable with a server key. Version header + changelog, zero stability promises, OpenAPI docs generated from the Zod schemas. Graduate a curated stable subset (likely sessions/turns/notes) once real third-party usage shows what matters. Freezing 200 channels during our heaviest churn period would handcuff us.

### Q17. Phone client form

Options: Mobile-web PWA (recommended) / **React Native app** / No phone client yet.

**Decision: React Native.** Chosen over the recommendation for the end-state reasons: proper background audio for voice (which the edge-voice model leans on), push notifications, share sheet, store presence. Accepted risk: building a second product against a v0 API that's still settling. Mitigation: scope the RN v1 ruthlessly — chat + turns + voice, nothing else — so churn stays absorbable. **(Team input explicitly wanted here — see feedback section.)**

### Q18. Phase order

Options: **Split → second client → remote (recommended)** / Remote before phone / Overlap phone with split.

**Decision: as proposed.** Each phase delivers standalone value and de-risks the next.

---

## 3. The design

```
┌─────────────────────────────  user's machine  ─────────────────────────────┐
│                                                                             │
│  ┌──────────── Electron app (thin client) ────────────┐                     │
│  │                                                     │                     │
│  │  renderer ── unchanged IPC ──► main                 │                     │
│  │  (React,          ▲            │  ~35 client-local  │                     │
│  │   preload         │            │  handlers (dialogs,│                     │
│  │   untouched)      │            │  shell, capture    │                     │
│  │                   │            │  perms, popout…)   │                     │
│  │                   │            │                    │                     │
│  │       webContents.send         │ generic forwarder  │                     │
│  │       (event fan-out)          ▼                    │                     │
│  └────────────────────────┬──────┬────────────────────┘                     │
│                           │      │                                          │
│                    WS /events   HTTP POST /rpc/{channel}                    │
│                           │      │        (bearer: server key)              │
│                           ▼      ▼                                          │
│  ┌────────────────── rowboat-server (child process) ──────────────────┐     │
│  │  apps/x/apps/server: HTTP router + WS hub, GENERATED from          │     │
│  │  ipcSchemas (packages/shared/src/ipc.ts)                           │     │
│  │                                                                    │     │
│  │  @x/core (unchanged runtime): sessions/turns, knowledge,           │     │
│  │  connectors, schedulers, apps, MCP, code engines, git, PTY         │     │
│  │  storage: ~/.rowboat (ROWBOAT_WORKDIR)                             │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                           ▲      ▲                                          │
└───────────────────────────┼──────┼──────────────────────────────────────────┘
                            │      │   (LAN/Tailscale opt-in; QR pairing)
                     ┌──────┴──────┴──────┐        ┌────────────────────┐
                     │  phone app (RN)    │        │  third-party UIs   │
                     │  edge voice: mic → │        │  (v0 API, OpenAPI  │
                     │  STT locally, text │        │   from Zod)        │
                     │  up; TTS locally   │        └────────────────────┘
                     └────────────────────┘
```

### Components

- **`apps/x/apps/server`** (new package) — hosts the HTTP/WS layer and the ~200 core-channel handlers (moved from `apps/main/src/ipc.ts`), depends on `@x/core` exactly as main does today. Runs core's ~25 `init()` lifecycle functions. Bundled with esbuild like main (with the `node-pty` native-module carve-out); embedded in the Electron app's resources and spawned as a child; later published standalone for remote.
- **`apps/main`** (slimmed) — window management, `app://` protocol, auto-update, deep links, capture permissions, dialogs/shell/power, video popout, **server lifecycle** (spawn/kill/health), the **generic RPC forwarder**, and the WS→`webContents.send` event fan-out.
- **`packages/shared/src/ipc.ts`** — remains the single source of truth. The server router, the forwarder allowlist, the channel bucketing, and the OpenAPI docs are all derived from it.

### Channel bucketing (approximate; finalized during Phase 1)

- **Server (~200):** sessions/turns/runs, workspace/knowledge, connectors (gmail/slack/composio/oauth), models/llm, apps, bg-tasks/live-notes/schedules, code-mode/codeSession/codeRun, terminal, mcp, search/export, settings.
- **Client-local (~35):** `dialog:*`, `shell:*`, `power:*`, capture/TCC permissions, `video:popout-*`, zoom, drag-drop path resolution, `browser:*` (the interactive `WebContentsView` pane), deep-link plumbing, auto-update.
- **Reverse (server→client) capability requests:** `notification:show` (broadcast), `browser-control:execute` (single capable executor).
- **Edge capabilities (client-side by principle):** mic/camera/screen capture, STT/TTS, meeting transcription, video frame capture, Granola local-file ingest (client reads, pushes to server).

### Cross-cutting work items

- **Workspace file serving:** the `app://` protocol serves note/workspace files from local disk today; the server grows an authenticated file endpoint and main proxies `app://` to it. (Uncontested; work item, not a decision.)
- **Security hardening:** OAuth tokens are stored as plaintext JSON in `~/.rowboat` (`packages/core/src/auth/repo.ts:57`) — tolerable for a desktop app, not for a network-exposed server. File perms as a floor now; encryption-at-rest before remote ships (headless servers have no `safeStorage`; the cipher DI seam already exists).
- **Known remote-mode limitation:** the Chrome-extension sync server (`localhost:3001`) assumes the extension and server share a machine; breaks on remote. Park it.

---

## 4. Phases

### Phase 1 — the split (bulk of the work)

1. Scaffold `apps/x/apps/server`: HTTP router + WS event hub generated from `ipcSchemas`; server-key auth; health endpoint; per-connection WS sequence numbers.
2. Add the generic forwarder + per-channel flag to main (strangler-fig).
3. Migrate channels group-by-group (suggested order: read-only queries → sessions/turns + event fan-out → knowledge/workspace → connectors/OAuth relocation → code-mode + terminal + PTY move → apps/misc).
4. Move the OAuth loopback (`auth-server.ts`/`oauth-handler.ts` orchestration) server-side.
5. Switch main to spawn the server as a child process; delete the in-process path.

**Exit criteria:** Electron app is byte-for-byte the same UX, `apps/main/src/ipc.ts` contains only client-local handlers, every core call crosses localhost HTTP, dual-mode flag deleted.

### Phase 2 — second client

1. QR pairing UI in the desktop app; LAN/Tailscale bind opt-in.
2. WS capability handshake + reverse-call protocol (notifications first; browser-control after).
3. Edge-voice extraction: client-side STT/TTS against the voice proxy, `account:getAccessToken` endpoint.
4. React Native app, ruthlessly scoped v1: chat + turn streaming + voice. Nothing else.

**Exit criteria:** phone on the same Tailnet can chat with agents on the Mac, with live turn streaming and working reconnect/refetch.

### Phase 3 — remote

1. Headless distribution (npm/binary), TLS guidance (reverse proxy), docs.
2. Hosted-webapp OAuth claim flow extended beyond Google.
3. Token encryption-at-rest; key rotation UX.
4. Edge-capability uploads for remote (Granola push, workspace file proxy hardening).
5. Revisit: detached-daemon lifecycle, server-side Playwright for unattended agent browsing, SSE endpoint and/or curated stable API subset if demand exists.

---

## 5. What we want feedback on

All of it — but these are the decisions most worth attacking:

1. **Main-as-proxy (Q4).** Every server call from the Electron app takes two hops locally (IPC + localhost HTTP). We believe this is negligible and worth the zero-renderer-churn; is there a workload (token streaming? terminal echo?) where it isn't?
2. **React Native over PWA (Q17).** This is the one decision made against the interview recommendation. Is a second product codebase justified before the API stabilizes, or should Phase 2 ship a PWA first and RN after?
3. **Refetch-on-reconnect, no replay buffer (Q11).** Are there streams where a gap + refetch is user-visible in a bad way (mid-turn token streams on a flaky phone connection)?
4. **Broadcast-to-all (Q12).** Terminal output and token streams go to every connected client. Fine at 2–3 clients — anyone see a nearer-term case that forces topic subscriptions?
5. **Server key as the only auth (Q8).** One static bearer token, QR-paired. Good enough through Phase 3 (with TLS in front), or does remote need per-device tokens/revocation from day one?
6. **Strangler-fig timebox (Q15).** How long do we tolerate dual-mode in main — what's the forcing function to finish channel migration?
7. **Anything missed?** Especially: features you own that assume same-process or same-machine in ways the audit didn't surface.

Comment on the PR for this doc, or drop notes in the team channel.
