# Spaces Whiteboard — Excalidraw-style Real-Time Collaboration

**Status:** implemented (v1, 2026-08-31 — see §9 for what shipped and the manual QA list) · **Author:** Arjun (research assisted by Claude) · **Date:** 2026-08-31

Add a whiteboard to Spaces: a button in the space header opens a shared canvas where every member of the space can draw together in real time — cursors, selections, and shapes syncing live, Excalidraw-style.

**TL;DR:** This is very buildable in ~2 weeks of focused work. Excalidraw's collaboration model maps cleanly onto Harbor's existing primitives, and every function we need is a public export of the `@excalidraw/excalidraw` npm package (MIT, React 19 + Vite 7 compatible). The one architectural rule that falls out of the research: **live whiteboard traffic must stay off the durable space event log.** It rides an extended version of the ephemeral presence channel instead, with throttled blob snapshots for persistence.

---

## 1. How Excalidraw collab actually works

Collaboration is **not** in the npm package. excalidraw.com implements it in app-layer code (`excalidraw-app/collab/Collab.tsx` ~1,100 lines + `Portal.tsx` ~260 lines) on top of the editor component, and their reference server ([excalidraw-room](https://github.com/excalidraw/excalidraw-room)) is a ~150-line **content-blind** socket.io relay that stores nothing and decrypts nothing. Anyone embedding Excalidraw with custom collab reimplements the Portal/Collab sync loop (a few hundred lines) against their own transport — and the package exports all the primitives:

### Per-element last-writer-wins (not a CRDT)

Every element carries:

- `version` — integer, bumped on every mutation of that element
- `versionNonce` — random integer regenerated on every mutation (deterministic tie-breaker; on equal versions the **lower** nonce wins on every peer)
- `isDeleted` — deletion is a soft-delete tombstone that propagates like any other edit
- `index` — a fractional-index string for z-order, so concurrent reorders produce distinct indices instead of conflicting array positions

The exported `reconcileElements(localElements, remoteElements, appState)` merges two scenes per-element: higher version wins wholesale, local in-progress edits (element being typed/resized/drawn) are protected from being clobbered, unknown elements from either side are kept, and the result is re-sorted by fractional index.

**Why LWW works without a CRDT:** granularity is the whole element; whiteboard users rarely co-edit one element simultaneously; every update carries full element state so divergence is healed by the next write; tie-breaks are deterministic so all peers converge; and a **periodic full-scene rebroadcast every 20 s** (`SYNC_FULL_SCENE_INTERVAL_MS`) self-heals any dropped message. Excalidraw's own writeup: <https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature>

### Two traffic classes

| Class | Content | Delivery |
|---|---|---|
| `SCENE_UPDATE` / `SCENE_INIT` | Full JSON of elements whose `version` advanced since last broadcast (diffed against a `Map<id, version>`); full scene incl. tombstones on init and every 20 s | Reliable |
| `MOUSE_LOCATION`, `IDLE_STATUS` | Cursor x/y + button + `selectedElementIds` + username, throttled to 33 ms (~30 fps) | Volatile (droppable under backpressure) |

New collaborator joining: existing peers broadcast `SCENE_INIT` (full scene); the joiner falls back to loading from persistence after a 5 s timeout or when it's first in the room.

### Presence rendering is free

Feed the component `excalidrawAPI.updateScene({ collaborators: Map<socketId, Collaborator> })` where each entry carries `{pointer, username, selectedElementIds, color, avatarUrl, userState, ...}` — remote cursors, name labels, selection highlights, and the avatar strip all render automatically. Outbound, wire the `onPointerUpdate` prop to the transport.

### Persistence

excalidraw.com stores one Firestore doc per room: the serialized element array (tombstones included), saved throttled every 20 s inside a transaction that **reconciles against the stored doc before writing** — concurrent savers merge instead of clobbering. Images are not broadcast over the socket: blobs upload to Firebase Storage keyed by fileId (4 MiB cap), and the image element's `status: "saved"` flag (synced like any element edit) signals peers to fetch the blob lazily.

Remote updates are applied with `updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })` so they don't pollute local undo history (multiplayer undo/redo shipped in v0.18).

Tombstone GC: deleted elements stop syncing after 24 h (`DELETED_ELEMENT_TIMEOUT`) — a client offline longer than the window can resurrect deletions. Keep the window generous or track deletions server-side.

### Package facts (v0.18.1, Aug 2026)

- **License:** MIT across the board (package, monorepo, room server). Bundled fonts are generally SIL OFL — verify license files in `dist/prod/fonts` before shipping.
- **React:** peer-deps `^17.0.2 || ^18.2.0 || ^19.0.0` — React 19 officially supported (0.18+ only). react/react-dom are the *only* peers; everything else is bundled.
- **ESM-only** since 0.18 (UMD dropped). Works with Vite 7. TS needs `moduleResolution: "bundler"` or `node16`/`nodenext`.
- **Size:** ~1.1 MB min / ~353 KB gzip main entry, ~2.4 MB gzip total across 117 lazy chunks. Lazy-load with `React.lazy`.
- **CSS:** `import "@excalidraw/excalidraw/index.css"` — check for collisions with Tailwind v4 preflight.
- **⚠ Fonts load from a CDN by default.** For a packaged Electron app we must copy `node_modules/@excalidraw/excalidraw/dist/prod/fonts` into the renderer bundle and set `window.EXCALIDRAW_ASSET_PATH` before mount, or an offline app renders fallback fonts. This is the single most likely packaging pitfall (see §6).
- **Key exports we'll use:** `Excalidraw`, `reconcileElements`, `restoreElements`, `getSceneVersion`, `CaptureUpdateAction`, `serializeAsJSON`, `loadFromBlob`, `exportToBlob/Svg`, `viewportCoordsToSceneCoords`, `UserIdleState`, `LiveCollaborationTrigger`.
- **Future upgrade path:** the delta-based sync infrastructure (`onIncrement` prop, `excalidrawAPI.applyDeltas`, `StoreDelta`) landed in master during 2025 but lives in nightlies (`@excalidraw/excalidraw@next`), is largely undocumented, and has no published protocol. Build on the stable reconcile approach today; track deltas for a later bandwidth/merge upgrade. There is no official Yjs binding; community ones (`y-excalidraw`) are unmaintained and carry the same per-element LWW semantics anyway.

---

## 2. How Spaces sync works today (the relevant parts)

Harbor exposes REST + one WebSocket per org (`/v1/live`) + MCP, all thin projections over one `service.ts` core (`apps/harbor/packages/server/src/server.ts:117-136`).

**Durable writes never go over the socket.** The socket is subscribe/replay only; client→server frames are exactly three kinds: `subscribe {spaceId, afterOffset?}`, `unsubscribe`, `presence` (`apps/harbor/packages/protocol/src/events.ts:107-122`). All writes are REST: "propose full new content against a `baseVersion`" → `applied | merged | conflict`, with server-side **line-level three-way merge** (`apps/harbor/packages/server/src/merge.ts`). The durable `SpaceEvent` union is `change | message | topic | membership | reaction | message_deleted | message_edited` (`events.ts:12-49`), all sharing one append-only per-space offset sequence.

**Presence is the only ephemeral channel.** `PresenceState = 'viewing' | 'typing' | 'agent_working' | 'agent_idle' | 'idle'`; the server checks membership then hub-publishes, never persists, no offset (`service.ts:1167-1182`). The frame carries **no payload slot** — `{spaceId, memberId, state, topicId?, at}` only. (`CONTRACT.md:201` flags presence granularity as an open question.)

**Other load-bearing facts:**

- **Per-space write serialization:** every write runs inside `withSpaceLock` — one Postgres transaction holding `pg_advisory_xact_lock(hashtext(spaceId))` (`pg-store.ts:189-194`). All messages/reactions/file writes in a space contend on it.
- **Fan-out is in-process, single-node** (`hub.ts:5-7`); multi-node is explicitly deferred (`CONTRACT.md:82-83`).
- **The renderer holds no sockets and no tokens.** Main (or the standalone server in remote mode) owns the org-level WS and fans out over IPC (`apps/main/src/spaces/ipc.ts:76-87`); preload is generic and needs no changes for new channels.
- **Blobs are fully built:** content-addressed sha256 upload (`PUT /v1/spaces/:id/blobs`, 100 MB cap), membership-gated download, and a renderer-side custom protocol `app://space-blob/<orgId>/<spaceId>/<hash>[?thumb=W]` backed by a disk cache (`main/src/main.ts:224-248`, `main/src/spaces/blob-cache.ts`).
- **Size caps:** JSON bodies 2 MB, text asset content 1 MB, message bodies 64 KiB, blobs 100 MB.
- **Reconnect:** exponential backoff, re-subscribe with `afterOffset`, server replays the gap — **unbounded** (`pg-store.ts:735-741`). No offline write queue anywhere; frames sent while the socket is closed are silently dropped (`live.ts:116-122`).
- **Renderer refresh behavior:** any durable event bumps `refreshTick`, which refetches members + assets (`spaces-view.tsx:221-227`); chat messages avoid this by being applied incrementally.
- **Zod pin is load-bearing:** protocol consumed via `link:` deps; zod must stay version-identical (4.2.1) across apps/x and apps/harbor (`CONTRACT.md:206`). Harbor must be rebuilt (`npm run protocol`) before apps/x picks up protocol changes.
- **Golden merge fixtures** (`apps/harbor/packages/protocol/fixtures/merge/*.json`) pin the merge semantics; fixture `04-both-append-at-end` = **conflict by design**.

---

## 3. Why the existing durable path can't carry live whiteboard traffic

Four independent reasons — any one is disqualifying:

1. **Merge semantics.** The line-level three-way merge is meaningless for a serialized scene. Two people adding shapes ≈ fixture 04 ("both append at end") ≈ conflict on nearly every concurrent edit. Binary proposes never merge at all — any stale binary write is a hard `conflict`.
2. **Throughput.** Whiteboard edits at interaction rate through `proposeChange` would queue behind the single per-space advisory lock, contending with every chat message in the space.
3. **Size.** Text assets cap at 1 MB; a real Excalidraw scene exceeds that before it's exotic.
4. **Log pollution.** Whiteboard ops on the durable log would make reconnect replay grow without bound, trigger `refreshTick` refetch storms, and pollute activity/unread state.

The good news: Harbor already has exactly the right *shape* for live traffic — the presence path is a membership-checked, non-persisting, hub-fan-out passthrough. It just needs a frame kind that carries a payload. And Harbor's content-blind philosophy matches excalidraw-room exactly: their reference server is also a dumb relay.

---

## 4. Proposed architecture

### 4.1 Live sync — new ephemeral frame, server stays content-blind

Add a `whiteboard` frame to the protocol, client→server and server→client:

```
ClientFrame: { kind: 'whiteboard', spaceId, boardId, payload }
ServerFrame: { kind: 'whiteboard', spaceId, boardId, memberId, at, payload }
```

`payload` is **opaque to Harbor** (schema `z.unknown()` or a loosely-typed envelope). The server checks membership and hub-publishes to the space's subscribers — a near-copy of `service.publishPresence`: never persisted, never replayed, no offset. Inside `payload`, we mirror Excalidraw's own subtypes: `SCENE_UPDATE`, `SCENE_INIT`, `MOUSE_LOCATION`, `IDLE_STATUS`.

We skip Excalidraw's end-to-end encryption (room key in URL fragment, AES-GCM per message). It exists to keep their public relay zero-knowledge; Harbor is a trusted, membership-gated server, and E2E would block future server-side features (thumbnails, agent access).

No volatile/reliable distinction at the transport level (it's one WebSocket; frames are TCP-reliable while connected). Drops only happen across disconnects, and the 20 s full-scene resync + snapshot persistence heal those — same safety net excalidraw.com relies on.

### 4.2 Client collab loop (the Portal/Collab reimplementation)

A few hundred lines in the renderer + core, using only public exports:

- **Outbound:** `onChange` → gate on `getSceneVersion(elements) > lastBroadcastVersion` → diff against a `Map<elementId, version>` → broadcast only advanced elements. `onPointerUpdate` → `MOUSE_LOCATION` throttled to 33 ms. Every broadcast schedules a full-scene rebroadcast throttled to 20 s (`syncAll`, tombstones included).
- **Inbound:** `restoreElements` → `reconcileElements(local, remote, appState)` → record `getSceneVersion(reconciled)` (so we don't echo it back) → `updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })`.
- **Presence:** fold incoming `MOUSE_LOCATION`/`IDLE_STATUS` + space membership into the `collaborators` map → `updateScene({ collaborators })`. Reuse the existing member identity/display names; drop entries on TTL like `useSpacePresence` does.
- **Join:** load latest snapshot (see 4.3), announce via a `SCENE_INIT` request or just wait ≤ 20 s for the periodic full sync; peers already in the board broadcast full scene on seeing a new subscriber.

### 4.3 Persistence — throttled blob snapshots through the existing contract

Each board is an **asset** (e.g. `whiteboards/roadmap.excalidraw`) whose versions are content-addressed **blobs** via the existing `proposeChange` + blob path (scene JSON routinely exceeds the 1 MB text cap; blobs allow 100 MB):

- Save throttled to ~20 s (matching excalidraw.com's Firebase cadence) and on pane close.
- Stale binary proposes always return `conflict` — on conflict: fetch current blob, `reconcileElements` locally, re-propose. That's excalidraw.com's reconcile-before-write transaction expressed in Harbor's existing conflict contract. Since live clients converge over the ephemeral channel anyway, true conflicts are rare.
- Only these throttled snapshots touch the durable log — so the board appears in Files/activity as a normal versioned asset (history, trash, provenance for free), without flooding the log.
- Nice side effect: offline edits mostly survive. On reconnect, reconcile local scene vs. latest snapshot — higher local element versions win (modulo the 24 h tombstone window).

**Images in scenes** (removed 2026-09-01): boards are **shapes + text only** in v1. The image tool is disabled at the editor level (`UIOptions.tools.image = false`, which gates the toolbar button, paste of image files, and drag-drop inside Excalidraw), so no image can enter a scene and there is no upload pipeline to maintain. This replaced two earlier iterations (dataURLs embedded in the snapshot, then images as assets at `whiteboards/images/<fileId>`) after the upload path proved flaky in dogfood — the collab core is solid without it, and snapshots stay small agent-readable text with zero side-band bytes. If images return later, the image-as-asset design (deterministic path per fileId, `{t:'files'}` announce frame between open panes) is the recorded approach — see git history at commit `2398b641`.

### 4.4 UI placement

- **Header button** in the space top bar (`spaces-view.tsx:554-570`, next to the Talk | Read | Split mode switcher). Clicking opens the space's default board, creating it on first use.
- Model boards as a new **`RailSelection` kind** (`lib/spaces-selection.ts:3-11`) rendered in the doc pane / full-bleed, with a rail section listing boards — rather than a fourth `SpaceMode`. This gets multiple named boards per space for free and fits the files model; a mode conflates "which surface" with "which document".
- `React.lazy` the Excalidraw pane so the ~350 KB gzip main chunk doesn't load until first open.
- Presence chip: members with an active whiteboard session can surface in the existing "N here" chip (optional polish).

---

## 5. Work breakdown

| # | Piece | Files | Est. |
|---|---|---|---|
| 1 | **Protocol:** `whiteboard` Client/ServerFrame variants (+ optionally a `whiteboard_presence` state) | `harbor/packages/protocol/src/events.ts`, `core.ts`, `index.ts`; fixtures only if merge semantics change (they don't — payload is ephemeral) | 0.5 d |
| 2 | **Server:** frame handling mirroring the presence path; membership check + hub publish; tests | `harbor/packages/server/src/ws.ts` (`:140-192` switch), `service.ts`; `test/ws.test.ts`, `test/day-in-the-life.test.ts` (runs memory + Postgres — the permanent storage gate) | 1–2 d |
| 3 | **Client core:** send/receive on the org socket | `apps/x/packages/core/src/spaces/live.ts` (sender like `presence()` at `:116-122`, frame dispatch) | 0.5 d |
| 4 | **IPC plumbing** (duplicated by design): new `spaces:whiteboard` channels | `packages/shared/src/ipc.ts`, `packages/shared/src/spaces.ts`, `apps/main/src/spaces/ipc.ts` (`SpacesHandlers` + handlers + event fan-out), `apps/server/src/spaces-deps.ts`, `apps/server/src/channels.ts` (`RPC_CHANNELS`). Preload is generic — no change. | 1 d |
| 5 | **Excalidraw embed:** pane component, header button, rail entry, view-state/deep-links, font self-hosting for `app://` packaging | `apps/renderer`: new `components/spaces/whiteboard-pane.tsx`; `spaces-view.tsx`, `lib/spaces-selection.ts`, `components/spaces/space-rail.tsx`, `App.tsx` (`ViewState` `:629`, deep-link `:711-717`, serialize `:4592`, restore `:5118`); `package.json` + Vite asset copy | 2–3 d |
| 6 | **Collab client:** the §4.2 loop over the IPC bridge — diff broadcast, reconcile-on-receive, cursors, collaborators map, 20 s resync, join flow | new hook/store in `apps/renderer` (pattern: `use-space-chat.ts` stores) | 3–4 d |
| 7 | **Persistence:** throttled snapshot save (blob upload + `proposeChange` with `blob:`), reconcile-on-conflict retry, load-on-open, image fileId↔blob mapping | core `client.ts` (existing methods suffice), renderer pane | 1–2 d |
| 8 | **Polish/QA:** exclude whiteboard frames from `refreshTick` refetches, presence chip, packaged-build font/asset verification, two-machine smoke test incl. remote-server mode | | 1–2 d |

**Total: ~10–14 working days** for a v1 with live multi-user drawing, cursors, persistence, images, and reconnect healing.

Suggested sequencing: 5 (embed, single-user, local file persistence) → 1–4 (transport) → 6 (collab) → 7 (real persistence) → 8. The embed alone is demoable after step 5.

---

## 6. Risks & gotchas

- **Font/asset packaging** is the most likely pitfall: without `window.EXCALIDRAW_ASSET_PATH` pointed at bundled assets, fonts load from unpkg — broken offline, and untested under the packaged `app://` scheme with `base: './'`. Verify in a packaged build early. Also confirm font licenses in `dist/prod/fonts` (expected SIL OFL).
- **IPC hops add cursor latency:** renderer → main → Harbor (three hops in remote-server mode). At 30 fps throttle this should feel fine on realistic RTTs, but budget a fast-path (don't route whiteboard frames through zod re-validation storms; scope IPC fan-out to windows with the board open).
- **`refreshTick` refetch storm:** snapshot change-sets are durable events; at 20 s cadence that's fine, but make sure high-frequency paths never land on the log, and consider excluding `.excalidraw` change events from the members/assets refetch.
- **No offline queue:** ephemeral frames sent while disconnected are dropped. Acceptable — the local scene *is* the outbox; reconcile-on-reconnect against the latest snapshot recovers offline edits (with the 24 h tombstone resurrection caveat).
- **Single-node hub** (`hub.ts`): fine for current scale; a whiteboard doesn't change the existing ceiling, just inherits it.
- **Undo/redo:** applying remote updates with `CaptureUpdateAction.NEVER` is required or remote edits enter local undo history.
- **Zod/link discipline:** protocol changes require the Harbor rebuild dance (`npm run protocol`) and the 4.2.1 pin; nothing new, but the whiteboard PR touches both workspaces.
- **Rate limiting:** `rate_limited` exists in the protocol error enum but nothing implements it; a misbehaving client could flood the hub. Consider a simple per-connection frame budget on the server while we're in there.

---

## 7. Decisions

1. ✅ **Many named boards per space** (decided 2026-08-31). Modeled as assets under `whiteboards/`; the header button opens/creates the default board. Costs almost nothing extra given the rail-selection design.
2. ✅ **Agents can access boards** (decided 2026-08-31). Access flows through the snapshot-as-asset path, so no new server surface is needed: an agent reads the current board by fetching the asset's blob, and draws by writing a new snapshot via the same `proposeChange` + reconcile-on-conflict discipline the human clients use. Live clients see the resulting durable `change` event, fetch the new snapshot, and `reconcileElements` it into the open scene — so an agent's additions appear on everyone's canvas within one event round-trip. Requirements this adds: agent-written elements must carry valid `version`/`versionNonce`/fractional `index` fields (a small helper in `@x/shared` or core should own "make a well-formed Excalidraw element"); and the whiteboard pane must reconcile durable change events for the open board, not only ephemeral frames (small addition to §4.2's inbound path). For diagram generation, `mermaid-to-excalidraw` (bundled with the package's TTDDialog) is a practical way for agents to produce shapes without hand-authoring geometry. Exposure via Harbor's MCP face can reuse the existing asset read/write tools.
3. ✅ **Ephemeral payload typing: opaque** (decided 2026-08-31). The protocol carries `payload` as `z.unknown()` — maximally content-blind, matching excalidraw-room — with the real frame schema (`SCENE_UPDATE` / `SCENE_INIT` / `MOUSE_LOCATION` / `IDLE_STATUS`) defined app-side in `@x/shared`. Excalidraw upgrades never touch the Harbor contract.
4. ✅ **Remote-server mode supported from day one** (decided 2026-08-31). Both plumbing surfaces ship together: `apps/main/src/spaces/ipc.ts` (local) and `apps/server/src/spaces-deps.ts` + `channels.ts` (remote). This reflects a standing principle for the codebase: client–server separation is horizontal, and every new feature supports both local mode and server mode. See §7.1 for background.

### 7.1 Local vs. remote-server mode — what the decision is

apps/x is mid-way through a client–server separation (`SEPARATION_PLAN.md`, landed on main as Phase 9). The same feature ships through two different plumbing paths:

- **Local mode (how everyone runs today):** everything is on the user's machine. The renderer (React UI) holds no sockets or tokens; the Electron **main process** hosts `@x/core`, owns the org credentials and the one WebSocket to Harbor, and fans events to windows over in-process Electron IPC (`apps/main/src/spaces/ipc.ts`). The renderer↔core leg is effectively free (~0 ms), so whiteboard latency ≈ each user's RTT to Harbor.
- **Remote-server mode (the end state being migrated toward):** `apps/x/apps/server` is a **headless rowboat-server** — the same `@x/core` brain (sessions, agents, spaces stack, credentials) running as its own process, either spawned by main or **on a different machine** (an always-on box). The desktop app becomes a thin client talking to it over `POST /rpc/{channel}` + a live WebSocket. The RPC surface is a strangler-fig migration: only channels listed in `apps/server/src/channels.ts` (`RPC_CHANNELS`) exist — anything unlisted 404s — and the spaces handlers are deliberately **duplicated** between `apps/main/src/spaces/ipc.ts` and `apps/server/src/spaces-deps.ts`. Today this mode is used for integration tests and dev (`standalone.ts` requires an isolated workdir); the flip to production use is the plan's end state.

**Consequences for the whiteboard:**

- **Feature parity is opt-in per channel.** If the new `spaces:whiteboard` channels are implemented only in main, the whiteboard silently doesn't exist when the app runs against a rowboat-server. Supporting both is ~1 day of mechanical duplication (already counted in §5 row 4).
- **Latency:** a cursor frame travels *sender's renderer → sender's core → Harbor → receiver's core → receiver's renderer*. In local mode the renderer↔core legs are in-process. In remote mode each becomes a real network RTT: if the rowboat-server runs in the cloud near Harbor, totals are comparable to local mode; if it's a home machine reached from elsewhere, remote cursors get visibly laggier. Either way it's a smoothness issue, not correctness — scene sync is version-based and self-healing.
- **Known gap to respect:** `spaces:uploadBlob`'s file-path fast-path reads the file on the machine where core runs (`spaces-deps.ts:178-181`) — wrong machine in remote mode. The whiteboard only uses `uploadBlob` for the rare oversized-snapshot fallback, and sends bytes over the channel there, so both modes work; other surfaces adding file-path uploads still need to mind this.

**Recommendation:** wire both surfaces from day one — the duplication is small, remote mode is currently dev/test-only so latency QA there is low-stakes, and skipping it plants a silent feature gap that surfaces exactly when the server flip lands.

---

## 9. Implementation notes (v1, shipped 2026-08-31)

Everything in §4/§5 landed, with two deviations that improved on the plan:

1. **Snapshots are text-first, not blob-first.** A scene serializes to standard single-line `.excalidraw` JSON with `files` always empty (images are disabled — see §4.3); below ~900KB it stores as a **text asset** (so agents read and draw boards through the plain `read_asset`/`propose_change` MCP tools — no MCP surface changes were needed for decision #2), with a blob-version fallback that the empty-`files` shape makes rare. The single-line shape is load-bearing: Harbor's line-merge can never produce a mangled "merged" body for it — non-identical concurrent saves always conflict (fixture 02 semantics), which the reconcile-and-retry loop handles, and identical saves merge as identical bytes (fixture 06).
2. **Rowboat skin, not stock Excalidraw** (added 2026-09-01). `components/spaces/whiteboard.css` remaps the editor's documented CSS custom properties to the app's design tokens (islands/popups/inputs/radius/shadows follow App.css light+dark) and swaps the signature purple accent for a calm blue; new elements default to crisp strokes + the clean sans (`currentItemRoughness: 0`, `FONT_FAMILY.Nunito` — the sketchy style and hand-drawn font stay in the picker). The Library trigger (external excalidraw.com libraries) is hidden; its top-right slot instead renders (via `renderTopRightUI`) the board's **name chip** — a popover switcher listing the space's boards plus a "New board…" input (the header Board button stays a stable label on purpose: a control that morphs into the board name reads as a channel and loses its identity) — and live collaborator avatars colored by the same per-client hue as their cursors (`Collaborator.color`); the help dialog keeps its shortcut sheet but loses its external-links header; ⌘O/⌘S/theme-toggle canvas actions are off (the space owns persistence, the app owns theme); a custom `WelcomeScreen` replaces the stock wordmark empty state. On package upgrades, re-verify the variable names in whiteboard.css still exist.
3. **Split docks the board beside chat** (added 2026-09-01). Split (⌘3) with a board open keeps the board and places it in the document slot — chat left, live board right, the usual draggable divider between (shared `docWidth`, ≥420px so Excalidraw's compact UI has room). Talk/Read still leave the board; full-bleed stays the default and the too-narrow-for-Split fallback lands on full-bleed. Implementation detail that matters: the board pane keeps ONE tree position for full ⇄ split (a wrapper flex-`order`s it right of the chat), so toggling never remounts the live collab session — no rejoin, no cursor flicker.
4. **Remote mode needed no bespoke event relay.** `spaces:events` was already in the shared `PUSH_CHANNELS` whitelist and the desktop's events client relays those payload-generically, so incoming whiteboard frames flow through child/remote server mode untouched. Only the send channel (`spaces:whiteboard`) needed the dual-surface treatment.
5. **Snapshot writes go through `lib/whiteboard-saver.ts`** (added 2026-09-02, after a board wiped in prod). The original pane read the scene from the Excalidraw API at save time, and three Excalidraw behaviors turned that into a data-loss race: the `excalidrawAPI` callback fires from the App **constructor** while the scene is still empty; `initialData` hydrates **async** and fires `onChange` itself (which read as a user edit, marking every open dirty); and `componentWillUnmount` swaps in a **fresh empty scene** that the API keeps answering for. Open a board, close it, and the unmount flush saved `{"elements":[]}` over the real content. The saver is a pure state machine (unit-tested, `whiteboard-saver.test.ts`): it exists only once the snapshot has loaded, accepts a local change only when `getSceneVersion` advances past the hydrated scene's (clear-canvas still saves — deletion marks `isDeleted` via `newElementWith`, which bumps versions), serializes the last scene it *accepted* rather than re-reading the editor, and `dispose()` guarantees a dead pane can never write again.

**File map:**

- Protocol: `harbor/packages/protocol/src/events.ts` (whiteboard Client/ServerFrame, payload `z.unknown()`), `CONTRACT.md` amendment 2026-08-31
- Server: `harbor/packages/server/src/service.ts` (`publishWhiteboard`), `ws.ts` (frame case), `test/ws.test.ts` (relay + forbidden tests)
- Core: `packages/core/src/spaces/live.ts` (`whiteboard()` sender; receive path needed nothing — subscriptions already deliver every space-scoped frame), round-trip test in `client.test.ts`
- Shared: `packages/shared/src/spaces.ts` (payload vocabulary `scene`/`scene_request`/`cursor`/`idle`, `WHITEBOARD_DIR` conventions), `ipc.ts` (`spaces:whiteboard` channel)
- Main: `apps/main/src/spaces/ipc.ts`; Server app: `apps/server/src/spaces-deps.ts` + `channels.ts`
- Renderer: `components/spaces/whiteboard-pane.tsx` (the collab loop — diff broadcasts gated on `getSceneVersion`, 20s full-scene self-heal, `reconcileElements` + `CaptureUpdateAction.NEVER` on receive, cursor frames at 33ms, collaborator TTL + heartbeats, image tool disabled), `lib/whiteboard-saver.ts` + `.test.ts` (text/blob snapshot save with conflict-reconcile-retry and the hydration/unmount write gates — see note 5), `spaces/whiteboard.css` (the Rowboat skin — see note 2), `spaces-view.tsx` (header Board button, ⌘4, full-bleed dispatch), `space-rail.tsx` (Whiteboards section; boards hidden from the file tree), `lib/spaces-selection.ts` (`whiteboard` kind), `vite.config.ts` (self-hosted Excalidraw fonts for dev + the packaged `app://` origin)

**Verified:** harbor suite 211 passing (incl. new relay tests), core spaces 39 (incl. a real-socket whiteboard round-trip through the stub), renderer 365, server app 27; typecheck + lint clean; production renderer build splits Excalidraw into a ~1MB lazy chunk and copies fonts into `dist/excalidraw-assets/`.

**Manual QA still to do (needs two running apps):** two-machine draw session (cursors, concurrent edits, join-mid-session), packaged-build font rendering (`Excalifont` vs fallback — the CDN fallback must never fire), agent drawing via MCP (`propose_change` on `whiteboards/*.excalidraw` with valid `version`/`versionNonce`/`index` fields appearing live), remote-server-mode cursor latency feel.

## 8. Sources

- Reconciliation: <https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/reconcile.ts>
- Collab client: <https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx> and `Portal.tsx`
- Wire protocol constants: `excalidraw-app/app_constants.ts`, payload shapes: `excalidraw-app/data/index.ts`
- Persistence: <https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/firebase.ts>
- Relay server: <https://github.com/excalidraw/excalidraw-room>
- v0.18 release (ESM, multiplayer undo): <https://github.com/excalidraw/excalidraw/releases/tag/v0.18.0>
- Docs: <https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation>
- P2P collab design writeup: <https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature>
- Harbor contract: `apps/harbor/CONTRACT.md`; merge fixtures: `apps/harbor/packages/protocol/fixtures/merge/`
