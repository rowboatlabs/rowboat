# Mini Apps — Implementation Plan

> Status: **Phase 1 (UI + rendering, hand-coded apps)** in progress.
> Branch: `feature/mini-apps`. Working dir: `apps/x`.

## 1. What we're building (agreed design)

A **Mini App** is a user-created, personal app that lives inside Rowboat under a
**"Mini Apps"** sidebar tab, shown as cards; click a card to open and use it like
a standalone app.

The settled mental model:

> A Mini App = **custom UI code** (a single self-contained HTML file: React +
> Tailwind, no build step, runs in a sandboxed iframe) + an **agent "backend"**
> that produces fresh **data** on a trigger + an optional **state store** + a
> **scoped bridge** that lets the UI call real **Composio** actions.

Key decisions (the "why" behind the architecture):

- **Opens to a finished, populated screen.** The agent runs *before* open (on a
  trigger); the UI just renders the latest result. Maps onto the existing
  background-agents engine.
- **Frontend/backend split.** Code = frontend, written once. Agent = backend,
  produces fresh `data.json` each run. The UI is *not* regenerated per run.
  Cheaper, faster, and the UI can't break on refresh.
- **A data contract** ties the three pieces together: at creation the builder
  produces a matched triple — UI code + data schema + agent instructions.
- **Fully custom UI per app** (generated code), not a fixed block kit.
- **Real interactivity** via a **scoped bridge** to Composio (each app declares
  the integrations it may touch; scope drives both enforcement and the auth
  prompt).
- **Built by whatever engine is selected in the chat box** — Code Mode
  (Claude Code / Codex) if the user has it, else the Copilot.
- **Living apps:** refined by chatting; breakage is first-class (app surfaces
  errors → "fix with copilot").
- **State is an optional provided primitive** (per-app persistent store the agent
  and UI can read/write). Stateless apps ignore it.
- **Personal/local only** for now, but each app is a **self-contained folder**
  so it can become portable later.

### Framework for the apps

Single self-contained `index.html` rendered in a sandboxed iframe.

> **Learning (Phase 1):** remote CDNs do NOT work inside the sandboxed,
> opaque-origin `srcdoc` iframe (React/Tailwind/Babel from unpkg/cdn.tailwindcss
> failed → blank screen). Apps must be **fully self-contained, no network**.
> Phase 1 therefore ships **vanilla HTML + CSS + JS** (no build, no transpile).
> The React+Tailwind LLM-friendly target still stands for generation — but via a
> **locally-bundled** runtime (esbuild-at-save, libs injected into the HTML),
> never remote CDNs. The `window.rowboat` bridge is unchanged either way.

The UI talks to the host through a `window.rowboat` **bridge** (the product
surface *and* the security boundary):

```
rowboat.getData(): Promise<Data>             // latest agent output
rowboat.onData(cb): void                      // re-render on refresh
rowboat.getState() / setState(patch)          // per-app persistent store
rowboat.callAction(scope, action, args)       // scoped Composio call
rowboat.ready()                               // handshake: "send me data"
```

## 2. Phased roadmap

1. **Surface + one real app (UI-first — THIS PHASE).** "Mini Apps" sidebar tab,
   card grid, click to open. One **hardcoded** app (Twitter client) rendered in a
   sandboxed iframe from a self-contained HTML file, reading static data through a
   minimal bridge. Proves the *experience* and the *rendering path*. No agent,
   no storage, no real Composio yet.
2. **The scoped bridge.** Real interactive buttons → real Composio actions,
   enforced against a per-app manifest scope; auth prompt on demand.
3. **Generation.** Copilot/Code-Mode generates the UI+schema+agent triple from a
   chat description. Rides the existing chat mode selector + `code-with-agents`.
4. **Living apps + breakage recovery.** Conversational edits; error surfacing.
5. **Scale & polish.** Context-overload windowing (e.g. 100 tweets); app
   notifications (reuse `notify-user`).
6. **(V2)** Drag an app into the main workspace (macOS-style).

## 2b. Phase 2.5 — On-disk apps + `app://miniapp` serving (CURRENT)

Move built-in apps out of source into `~/.rowboat/apps/<id>/`, served as static
assets, with an optional background agent producing `data.json`. Sets up the
copilot builder path (it will write the same folder layout). Team-agreed.

### On-disk layout (one folder per app)
```
~/.rowboat/apps/<id>/
  manifest.json     # id, title, description, source, scope[], active, lastRun,
                    #   entry (default "dist/index.html"), agent (optional bg-task slug)
  dist/             # static assets served via app://miniapp/<id>/...
    index.html      # the app (self-contained; bridge shim inlined)
  data.json         # latest agent output (read by the host, pushed to the app)
```

