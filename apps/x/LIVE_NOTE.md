# Live Notes

> A single `live:` frontmatter block that turns a markdown note into a self-updating artifact — refreshed on a schedule (cron / windows), in response to incoming events (Gmail, Calendar), or on demand.

A live note has exactly **one** `live:` block in its YAML frontmatter. The block carries a persistent **objective** (what the note should keep being), an optional **triggers** object (when the agent should fire), and runtime fields the system writes back. The body below the H1 is owned by the live-note agent — it freely synthesizes, dedupes, and reorganizes the content to satisfy the objective. A note with no `live:` key is just a static note.

**Example** (a note that shows the current Chicago time, refreshed hourly):

~~~markdown
---
live:
  objective: |
    Show the current time in Chicago, IL in 12-hour format. Keep it as one
    short line, no extra prose.
  active: true
  triggers:
    cronExpr: "0 * * * *"
  lastAttemptAt: "2026-05-08T15:00:00.123Z"
  lastRunAt: "2026-05-08T15:00:01.234Z"
  lastRunId: "..."
  lastRunSummary: "Updated — 3:00 PM, Central Time."
  lastRunError: null
---

# Chicago time

3:00 PM, Central Time
~~~

## Table of Contents

1. [Product Overview](#product-overview)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Technical Flows](#technical-flows)
4. [Schema Reference](#schema-reference)
5. [Body Structure](#body-structure)
6. [Daily-Note Template & Migrations](#daily-note-template--migrations)
7. [Renderer UI](#renderer-ui)
8. [Prompts Catalog](#prompts-catalog)
9. [File Map](#file-map)

---

## Product Overview

### One note, one objective

A live note has at most one `live:` block. The block has exactly one `objective`. The objective can be long and cover multiple sub-topics — the agent treats the note holistically and is free to lay out the body however the objective suggests. **There is no second objective per note.** When the user asks Copilot to "also keep an eye on X" in an already-live note, Copilot is trained to extend the existing objective in natural language rather than fork a second block.

This is intentional: the user is *delegating awareness*, not configuring automations. Multiple agents per note led to ownership confusion, scope boundaries, and orchestration concerns that don't fit a personal-knowledge tool.

### Triggers

The `triggers` object has three independently optional sub-fields. Each one is its own channel; mix freely.

| Field | When it fires | Shape |
|---|---|---|
| **`cronExpr`** | At exact cron times | `cronExpr: "0 * * * *"` |
| **`windows`** | Once per day per window, anywhere inside a time-of-day band | `windows: [{ startTime: "09:00", endTime: "12:00" }]` |
| **`eventMatchCriteria`** | When a matching event arrives (e.g. new Gmail thread) | `eventMatchCriteria: "Emails about Q3 planning"` |

A `triggers` block with no fields (or no `triggers` key at all) is **manual-only** — the agent fires only when the user clicks Run in the panel.

`cronExpr` enforces a 2-minute grace window — if the scheduled time passed more than 2 minutes ago (e.g. the app was offline), the run is skipped, not replayed. `windows` are forgiving by design: as long as it's still inside the band and the day's cycle hasn't fired yet, the agent fires the moment the app is open. Each window's daily cycle is anchored at `startTime`.

The `once` trigger from the prior model has been **dropped** — it didn't fit the "ongoing awareness" framing.

### Creating a live note

Two paths, both producing identical on-disk YAML:

1. **Hand-written** — type the `live:` block directly into the note's frontmatter. The scheduler picks it up on its next 15-second tick.
2. **Sidebar chat** — mention a note (or have it attached) and ask Copilot for something dynamic. Copilot is tuned to recognize a wide range of phrasings beyond "live" or "track" (see "Prompts Catalog → Copilot trigger paragraph"); it loads the `live-note` skill, edits the frontmatter via `file-editText`, then **runs the agent once by default** so the user immediately sees content. The auto-run is skipped only when the user explicitly says not to run yet.

When the note is **already live** and the user asks to track something new, Copilot extends the existing `live.objective` in natural-language prose. It does not create a second `live:` block.

### Viewing and managing live notes

The editor toolbar has a Radio-icon button (right side) that opens the **Live Note panel** for the current note. The panel:

- **Empty state** (passive note) — "Make this note live" CTA that hands off to Copilot for the natural-language flow.
- **Editor** — single panel with: objective textarea, triggers editor (cron / windows list / eventMatchCriteria, each independently shown via add/remove), status row (last-run summary + active toggle), Advanced (collapsed: model + provider), footer (Edit with Copilot · Save · Run now), and a danger-zone "Make passive" button.
- **Status hook** — `useLiveNoteAgentStatus` subscribes to `live-note-agent:events` IPC; the Run button shows a spinner whenever the agent is running.

Every mutation goes through IPC to the backend — the renderer never writes the file itself. This avoids races with the scheduler/runner writing runtime fields like `lastRunAt`.

### What the runtime agent does

When a trigger fires, the live-note agent receives a short message:
- The workspace-relative path to the note and a localized timestamp.
- The objective.
- For event runs only: the matching `eventMatchCriteria` text and the event payload, with a Pass-2 decision directive ("only edit if the event genuinely warrants it").

The agent's system prompt tells it to:
1. Call `file-readText` to read the current note (the body may be long; no body snapshot is passed in the message — fetch fresh).
2. Make small, **patch-style** edits with `file-editText` — change one region, re-read, change the next region — rather than one-shot rewrites.
3. Follow default body structure unless the objective overrides: H1 stays the title; a 1-3 sentence rolling summary at the top; H2 sub-topic sections below, freshest first.
4. Never modify YAML frontmatter — that's owned by the user and the runtime.
5. End with a 1-2 sentence summary stored as `lastRunSummary`.

The agent has the full workspace toolkit (read/edit/grep/web-search/browser/MCP).

---

## Architecture at a Glance

```
Editor toolbar Radio button ─click──► LiveNoteSidebar (React)
                                            │
                                            ├──► IPC: live-note:get / set /
                                            │        setActive / delete / run
                                            │
Backend (main process)
  ├─ Scheduler loop  (15 s) ──┐
  ├─ Event processor (5 s)  ──┼──► runLiveNoteAgent() ──► live-note-agent
  └─ Builtin tool             │                                     │
     run-live-note-agent  ────┘                                     ▼
                                                  file-readText / -edit
                                                                    │
                                                                    ▼
                                                  body region(s) rewritten on disk
                                                  frontmatter lastRun* patched
```

**Single-writer invariant** — the renderer is never a file writer for the `live:` key. All on-disk changes go through backend helpers in `packages/core/src/knowledge/live-note/fileops.ts` (`setLiveNote`, `patchLiveNote`, `setLiveNoteActive`, `deleteLiveNote`). `extractAllFrontmatterValues` in the renderer's frontmatter helper explicitly skips the `live:` key (and `buildFrontmatter` splices it back from the original raw on save), so the FrontmatterProperties UI can't accidentally mangle it.

**Event contract** — `window.dispatchEvent(CustomEvent('rowboat:open-live-note-panel', { detail: { filePath } }))` is the sole entry point from editor toolbar → panel. `rowboat:open-copilot-edit-live-note` opens the Copilot sidebar with the note attached.

---

## Technical Flows

### Scheduling (cron / windows)

- **Module**: `packages/core/src/knowledge/live-note/scheduler.ts`. Polls every **15 seconds** (`POLL_INTERVAL_MS`).
- Each tick: `workspace.readdir('knowledge', { recursive: true })`, filter `.md`, `fetchLiveNote(relPath)` for each.
- For each note with a `live:` block where `active !== false`, `dueTimedTrigger(triggers, lastRunAt)` returns `'cron'`, `'window'`, or `null` — pure cycle check, no backoff. The scheduler then calls `backoffRemainingMs(lastAttemptAt)` separately so it can log "matched cron, backoff 4m remaining" rather than collapse the two reasons.
- When due AND not in backoff, fire `runLiveNoteAgent(relPath, source)` where `source` is `'cron'` or `'window'` (the granular trigger surfaces all the way to the agent message — see Trigger granularity).
- **Cycle anchoring** — anchored on `lastRunAt`, which is bumped only on *successful* completions. A failed run leaves the cycle unfired so the scheduler retries.
- **Backoff** — `RETRY_BACKOFF_MS = 5 min`. If `lastAttemptAt` is within that window, the scheduler skips the note. Covers both in-flight runs (the in-memory concurrency guard handles the common case; backoff is the disk-persistent backstop) and post-failure storming. Manual runs (clicked Run) bypass this — they don't go through the scheduler.
- **Cron grace** — `cronExpr` enforces a 2-minute grace; missed schedules are skipped, not replayed.
- **Windows** have no grace — anywhere inside the band counts. A failed run inside the band leaves the window unfired; the next eligible tick (after backoff) retries.
- **Window cycle anchor** — a window's daily cycle starts at `startTime`. Once a *successful* fire lands strictly after today's `startTime`, that window is done for the day. The strict comparison handles the boundary case (e.g. an 08:00–12:00 + a 12:00–15:00 window each get to fire even when the morning fire happens exactly at 12:00:00).
- **Startup** — `initLiveNoteScheduler()` is called in `apps/main/src/main.ts` at app-ready, alongside `initLiveNoteEventProcessor()`.

### Event pipeline

**Producers** — any data source that should feed live notes emits events:
- **Gmail** (`packages/core/src/knowledge/sync_gmail.ts`) — call sites after a successful thread sync invoke `createEvent({ source: 'gmail', type: 'email.synced', payload: <thread markdown> })`.
- **Calendar** (`packages/core/src/knowledge/sync_calendar.ts`) — one bundled event per sync, with a markdown digest payload built by `summarizeCalendarSync()`.

**Storage** — `packages/core/src/knowledge/live-note/events.ts` writes each event as a JSON file under `~/.rowboat/events/pending/<id>.json`. IDs come from the DI-resolved `IdGen` (ISO-based, lexicographically sortable) — so `readdirSync(...).sort()` is strict FIFO.

**Consumer loop** — same file, `init()` polls every **5 seconds**, then `processPendingEvents()` walks sorted filenames. For each event:
1. Parse via `KnowledgeEventSchema`; malformed files go to `done/` with `error` set (the loop stays alive).
2. `listEventEligibleLiveNotes()` scans every `.md` under `knowledge/`. Only notes where `live.active !== false` and `live.triggers?.eventMatchCriteria` is set are event-eligible.
3. `findCandidates(event, eligible)` runs Pass 1 LLM routing (below).
4. For each candidate, `runLiveNoteAgent(filePath, 'event', event.payload)` **sequentially** — preserves total ordering within the event.
5. Enrich the event JSON with `processedAt`, `candidateFilePaths`, `runIds`, `error?`, then move to `events/done/<id>.json`.

**Pass 1 routing** (`routing.ts`):
- **Short-circuit** — if `event.targetFilePath` is set (manual re-run events), skip the LLM and return that note directly.
- Batches of `BATCH_SIZE = 20`.
- Per batch, `generateObject()` with `ROUTING_SYSTEM_PROMPT` + `buildRoutingPrompt()` and `Pass1OutputSchema` → `{ filePaths: string[] }`. Direct path-based dedup (no composite key needed since live-note is one-per-file).

**Pass 2 decision** happens inside the live-note agent (see Run flow) — Pass 1 is liberal, the agent vetoes false positives before touching the body.

### Trigger granularity

Internal trigger enum (`LiveNoteTriggerType`) is `'manual' | 'cron' | 'window' | 'event'` — propagated end-to-end through `runLiveNoteAgent(filePath, trigger, context?)`, the `liveNoteBus` start event, and the `live-note-agent:events` IPC payload.

- The **scheduler** passes `'cron'` or `'window'` based on which sub-trigger `dueTimedTrigger` matched.
- The **event processor** always passes `'event'`.
- The **panel Run button** and the **`run-live-note-agent` builtin tool** both pass `'manual'`.

`buildMessage` always emits a `**Trigger:**` paragraph in the agent's run message — one paragraph per kind. `manual` and the two timed variants (`cron`, `window`) include any optional `context` as a `**Context:**` block. `event` includes the eventMatchCriteria + payload + Pass 2 decision directive (no `**Context:**`; the payload *is* the context).

This lets the user-authored objective branch on trigger kind when warranted (for example, an email digest can scan `gmail_sync/` from scratch on cron/window runs, while event runs integrate just the new thread). The skill teaches the pattern under "Per-trigger guidance (advanced)".

### Run flow (`runLiveNoteAgent`)

Module: `packages/core/src/knowledge/live-note/runner.ts`.

1. **Concurrency guard** — static `runningLiveNotes: Set<string>` keyed by `filePath`. Duplicate calls return `{ action: 'no_update', error: 'Already running' }`.
2. **Fetch live note** via `fetchLiveNote(filePath)`.
3. **Snapshot body** via `readNoteBody(filePath)` for the post-run diff.
4. **Create agent run** — `createRun({ agentId: 'live-note-agent' })`.
5. **Bump `lastAttemptAt` + `lastRunId` immediately** (before the agent executes). `lastAttemptAt` is the disk-persistent backoff anchor — the scheduler suppresses fires within `RETRY_BACKOFF_MS` (5 min) of it, covering both in-flight runs and post-failure backoff. **`lastRunAt` is not touched here** — that field is the cycle anchor and should only move on success.
6. **Emit `live_note_agent_start`** on the `liveNoteBus` with the trigger type (`manual` / `timed` / `event`).
7. **Send agent message** built by `buildMessage(filePath, live, trigger, context?)` (see Prompts Catalog #4). The path is converted to its workspace-relative form (`knowledge/${filePath}`) so the agent's tools resolve correctly.
8. **Wait for completion** — `waitForRunCompletion(runId)`, then `extractAgentResponse(runId)` for the summary.
9. **Compare body**: re-read body via `readNoteBody(filePath)`, diff vs the snapshot. If changed → `action: 'replace'`; else → `action: 'no_update'`.
10. **On success:** `patchLiveNote(filePath, { lastRunAt: now, lastRunSummary, lastRunError: undefined })`.
11. **On failure:** `patchLiveNote(filePath, { lastRunError: msg })`. **`lastRunAt` and `lastRunSummary` are deliberately untouched** so the user keeps seeing the last good state in the UI, and the scheduler treats the cycle as unfired (windows will retry inside the same band, gated only by the 5-min backoff).
12. **Emit `live_note_agent_complete`** with `summary` or `error`.
13. **Cleanup**: `runningLiveNotes.delete(filePath)` in a `finally` block.

Returned to callers: `{ filePath, runId, action, contentBefore, contentAfter, summary, error? }`.

**Stops** — when the user clicks Stop in the panel, `live-note:stop` resolves the latest `lastRunId` and calls `runsCore.stop(runId, false)`. The runner's `waitForRunCompletion` throws, the failure branch records `lastRunError`, and the bus emits `complete` with the error. The cycle stays unfired (so the run is retried on the next tick after backoff expires) — exactly the same path as any other failure.

### IPC surface

| Channel | Caller → handler | Purpose |
|---|---|---|
| `live-note:run` | Renderer (panel Run button) | Fires `runLiveNoteAgent(..., 'manual')` |
| `live-note:get` | Panel on open | Returns the parsed `LiveNote \| null` from frontmatter |
| `live-note:set` | Panel save | Validates + writes the whole `live:` block |
| `live-note:setActive` | Panel toggle | Flips `active` |
| `live-note:delete` | Panel "Make passive" | Removes the entire `live:` block |
| `live-note:stop` | Panel Stop button | Resolves the live block's `lastRunId` and calls `runsCore.stop(runId)` |
| `live-note:listNotes` | Background-agents view | Lists all live notes with summary fields |
| `live-note-agent:events` | Server → renderer (`webContents.send`) | Forwards `liveNoteBus` events to `useLiveNoteAgentStatus` |

Request/response schemas live in `packages/shared/src/ipc.ts`; handlers in `apps/main/src/ipc.ts`; backend helpers in `packages/core/src/knowledge/live-note/fileops.ts`.

### Concurrency & FIFO guarantees

- **Per-note serialization** — the `runningLiveNotes` guard in `runner.ts`. A note is at most running once at a time; overlapping triggers (manual + scheduled + event) return `error: 'Already running'`.
- **Backend is single writer for `live:`** — all editing goes through fileops; the renderer's FrontmatterProperties UI explicitly preserves `live:` byte-for-byte across saves.
- **File lock** — every fileops mutation runs under `withFileLock(absPath)` so the runner, scheduler, and IPC handlers serialize on the file.
- **Event FIFO** — monotonic `IdGen` IDs → lexicographic filenames → `sort()` in `processPendingEvents()`. Candidates within one event are processed sequentially.
- **No retry storms** — `lastRunAt` is set at the *start* of a run, not the end. A crash mid-run leaves the note marked as ran; the scheduler's next tick computes the next occurrence from that point.

---

## Schema Reference

All canonical schemas live in `packages/shared/src/live-note.ts`:

- `LiveNoteSchema` — the entire `live:` block. Fields: `objective`, `active` (default true), `triggers?`, `model?`, `provider?`. **Runtime-managed (never hand-write):** `lastAttemptAt`, `lastRunAt`, `lastRunId`, `lastRunSummary`, `lastRunError`.
- `TriggersSchema` — single object with three optional sub-fields: `cronExpr`, `windows`, `eventMatchCriteria`. Each window is `{ startTime, endTime }` (24-hour HH:MM, local).
- `KnowledgeEventSchema` — the on-disk shape of each event JSON in `events/pending/` and `events/done/`. Enrichment fields (`processedAt`, `candidateFilePaths`, `runIds`, `error`) are populated when moving to `done/`.
- `Pass1OutputSchema` — `{ filePaths: string[] }`.

The skill's Canonical Schema block is auto-generated at module load — `stringifyYaml(z.toJSONSchema(LiveNoteSchema))` — so editing `LiveNoteSchema` propagates to the skill on the next build.

---

## Body Structure

The agent owns the entire body below the H1. There is **no formal section ownership** anymore — the agent edits, reorganizes, and dedupes freely.

The contract (defined in the run-agent system prompt — `packages/core/src/knowledge/live-note/agent.ts`):

- **Defaults** (used when the objective doesn't specify a layout):
  - H1 stays the note title.
  - First, a 1-3 sentence rolling summary capturing the current state.
  - Then content organized by sub-topic under H2 headings, freshest/most-important first.
  - Tightness over decoration.
- **Override** — if the objective specifies a different layout (e.g. "show the top 5 stories at the top, with a one-paragraph summary above them"), follow that exactly.
- **Patch-style updates** — make small, incremental `file-editText` calls (read → edit one region → re-read → next), not one-shot whole-body rewrites. This preserves user-added content the agent didn't account for and keeps diffs reviewable.
- **Boundaries**: never modify the frontmatter; the agent is the sole writer of the body below the H1.

---

## Default Note Policy

Rowboat no longer creates a default `Today.md` live dashboard for new users. Live notes are user-created notes with an explicit `live:` frontmatter block.

**Deprecated Today.md migration** — `packages/core/src/knowledge/deprecate_today_note.ts` runs once per workspace on app start:

- File missing → mark processed and do nothing.
- File present → set `live.active: false` if a `live:` block exists, prepend a user-facing deprecation notice once, and preserve the note body.
- Future launches → no-op via `config/today-note-deprecation.json`, so a user who re-enables the note is not paused again.

---

## Renderer UI

- **Toolbar pill** — `apps/renderer/src/components/editor-toolbar.tsx`. A Radio-icon pill with a state-dependent label, top-right of the editor toolbar. `markdown-editor.tsx` derives the state via `useLiveNoteForPath(notePath)` and passes a `LivePillState` prop:
  - `passive` → muted "Make live" label.
  - `idle` → "Live · 5 m" using `formatRelativeTime(lastRunAt)`.
  - `running` → "Updating…" with `animate-pulse` and a soft `bg-primary/10` highlight.
  - `error` → "Live · failed 5 m" in amber, off `lastAttemptAt`.
  Click dispatches `rowboat:open-live-note-panel` with `{ filePath }`. The hook ticks once a minute so the relative-time label stays fresh while the user has the editor open.
- **Panel** — `apps/renderer/src/components/live-note-sidebar.tsx`. Right-anchored, mounted once in `App.tsx`. Self-listens for `rowboat:open-live-note-panel`; on open, calls `live-note:get` and renders. All mutations go through IPC.
  - Constant top header: Radio icon, "Live note" title, note name subtitle, X close.
  - Empty state (passive): "Make this note live" CTA — hands off to Copilot via `rowboat:open-copilot-edit-live-note`.
  - Editor (live): status row (schedule summary + active toggle — pulses with `animate-pulse` and `bg-primary/10` while running, label flips to "Updating…"), persistent error banner showing `lastRunError` until the next successful run, objective textarea, triggers editor (cron field + windows list + eventMatchCriteria textarea, each independently add/remove), last-run details, Advanced (collapsed; model + provider), footer (Edit with Copilot · Save · Run now / Stop), danger-zone "Make passive". The footer's primary action toggles between Run-now (idle) and Stop (running, destructive variant) — Stop calls `live-note:stop`.
- **Status hook** — `apps/renderer/src/hooks/use-live-note-agent-status.ts`. Subscribes to `live-note-agent:events` IPC and maintains a `Map<filePath, LiveNoteAgentState>`.
- **Live-state hook** — `apps/renderer/src/hooks/use-live-note-for-path.ts`. Fetches `live-note:get` on mount, refetches when the agent run completes (so `lastRunAt` / `lastRunSummary` / `lastRunError` are fresh), refetches when the file changes externally, and ticks once a minute for relative-time labels. Used by the markdown editor (toolbar pill) and could be reused by anyone needing reactive live-note state for a single path.
- **Edit-with-Copilot flow** — panel dispatches `rowboat:open-copilot-edit-live-note` (App.tsx listener handles it via `submitFromPalette`).
- **FrontmatterProperties safety** — `apps/renderer/src/lib/frontmatter.ts` has `STRUCTURED_KEYS = new Set(['live'])`. `extractAllFrontmatterValues` filters those keys out (so they never appear in the editable property list), and `buildFrontmatter(fields, preserveRaw)` splices the original `live:` block back from `preserveRaw` on save.

---

## Prompts Catalog

Every LLM-facing prompt in the feature, with file pointers. After any edit: `cd apps/x && npm run deps` to rebuild the affected package, then restart the app.

### 1. Routing system prompt (Pass 1 classifier)

- **Purpose**: decide which live notes *might* be relevant to an incoming event. Liberal — prefers false positives; the live-note agent does Pass 2.
- **File**: `packages/core/src/knowledge/live-note/routing.ts` (`ROUTING_SYSTEM_PROMPT`).
- **Output**: structured `Pass1OutputSchema` — `{ filePaths: string[] }`.
- **Invoked by**: `findCandidates()` per batch of 20 notes via `generateObject({ model, system, prompt, schema })`.

### 2. Routing user prompt template

- **Purpose**: formats the event and the current batch of live notes into the user message for Pass 1.
- **File**: `packages/core/src/knowledge/live-note/routing.ts` (`buildRoutingPrompt`).
- **Inputs**: `event` (source, type, createdAt, payload), `batch: ParsedLiveNote[]` (each: `filePath`, `objective`, `eventMatchCriteria`).
- **Output**: plain text, two sections — `## Event` and `## Live notes`.

### 3. Live-note agent instructions

- **Purpose**: system prompt for the background agent that rewrites note bodies. Sets tone, defines the default body structure, prescribes patch-style updates, points at the knowledge graph.
- **File**: `packages/core/src/knowledge/live-note/agent.ts` (`LIVE_NOTE_AGENT_INSTRUCTIONS`).
- **Inputs**: `${WorkDir}` template literal substituted at module load.
- **Output**: free-form — agent calls tools, ends with a 1-2 sentence summary used as `lastRunSummary`.
- **Invoked by**: `buildLiveNoteAgent()`, called during agent runtime setup. Tool set = all `BuiltinTools` except `executeCommand`.

### 4. Live-note agent message (`buildMessage`)

- **Purpose**: the user message seeded into each agent run.
- **File**: `packages/core/src/knowledge/live-note/runner.ts` (`buildMessage`).
- **Inputs**: `filePath` (presented as `knowledge/${filePath}` in the message), `live.objective`, `live.triggers?.eventMatchCriteria` (only on event runs), `trigger`, optional `context`, plus `localNow` / `tz`.
- **Behavior**: tells the agent to call `file-readText` itself (no body snapshot included, since the body can be long and may have been edited by a concurrent run) and to make patch-style edits.

Three branches by `trigger`:
- **`manual`** — base message. If `context` is passed, it's appended as a `**Context:**` section. The `run-live-note-agent` tool uses this path for both plain refreshes and context-biased backfills.
- **`timed`** — same as `manual`. Called by the scheduler with no `context`.
- **`event`** — adds a Pass 2 decision block listing the note's `eventMatchCriteria` and the event payload, with the directive to skip the edit if the event isn't truly relevant.

### 5. Live Note skill (Copilot-facing)

- **Purpose**: teaches Copilot the `live:` model — operational posture (act-first), the strong/medium/anti-signal taxonomy and how to act on each, the **always-extend-not-fork** rule for already-live notes, user-facing language (call them "live notes"; surface the **Live Note panel** by name), the auto-run-once-on-create/edit default, schema, triggers, YAML-safety rules, insertion workflow, and the `run-live-note-agent` tool with `context` backfills.
- **File**: `packages/core/src/application/assistant/skills/live-note/skill.ts`. Exported `skill` constant.
- **Schema interpolation**: at module load, `stringifyYaml(z.toJSONSchema(LiveNoteSchema))` is interpolated into the "Canonical Schema" section. Edits to `LiveNoteSchema` propagate automatically.
- **Output**: markdown, injected into the Copilot system prompt when `loadSkill('live-note')` fires.
- **Invoked by**: Copilot's `loadSkill` builtin tool. Registration in `skills/index.ts`.

### 6. Copilot trigger paragraph

- **Purpose**: tells Copilot *when* to load the `live-note` skill, and frames how aggressively to act once loaded.
- **File**: `packages/core/src/application/assistant/instructions.ts` (look for the "Live Notes" paragraph).
- **Strong signals (load + act without asking)**: cadence words ("every morning / daily / hourly…"), living-document verbs ("keep a running summary of…", "maintain a digest of…"), watch/monitor verbs, pin-live framings ("always show the latest X here"), direct ("track / follow X"), event-conditional ("whenever a relevant email comes in…").
- **Medium signals (load + answer the one-off + offer)**: time-decaying questions ("what's the weather?", "USD/INR right now?", "service X status?"), note-anchored snapshots ("show me my schedule here"), recurring artifacts ("morning briefing", "weekly review", "Acme dashboard"), topic-following / catch-up.
- **Anti-signals (do NOT make live)**: definitional questions, one-off lookups, manual document editing.
- **Extend-not-fork rule**: explicit guidance — "if the note is already live, extend its existing objective in natural language; never create a second objective."

### 7. `run-live-note-agent` tool — `context` parameter description

- **Purpose**: a mini-prompt (a Zod `.describe()`) that guides Copilot on when to pass extra context for a run.
- **File**: `packages/core/src/application/lib/builtin-tools.ts` (the `run-live-note-agent` tool definition).
- **Inputs**: `filePath` (workspace-relative; the tool strips the `knowledge/` prefix internally), optional `context`.
- **Output**: flows into `runLiveNoteAgent(..., 'manual')` → `buildMessage` → appended as `**Context:**` in the agent message.
- **Key use case**: backfill a newly-made-live note so its body isn't empty on day 1.

### 8. Calendar sync digest (event payload template)

- **Purpose**: shapes what the routing classifier sees for a calendar event. Not a system prompt, but a deterministic markdown template that becomes `event.payload`.
- **File**: `packages/core/src/knowledge/sync_calendar.ts` (`summarizeCalendarSync`, wrapped by `publishCalendarSyncEvent()`).
- **Output**: markdown with a counts header, `## Changed events` (per-event block: title, ID, time, organizer, location, attendees, truncated description), `## Deleted event IDs`. Capped at ~50 events; descriptions truncated to 500 chars.
- **Why care**: the quality of Pass 1 matching depends on how clear this payload is.

---

## Logging

All live-note logs use the `PrefixLogger` with the prefix `LiveNote:<Component>` so they're greppable as a group. Every component logs lifecycle events at one consistent level.

| Component | Prefix | What it logs |
|---|---|---|
| Scheduler | `LiveNote:Scheduler` | One tick summary per tick when work happened (`tick — scanned N md, K live, fired J, backoff M`). Per-note `<path> — firing (matched cron)` and `<path> — skip (matched window, backoff 4m remaining)`. Quiet when no live notes or none due. |
| Agent (runner) | `LiveNote:Agent` | `<path> — start trigger=cron runId=…`, `<path> — done action=replace summary="…"` (truncated to 120 chars), `<path> — failed: <msg>`, `<path> — skip: already running`. |
| Routing | `LiveNote:Routing` | `event:<id> — routing against N live notes`, `event:<id> — Pass1 → K candidates: a.md, b.md`, `event:<id> — Pass1 batch X failed: …`. |
| Events | `LiveNote:Events` | `event:<id> — received source=gmail type=email.synced`, `event:<id> — dispatching to K candidates: …`, `event:<id> — processed ok=2 errors=0`. |
| Fileops | (only logs failures) | Lock contention or write errors. Otherwise silent. |

Conventions:
- Lower-case verbs (`firing`, `skip`, `done`, `failed`) so lines scan visually.
- File path is always the second token where applicable.
- Run summaries truncated to 120 chars with a single `…` so log lines stay under terminal-width.
- Scheduler emits *one* tick summary per tick, not a row per note. Per-note rows only when something fires or hits a notable skip.

## File Map

| Purpose | File |
|---|---|
| Zod schemas (live note, triggers, events, Pass1) | `packages/shared/src/live-note.ts` |
| IPC channel schemas | `packages/shared/src/ipc.ts` |
| IPC handlers (main process) | `apps/main/src/ipc.ts` |
| Frontmatter helpers (parse / split / join) | `packages/core/src/application/lib/parse-frontmatter.ts` |
| File operations (`fetchLiveNote`, `setLiveNote`, `patchLiveNote`, `deleteLiveNote`, `setLiveNoteActive`, `readNoteBody`, `listLiveNotes`) | `packages/core/src/knowledge/live-note/fileops.ts` |
| Scheduler (cron / windows) | `packages/core/src/knowledge/live-note/scheduler.ts` |
| Trigger due-check helper (`computeNextDue` / `dueTimedTrigger`) | `packages/core/src/knowledge/live-note/schedule-utils.ts` |
| Event producer + consumer loop | `packages/core/src/knowledge/live-note/events.ts` |
| Pass 1 routing (LLM classifier) | `packages/core/src/knowledge/live-note/routing.ts` |
| Run orchestrator (`runLiveNoteAgent`, `buildMessage`) | `packages/core/src/knowledge/live-note/runner.ts` |
| Live-note agent definition (`LIVE_NOTE_AGENT_INSTRUCTIONS`, `buildLiveNoteAgent`) | `packages/core/src/knowledge/live-note/agent.ts` |
| Live-note bus (pub-sub for lifecycle events) | `packages/core/src/knowledge/live-note/bus.ts` |
| Deprecated Today.md one-time migration | `packages/core/src/knowledge/deprecate_today_note.ts` |
| Gmail event producer | `packages/core/src/knowledge/sync_gmail.ts` |
| Calendar event producer + digest | `packages/core/src/knowledge/sync_calendar.ts` |
| Copilot skill | `packages/core/src/application/assistant/skills/live-note/skill.ts` |
| Skill registration | `packages/core/src/application/assistant/skills/index.ts` |
| Copilot trigger paragraph | `packages/core/src/application/assistant/instructions.ts` |
| `run-live-note-agent` builtin tool | `packages/core/src/application/lib/builtin-tools.ts` |
| Editor toolbar (Radio button → panel) | `apps/renderer/src/components/editor-toolbar.tsx` |
| Live Note panel (single-view editor) | `apps/renderer/src/components/live-note-sidebar.tsx` |
| Status hook (`useLiveNoteAgentStatus`) | `apps/renderer/src/hooks/use-live-note-agent-status.ts` |
| Renderer frontmatter helper (preserves `live:`) | `apps/renderer/src/lib/frontmatter.ts` |
| App-level listeners (panel open + Copilot edit) | `apps/renderer/src/App.tsx` |
| Live Notes view (sidebar nav target) | `apps/renderer/src/components/live-notes-view.tsx` |
| CSS (panel styles, legacy filenames) | `apps/renderer/src/styles/live-note-panel.css`, `apps/renderer/src/styles/editor.css` |
| Main process startup (schedulers & processors) | `apps/main/src/main.ts` |
