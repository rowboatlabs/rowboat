# Track Blocks

> Living blocks of content embedded in markdown notes that auto-refresh on a schedule, when relevant events arrive, or on demand.

A track block is a small YAML code fence plus a sibling HTML-comment region in a note. The YAML defines what to produce and when; the comment region holds the generated output, rewritten on each run. A single note can hold many independent tracks — one for weather, one for an email digest, one for a running project summary.

**Example** (a Chicago-time track refreshed hourly):

~~~markdown
```track
trackId: chicago-time
instruction: Show the current time in Chicago, IL in 12-hour format.
active: true
schedule:
  type: cron
  expression: "0 * * * *"
```

<!--track-target:chicago-time-->
2:30 PM, Central Time
<!--/track-target:chicago-time-->
~~~

## Table of Contents

1. [Product Overview](#product-overview)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Technical Flows](#technical-flows)
4. [Schema Reference](#schema-reference)
5. [Prompts Catalog](#prompts-catalog)
6. [File Map](#file-map)
7. [Known Follow-ups](#known-follow-ups)

---

## Product Overview

### Trigger types

A track block has exactly one of four trigger configurations. Schedule and event triggers can co-exist on a single track.

| Trigger | When it fires | How to express it |
|---|---|---|
| **Manual** | Only when the user (or Copilot) hits Run | Omit `schedule`, leave `eventMatchCriteria` unset |
| **Scheduled — cron** | At exact cron times | `schedule: { type: cron, expression: "0 * * * *" }` |
| **Scheduled — window** | At most once per cron occurrence, only within a time-of-day window | `schedule: { type: window, cron, startTime: "09:00", endTime: "17:00" }` |
| **Scheduled — once** | Once at a future time, then never | `schedule: { type: once, runAt: "2026-04-14T09:00:00" }` |
| **Event-driven** | When a matching event arrives (e.g. new Gmail thread) | `eventMatchCriteria: "Emails about Q3 planning"` |

Decision shorthand: cron for exact times, window for "sometime in the morning", once for one-shots, event for signal-driven updates. Combine `schedule` + `eventMatchCriteria` for a track that refreshes on a cadence **and** reacts to incoming signals.

### Creating a track

Three paths, all produce identical on-disk YAML:

1. **Hand-written** — type the YAML fence directly in a note. The renderer picks it up instantly via the Tiptap `track-block` extension.
2. **Cmd+K with cursor context** — press Cmd+K anywhere in a note, say "add a track that shows Chicago weather hourly". Copilot loads the `tracks` skill and splices the block at the cursor using `workspace-edit`.
3. **Sidebar chat** — mention a note (or have it attached) and ask for a track. Copilot appends the block at the end or under the heading you name.

### Viewing and managing a track

The editor shows track blocks as an inline **chip** — a pill with the track ID, a clipped instruction, a color rail matching the trigger type, and a spinner while running.

Clicking the chip opens the **track modal**, where everything happens:

- **Header** — track ID, schedule summary (e.g. "Hourly"), and a Switch to pause/resume (flips `active`).
- **Tabs** — *What to track* (renders `instruction` as markdown), *When to run* (schedule details, shown if `schedule` is present), *Event matching* (shown if `eventMatchCriteria` is present), *Details* (ID, file, run metadata).
- **Advanced** — expandable raw-YAML editor for power users.
- **Danger zone** (Details tab) — delete with two-step confirmation; also removes the target region.
- **Footer** — *Edit with Copilot* (opens sidebar chat with the note attached) and *Run now* (triggers immediately).

Every mutation inside the modal goes through IPC to the backend — the renderer never writes the file itself. This is the fix that prevents the editor's save cycle from clobbering backend-written fields like `lastRunAt`.

### What Copilot can do

- **Create, edit, and delete** track blocks (via the `tracks` skill + `workspace-edit` / `workspace-readFile`).
- **Run** a track with the `run-track-block` builtin tool. An optional `context` parameter biases this single run — e.g. `"Backfill from gmail_sync/ for the last 90 days about this topic"`. Common use: seed a newly-created event-driven track so its target region isn't empty waiting for the next matching event.
- **Proactively suggest** tracks when the user signals interest ("track", "monitor", "watch", "every morning"), per the trigger paragraph in `instructions.ts`.
- **Re-enter edit mode** via the modal's *Edit with Copilot* button, which seeds a new chat with the note attached and invites Copilot to load the `tracks` skill.

### After a run

- The **target region** (between `<!--track-target:ID-->` markers) is rewritten by the track-run agent using the `update-track-content` tool.
- `lastRunAt`, `lastRunId`, `lastRunSummary` are updated in the YAML.
- The chip pulses while running, then displays the latest `lastRunAt`.
- Bus events (`track_run_start` / `track_run_complete`) are forwarded to the renderer via the `tracks:events` IPC channel, consumed by the `useTrackStatus` hook.

---

## Architecture at a Glance

```
Editor chip (display-only)  ──click──►  TrackModal (React)
                                               │
                                               ├──► IPC: track:get / update /
                                               │        replaceYaml / delete / run
                                               │
Backend (main process)
  ├─ Scheduler loop  (15 s) ──┐
  ├─ Event processor  (5 s) ──┼──►  triggerTrackUpdate()  ──►  track-run agent
  └─ Copilot tool  run-track-block ──┘                                │
                                                                      ▼
                                                        update-track-content tool
                                                                      │
                                                                      ▼
                                                       target region rewritten on disk
```

**Single-writer invariant:** the renderer is never a file writer. All on-disk changes go through backend helpers in `packages/core/src/knowledge/track/fileops.ts` (`updateTrackBlock`, `replaceTrackBlockYaml`, `deleteTrackBlock`). This avoids races with the scheduler/runner writing runtime fields.

**Event contract:** `window.dispatchEvent(CustomEvent('rowboat:open-track-modal', { detail }))` is the sole entry point from editor chip → modal. Similarly, `rowboat:open-copilot-edit-track` opens the sidebar chat with context.

---

## Technical Flows

### 4.1 Scheduling (cron / window / once)

- Module: `packages/core/src/knowledge/track/scheduler.ts`. Polls every **15 seconds** (`POLL_INTERVAL_MS`).
- Each tick: `workspace.readdir('knowledge', { recursive: true })`, filter `.md`, iterate all track blocks via `fetchAll(relPath)`.
- Per-track due check: `isTrackScheduleDue(schedule, lastRunAt)` in `schedule-utils.ts`. All three schedule types enforce a **2-minute grace window** — missed schedules (app offline at trigger time) are skipped, not replayed.
- When due, fires `triggerTrackUpdate(trackId, filePath, undefined, 'timed')` (fire-and-forget; the runner's concurrency guard prevents duplicates).
- Startup: `initTrackScheduler()` is called in `apps/main/src/main.ts` at app-ready, alongside `initTrackEventProcessor()`.

### 4.2 Event pipeline

**Producers** — any data source that should feed tracks emits events:

- **Gmail** (`packages/core/src/knowledge/sync_gmail.ts`) — three call sites, each after a successful thread sync, call `createEvent({ source: 'gmail', type: 'email.synced', payload: <thread markdown> })`.
- **Calendar** (`packages/core/src/knowledge/sync_calendar.ts`) — one bundled event per sync. The payload is a markdown digest of all new/updated/deleted events built by `summarizeCalendarSync()` (line 68). `publishCalendarSyncEvent()` (line ~126) wraps it with `source: 'calendar'`, `type: 'calendar.synced'`.

**Storage** — `packages/core/src/knowledge/track/events.ts` writes each event as a JSON file under `~/.rowboat/events/pending/<id>.json`. IDs come from the DI-resolved `IdGen` (ISO-based, lexicographically sortable) — so `readdirSync(...).sort()` is strict FIFO.

**Consumer loop** — same file, `init()` polls every **5 seconds**, then `processPendingEvents()` walks sorted filenames. For each event:

1. Parse via `KnowledgeEventSchema`; malformed files go to `done/` with `error` set (the loop stays alive).
2. `listAllTracks()` scans every `.md` under `knowledge/` and collects `ParsedTrack[]`.
3. `findCandidates(event, allTracks)` in `routing.ts` runs Pass 1 LLM routing (below).
4. For each candidate, `triggerTrackUpdate(trackId, filePath, event.payload, 'event')` **sequentially** — preserves total ordering within the event.
5. Enrich the event JSON with `processedAt`, `candidates`, `runIds`, `error?`, then `moveEventToDone()` — write to `events/done/<id>.json`, unlink from `pending/`.

**Pass 1 routing** (`routing.ts:73+ findCandidates`):

- **Short-circuit**: if `event.targetTrackId` + `targetFilePath` are set (manual re-run events), skip the LLM and return that track directly.
- Filter to `active && instruction && eventMatchCriteria` tracks.
- Batches of `BATCH_SIZE = 20`.
- Per batch, `generateObject()` with `ROUTING_SYSTEM_PROMPT` + `buildRoutingPrompt()` and `Pass1OutputSchema` → `candidates: { trackId, filePath }[]`. The composite key `trackId::filePath` deduplicates across files since `trackId` is only unique per file.
- Model resolution: gateway if signed in, local provider otherwise; prefers `knowledgeGraphModel` from config.

**Pass 2 decision** happens inside the track-run agent (see Run flow below) — the liberal Pass 1 produces candidates, the agent vetoes false positives before touching the target region.

### 4.3 Run flow (`triggerTrackUpdate`)

Module: `packages/core/src/knowledge/track/runner.ts`.

1. **Concurrency guard** — static `runningTracks: Set<string>` keyed by `${trackId}:${filePath}`. Duplicate calls return `{ action: 'no_update', error: 'Already running' }`.
2. **Fetch block** via `fetchAll(filePath)`, locate by `trackId`.
3. **Create agent run** — `createRun({ agentId: 'track-run' })`.
4. **Set `lastRunAt` + `lastRunId` immediately** (before the agent executes). Prevents retry storms: if the run fails, the scheduler's next tick won't re-trigger, and for `once` tracks the "done" flag is already set.
5. **Emit `track_run_start`** on the `trackBus` with the trigger type (`manual` / `timed` / `event`).
6. **Send agent message** built by `buildMessage(filePath, track, trigger, context?)` — three branches (see Prompts Catalog). For `'event'` trigger, the message includes the event payload and a Pass 2 decision directive.
7. **Wait for completion** — `waitForRunCompletion(runId)`, then `extractAgentResponse(runId)` for the summary.
8. **Compare content**: re-read the file, diff `contentBefore` vs `contentAfter`. If changed → `action: 'replace'`; else → `action: 'no_update'`.
9. **Store `lastRunSummary`** via `updateTrackBlock`.
10. **Emit `track_run_complete`** with `summary` or `error`.
11. **Cleanup**: `runningTracks.delete(key)` in a `finally` block.

Returned to callers: `{ trackId, runId, action, contentBefore, contentAfter, summary, error? }`.

### 4.4 IPC surface

| Channel | Caller → handler | Purpose |
|---|---|---|
| `track:run` | Renderer (chip/modal Run button) | Fires `triggerTrackUpdate(..., 'manual')` |
| `track:get` | Modal on open | Returns fresh YAML from disk via `fetchYaml` |
| `track:update` | Modal toggle / partial edits | `updateTrackBlock` merges a partial into on-disk YAML |
| `track:replaceYaml` | Advanced raw-YAML save | `replaceTrackBlockYaml` validates + writes full YAML |
| `track:delete` | Danger-zone confirm | `deleteTrackBlock` removes YAML fence + target region |
| `tracks:events` | Server → renderer (`webContents.send`) | Forwards `trackBus` events to the `useTrackStatus` hook |

Request/response schemas live in `packages/shared/src/ipc.ts`; handlers in `apps/main/src/ipc.ts`; backend helpers in `packages/core/src/knowledge/track/fileops.ts`.

### 4.5 Renderer integration

- **Chip** — `apps/renderer/src/extensions/track-block.tsx`. Tiptap atom node. Render-only: click dispatches `CustomEvent('rowboat:open-track-modal', { detail: { trackId, filePath, initialYaml, onDeleted } })`. The `onDeleted` callback is the Tiptap `deleteNode` — the modal calls it after a successful `track:delete` IPC so the editor also drops the node and doesn't resurrect it on next save.
- **Modal** — `apps/renderer/src/components/track-modal.tsx`. Mounted once in `App.tsx`, self-listens for the open event. On open: calls `track:get` to get the authoritative YAML, not the Tiptap cached attr. All mutations go through IPC; `updateAttributes` is never called.
- **Status hook** — `apps/renderer/src/hooks/use-track-status.ts`. Subscribes to `tracks:events` and maintains a `Map<"${trackId}:${filePath}", RunState>` so chips and the modal reflect live run state.
- **Edit with Copilot** — the modal's footer button dispatches `rowboat:open-copilot-edit-track`. An `useEffect` listener in `App.tsx` opens the chat sidebar via `submitFromPalette(text, mention)`, where `text` is a short opener that invites Copilot to load the `tracks` skill and `mention` attaches the note file.

### 4.6 Copilot skill integration

- **Skill content** — `packages/core/src/application/assistant/skills/tracks/skill.ts` (~318 lines). Exported as a `String.raw` template literal; injected into the Copilot system prompt when the `loadSkill('tracks')` tool is called.
- **Canonical schema** inside the skill is **auto-generated at module load**: `stringifyYaml(z.toJSONSchema(TrackBlockSchema))`. Editing `TrackBlockSchema` in `packages/shared/src/track-block.ts` propagates to the skill without manual sync.
- **Skill registration** — `packages/core/src/application/assistant/skills/index.ts` (import + entry in the `definitions` array).
- **Loading trigger** — `packages/core/src/application/assistant/instructions.ts:73` — one paragraph tells Copilot to load the skill on track / monitor / watch / "keep an eye on" / Cmd+K auto-refresh requests.
- **Builtin tools** — `packages/core/src/application/lib/builtin-tools.ts`:
  - `update-track-content` — low-level: rewrite the target region between `<!--track-target:ID-->` markers. Used mainly by the track-run agent.
  - `run-track-block` — high-level: trigger a run with an optional `context`. Uses `await import("../../knowledge/track/runner.js")` inside the execute body to break a module-init cycle (`builtin-tools → track/runner → runs/runs → agents/runtime → builtin-tools`).

### 4.7 Concurrency & FIFO guarantees

- **Per-track serialization** — the `runningTracks` guard in `runner.ts`. A track is at most running once; overlapping triggers (manual + scheduled + event) return `error: 'Already running'` cleanly through IPC.
- **Backend is single writer** — renderer uses IPC for every edit; backend helpers in `fileops.ts` are the only code paths that touch the file.
- **Event FIFO** — monotonic `IdGen` IDs → lexicographic filenames → `sort()` in `processPendingEvents()` = strict FIFO across events. Candidates within one event are processed sequentially (`await` in loop) so ordering holds within an event too.
- **No retry storms** — `lastRunAt` is set at the *start* of a run, not the end. A crash mid-run leaves the track marked as ran; the scheduler's next tick computes the next occurrence from that point.

---

## Schema Reference

All canonical schemas live in `packages/shared/src/track-block.ts`:

- `TrackBlockSchema` — the YAML that goes inside a ` ```track ` fence. User-authored fields: `trackId` (kebab-case, unique within the file), `instruction`, `active`, `schedule?`, `eventMatchCriteria?`. **Runtime-managed fields (never hand-write):** `lastRunAt`, `lastRunId`, `lastRunSummary`.
- `TrackScheduleSchema` — discriminated union over `{ type: 'cron' | 'window' | 'once' }`.
- `KnowledgeEventSchema` — the on-disk shape of each event JSON in `events/pending/` and `events/done/`. Enrichment fields (`processedAt`, `candidates`, `runIds`, `error`) are populated when moving to `done/`.
- `Pass1OutputSchema` — the structured response the routing classifier returns: `{ candidates: { trackId, filePath }[] }`.

Since the skill's schema block is generated from `TrackBlockSchema`, schema changes should start here — the skill, the validator in `replaceTrackBlockYaml`, and modal display logic all follow from the Zod source of truth.

---

## Prompts Catalog

Every LLM-facing prompt in the feature, with file + line pointers so you can edit in place. After any edit: `cd apps/x && npm run deps` to rebuild the affected package, then restart the app (`npm run dev`).

### 1. Routing system prompt (Pass 1 classifier)

- **Purpose**: decide which tracks *might* be relevant to an incoming event. Liberal — prefers false positives; Pass 2 inside the agent catches them.
- **File**: `packages/core/src/knowledge/track/routing.ts:22–37` (`ROUTING_SYSTEM_PROMPT`).
- **Inputs**: none interpolated — constant system prompt.
- **Output**: structured `Pass1OutputSchema` — `{ candidates: { trackId, filePath }[] }`.
- **Invoked by**: `findCandidates()` at `routing.ts:73+`, per batch of 20 tracks, via `generateObject({ model, system, prompt, schema })`.

### 2. Routing user prompt template

- **Purpose**: formats the event and the current batch of tracks into the user message fed alongside the system prompt.
- **File**: `packages/core/src/knowledge/track/routing.ts:51–66` (`buildRoutingPrompt`).
- **Inputs**: `event` (source, type, createdAt, payload), `batch: ParsedTrack[]` (each: `trackId`, `filePath`, `eventMatchCriteria`).
- **Output**: plain text, two sections — `## Event` and `## Track Blocks`.
- **Note**: the event `payload` is what the producer wrote. For Gmail it's a thread markdown dump; for Calendar it's a digest (see #7 below).

### 3. Track-run agent instructions

- **Purpose**: system prompt for the background agent that actually rewrites target regions. Sets tone ("no user present — don't ask questions"), points at the knowledge graph, and prescribes the `update-track-content` tool as the write path.
- **File**: `packages/core/src/knowledge/track/run-agent.ts:6–50` (`TRACK_RUN_INSTRUCTIONS`).
- **Inputs**: `${WorkDir}` template literal (substituted at module load).
- **Output**: free-form — agent calls tools, ends with a 1-2 sentence summary used as `lastRunSummary`.
- **Invoked by**: `buildTrackRunAgent()` at line 52, called during agent runtime setup. Tool set = all `BuiltinTools` except `executeCommand`.

### 4. Track-run agent message (`buildMessage`)

- **Purpose**: the user message seeded into each track-run. Three shape variants based on `trigger`.
- **File**: `packages/core/src/knowledge/track/runner.ts:23–62`.
- **Inputs**: `filePath`, `track.trackId`, `track.instruction`, `track.content`, `track.eventMatchCriteria`, `trigger`, optional `context`, plus `localNow` / `tz`.
- **Output**: free-form — the agent decides whether to call `update-track-content`.

Three branches:

- **`manual`** — base message (instruction + current content + tool hint). If `context` is passed, it's appended as a `**Context:**` section. The `run-track-block` tool uses this path for both plain refreshes and context-biased backfills.
- **`timed`** — same as `manual`. Called by the scheduler with no `context`.
- **`event`** — adds a **Pass 2 decision block** (lines 45–56). Quoted verbatim:

  > **Trigger:** Event match (a Pass 1 routing classifier flagged this track as potentially relevant to the event below)
  >
  > **Event match criteria for this track:** …
  >
  > **Event payload:** …
  >
  > **Decision:** Determine whether this event genuinely warrants updating the track content. If the event is not meaningfully relevant on closer inspection, skip the update — do NOT call `update-track-content`. Only call the tool if the event provides new or changed information that should be reflected in the track.

### 5. Tracks skill (Copilot-facing)

- **Purpose**: teaches Copilot everything about track blocks — anatomy, schema, schedules, event matching, insertion workflow, when to proactively suggest, when to run with context.
- **File**: `packages/core/src/application/assistant/skills/tracks/skill.ts` (~318 lines). Exported `skill` constant.
- **Inputs**: at module load, `stringifyYaml(z.toJSONSchema(TrackBlockSchema))` is interpolated into the "Canonical Schema" section. Rebuilds propagate schema edits automatically.
- **Output**: markdown, injected into the Copilot system prompt when `loadSkill('tracks')` fires.
- **Invoked by**: Copilot's `loadSkill` builtin tool (see `packages/core/src/application/lib/builtin-tools.ts`). Registration in `skills/index.ts`.
- **Edit guidance**: for schema-shaped changes, start at `packages/shared/src/track-block.ts` — the skill picks it up on the next build. For prose/workflow tweaks, edit the `String.raw` template.

### 6. Copilot trigger paragraph

- **Purpose**: tells Copilot *when* to load the `tracks` skill.
- **File**: `packages/core/src/application/assistant/instructions.ts:73`.
- **Inputs**: none; static prose.
- **Output**: part of the baseline Copilot system prompt.
- **Trigger words**: *track*, *monitor*, *watch*, *keep an eye on*, "*every morning tell me X*", "*show the current Y in this note*", "*pin live updates of Z here*", plus any Cmd+K request that implies auto-refresh.

### 7. `run-track-block` tool — `context` parameter description

- **Purpose**: a mini-prompt (a Zod `.describe()`) that guides Copilot on when to pass extra context for a run. Copilot sees this text as part of the tool's schema.
- **File**: `packages/core/src/application/lib/builtin-tools.ts:1454+` (the `run-track-block` tool definition; the `context` field's `.describe()` block is the mini-prompt).
- **Inputs**: free-form string from Copilot.
- **Output**: flows into `triggerTrackUpdate(..., 'manual')` → `buildMessage` → appended as `**Context:**` in the agent message.
- **Key use case**: backfill a newly-created event-driven track so its target region isn't empty on day 1 — e.g. `"Backfill from gmail_sync/ for the last 90 days about this topic"`.

### 8. Calendar sync digest (event payload template)

- **Purpose**: shapes what the routing classifier sees for a calendar event. Not a system prompt, but a deterministic markdown template that becomes `event.payload`.
- **File**: `packages/core/src/knowledge/sync_calendar.ts:68+` (`summarizeCalendarSync`). Wrapped by `publishCalendarSyncEvent()` at line ~126.
- **Inputs**: `newEvents`, `updatedEvents`, `deletedEventIds` gathered during a sync.
- **Output**: markdown with counts header, a `## Changed events` section (per-event block: title, ID, time, organizer, location, attendees, truncated description), and a `## Deleted event IDs` section. Capped at ~50 events with a "…and N more" line; descriptions truncated to 500 chars.
- **Why care**: the quality of Pass 1 matching depends on how clear this payload is. If the classifier misses obvious matches, this is a place to look.

---

## File Map

| Purpose | File |
|---|---|
| Zod schemas (tracks, schedules, events, Pass1) | `packages/shared/src/track-block.ts` |
| IPC channel schemas | `packages/shared/src/ipc.ts` |
| IPC handlers (main process) | `apps/main/src/ipc.ts` |
| File operations (fetch / update / replace / delete) | `packages/core/src/knowledge/track/fileops.ts` |
| Scheduler (cron / window / once) | `packages/core/src/knowledge/track/scheduler.ts` |
| Schedule due-check helper | `packages/core/src/knowledge/track/schedule-utils.ts` |
| Event producer + consumer loop | `packages/core/src/knowledge/track/events.ts` |
| Pass 1 routing (LLM classifier) | `packages/core/src/knowledge/track/routing.ts` |
| Run orchestrator (`triggerTrackUpdate`, `buildMessage`) | `packages/core/src/knowledge/track/runner.ts` |
| Track-run agent definition | `packages/core/src/knowledge/track/run-agent.ts` |
| Track bus (pub-sub for lifecycle events) | `packages/core/src/knowledge/track/bus.ts` |
| Track state type | `packages/core/src/knowledge/track/types.ts` |
| Gmail event producer | `packages/core/src/knowledge/sync_gmail.ts` |
| Calendar event producer + digest | `packages/core/src/knowledge/sync_calendar.ts` |
| Copilot skill | `packages/core/src/application/assistant/skills/tracks/skill.ts` |
| Skill registration | `packages/core/src/application/assistant/skills/index.ts` |
| Copilot trigger paragraph | `packages/core/src/application/assistant/instructions.ts` |
| Builtin tools (`update-track-content`, `run-track-block`) | `packages/core/src/application/lib/builtin-tools.ts` |
| Tiptap chip (editor node view) | `apps/renderer/src/extensions/track-block.tsx` |
| React modal (all UI mutations) | `apps/renderer/src/components/track-modal.tsx` |
| Status hook (`useTrackStatus`) | `apps/renderer/src/hooks/use-track-status.ts` |
| App-level listeners (modal + Copilot edit) | `apps/renderer/src/App.tsx` |
| CSS | `apps/renderer/src/styles/editor.css`, `apps/renderer/src/styles/track-modal.css` |
| Main process startup (schedulers & processors) | `apps/main/src/main.ts` |

---

## Known Follow-ups

- **Tiptap save can still re-serialize a stale node attr.** The chip+modal refactor makes every *intentional* mutation go through IPC, so toggles, raw-YAML edits, and deletes are all safe. But if the backend writes runtime fields (`lastRunAt`, `lastRunSummary`) after the note was loaded, and the user then types anywhere in the note body, Tiptap's markdown serializer writes out the cached (stale) YAML for each track block, clobbering those fields.
  - **Cleanest fix**: subscribe to `trackBus` events in the renderer and refresh the corresponding node attr via `updateAttributes` before Tiptap can save.
  - **Alternative**: make the markdown serializer pull fresh YAML from disk per track block at write time (async-friendly refactor).

- **Only Gmail + Calendar produce events today.** Granola, Fireflies, and other sync services are plumbed for the pattern but don't emit yet. Adding a producer is a one-liner `createEvent({ source, type, createdAt, payload })` at the right spot in the sync flow.