### Serving — `app://miniapp/<id>/<path>` (option A)
- Extend `registerAppProtocol` (`apps/main/src/main.ts`) with a new host
  `miniapp`: map `app://miniapp/<id>/<path>` → `~/.rowboat/apps/<id>/dist/<path>`
  (path-traversal guarded; default `index.html`). `app://` is already registered
  privileged (standard/secure/fetch/cors) so apps get a **real origin** —
  remote CDNs/images and `fetch` work, unlike the opaque `srcdoc` origin.
- The iframe loads via `src="app://miniapp/<id>/index.html"` (not `srcDoc`).
  Sandbox becomes `allow-scripts allow-same-origin allow-popups allow-forms
  allow-modals allow-downloads` — same-origin is its OWN `app://miniapp` origin,
  still isolated from the renderer (different host).

### Data path
- Built-in/static `data` is seeded to `data.json`. A future background agent
  (reuse bg-tasks engine, linked via manifest `agent`) overwrites it on schedule.
- App keeps using `rowboat.onData`; the **host** now sources that data by reading
  `~/.rowboat/apps/<id>/data.json` (via IPC) and posting it on `ready`. Composio
  still flows through the bridge RPC. (GitHub app needs no `data.json` — it pulls
  live via Composio.)

### Steps
1. **Shared schema** — `packages/shared/src/mini-app.ts`: `MiniAppManifest` zod +
   type. Export it. New IPC channels in `shared/src/ipc.ts`:
   - `mini-apps:seed` (req: `{apps:[{manifest, html, data?}]}`) — idempotent.
   - `mini-apps:list` (res: `{manifests: MiniAppManifest[]}`).
   - `mini-apps:get-data` (req `{id}`, res `{data: unknown|null}`).
2. **Main** — `apps/main/src/mini-apps-handler.ts`: `seedApps` (write
   manifest/dist/data to `~/.rowboat/apps/<id>/` only if absent), `listApps`
   (read manifests), `getAppData` (read data.json). Register handlers in
   `ipc.ts`. Extend `registerAppProtocol` for the `miniapp` host.
3. **Renderer** — keep `MiniApp` defs + `buildMiniAppHtml`; `registry.ts` adds
   `toSeed(app)` (→ `{manifest, html, data}`). `MiniAppsView`: on mount → `seed`
   → `list` → render cards from manifests. `MiniAppFrame`: take the manifest,
   load `src=app://miniapp/<id>/<entry>`, on `ready` fetch `mini-apps:get-data`
   and post it; RPC scope from `manifest.scope`.
4. **Verify**: GitHub app end-to-end from disk (`~/.rowboat/apps/github-radar/`),
   then the others; confirm connect + live PRs still work.

### Out of scope here (next: copilot builder, tomorrow)
Copilot writing a new app folder + an associated background agent; the agent
browsing via embedded browser for social feeds; copilot verifying Composio wiring
by actually calling tools before finalizing.

## 3. Phase 1 — detailed implementation

UI-first. Everything hand-coded; no `~/.rowboat` storage, no IPC, no agent yet.
We *do* mirror the eventual shapes so later phases slot in.

### 3.1 New files (renderer)

| File | Purpose |
|------|---------|
| `apps/renderer/src/mini-apps/types.ts` | `MiniApp` type (id, name, description, icon, accent, scope, html, data). |
| `apps/renderer/src/mini-apps/registry.ts` | Hardcoded list of `MiniApp`s for Phase 1. |
| `apps/renderer/src/mini-apps/apps/twitter-client.ts` | The sample app: self-contained HTML (React+Tailwind+Babel CDN) + static `data`. |
| `apps/renderer/src/components/mini-apps-view.tsx` | Card grid; internal `selectedAppId` state; renders grid or open app. |
| `apps/renderer/src/components/mini-app-frame.tsx` | Sandboxed iframe (`srcdoc`) + `window.rowboat` postMessage bridge (data wired; actions stubbed → toast/log). |

The bridge message protocol (host ↔ iframe), defined once and shared:
- iframe → host: `{ type: 'rowboat:mini-app:ready' }`,
  `{ type: 'rowboat:mini-app:action', id, scope, action, args }`,
  `{ type: 'rowboat:mini-app:setState', patch }`
- host → iframe: `{ type: 'rowboat:mini-app:data', data }`,
  `{ type: 'rowboat:mini-app:state', state }`,
  `{ type: 'rowboat:mini-app:action-result', id, ok, result?, error? }`

### 3.2 Wiring into `App.tsx` (mirror the `bg-tasks` view exactly)

Add a first-class `apps` view. Edit sites (all mirror an existing view):

1. **Tab path const** (~L198): add `const APPS_TAB_PATH = '__rowboat_mini_apps__'`.
2. **Tab predicate** (~L374): `const isAppsTabPath = (path) => path === APPS_TAB_PATH`.
3. **ViewState union** (~L636): add `| { type: 'apps' }`.
4. **`parseDeepLink`** (~L713): add `case 'apps': return { type: 'apps' }`.
5. **State flag** (~L825): `const [isAppsOpen, setIsAppsOpen] = useState(false)`.
6. **Tab title** (~L1253): `if (isAppsTabPath(tab.path)) return 'Mini Apps'`.
7. **Tab activation → flag** (~L3269, ~L3443): set `isAppsOpen` from tab path.
8. **Closing-tab guard** (~L3376): add `&& !isAppsTabPath(closingTab.path)`.
9. **`currentViewState`** (~L3770): `if (isAppsOpen) return { type: 'apps' }`
   (place alongside bg-tasks; add to deps array).
10. **`ensureAppsFileTab`** (~L3853): mirror `ensureBgTasksFileTab`.
11. **`openAppsView`** (~L3953): mirror `openBgTasksView`; reset all other flags,
    `setIsAppsOpen(true)`, `ensureAppsFileTab()`.
12. **`applyViewState` switch** (~L4195): add `case 'apps':` mirroring `bg-tasks`.
13. **Add `setIsAppsOpen(false)`** to every *other* view's reset block (the
    shared multi-`set...(false)` lines) so opening another view clears apps and
    closing it doesn't fall back to apps. Use targeted edits per block.
14. **Derived booleans** that OR all view flags (isFullScreenChat,
    rightPaneAvailable, inFileView, rightPaneContext, viewOpen, keyboard guards):
    add `|| isAppsOpen` / `&& !isAppsOpen` consistently (search `isBgTasksOpen`).
15. **Tab-path mapping** (~L4668): add `: isAppsOpen ? APPS_TAB_PATH`.
16. **Render branch** (~L5894): add `) : isAppsOpen ? (<MiniAppsView ... />`.

### 3.3 Sidebar entry (`sidebar-content.tsx`)

- Add `onOpenApps?: () => void` prop (~L163) and destructure (~L412).
- Add a `SidebarMenuButton` with `isActive={activeNav === 'apps'}` and a
  `LayoutGrid` (lucide) icon, label "Mini Apps", in the lower nav group near
  "Background agents" (~L830).
- Thread `activeNav === 'apps'` from the parent (App.tsx passes `activeNav` based
  on `isAppsOpen`, mirroring how `'agents'` is derived ~L5651).
- Wire `onOpenApps={openAppsView}` at the `SidebarContent`/home call sites
  (~L5657, ~L5832).

### 3.4 The sample app (twitter-client)

Self-contained HTML string. React + ReactDOM + Babel-standalone + Tailwind, all
via CDN. Renders three sections — **To read / To repost / To respond** (reply
pre-drafted) — from data delivered via `rowboat.onData`. Buttons call
`rowboat.callAction('twitter', ...)`; in Phase 1 the host just toasts/logs and
returns a fake ok. Static `data` lives next to the HTML.

> Note: CDN scripts require network + `allow-scripts` in the sandbox. The frame
> uses `sandbox="allow-scripts allow-popups allow-forms allow-modals"` — **no**
> `allow-same-origin` (keeps the app from reaching host cookies/storage; the
> bridge is the only channel). Verify CDN loads under this sandbox during testing;
> if blocked, fall back to bundling the libs locally as a renderer asset.

### 3.5 Verify

- `cd apps/x && npm run deps && npm run lint` compiles clean.
- `npm run dev`: "Mini Apps" appears in the sidebar; opens the card grid; clicking
  the Twitter card renders the app full-screen in the pane; sections populate from
  data; clicking a button shows the stubbed action result; tabs/back/forward and
  switching to other views behave like every other view.

## 4. Out of scope for Phase 1 (later phases)

`~/.rowboat/apps/<slug>/` storage + IPC; the agent backend (reuse bg-tasks
engine); real Composio execution through the bridge; per-app scope enforcement &
auth prompting; generation via Copilot/Code-Mode; persistent state store;
conversational editing & error recovery; the V2 workspace drag.
