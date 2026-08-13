# Session Layer Technical Specification

Status: implemented and live (`core/src/runtime/sessions/`), including the
post-v1 queued-messages + steering design of sections 12.1/12.4.

This document specifies the session layer that sits above the turn runtime
defined in `turn-runtime-design.md`. That document is assumed context; this
one does not restate turn semantics.

## 1. Goals

The session layer must:

1. Own conversations composed of ordered turns.
2. Persist each session as one append-only JSONL file with the same
   validation discipline as turn files.
3. Enforce one active turn per session.
4. Assemble each turn's context as a reference to the previous turn.
5. Maintain an in-memory index for listing, sorting, and filtering sessions,
   updated write-through and rebuilt by scanning at startup.
6. Route external inputs — permission decisions, ask-human answers, async
   tool results — to the correct turn through dedicated APIs.
7. Forward live turn events to the renderer over IPC.
8. Provide headless standalone turns outside any session.

## 2. Non-goals (v1)

- Queued user messages — SINCE IMPLEMENTED; the as-built design is in
  section 12.1 (which supersedes the originally committed durable shape).
- Steering / mid-turn message injection — SINCE IMPLEMENTED; see section
  12.4.
- Session-scoped permission grants ("always allow for this chat"); every
  applicable tool call prompts in v1 (section 12.2).
- Context compaction; a viable mechanism sketch is recorded in section 12.3.
  V1 behavior on context overflow is the turn-level model failure.
- LLM auto-titling (section 12.6).
- A persisted index cache; startup always scans (section 12.5).
- Cross-process coordination. A single main process is enforced.
- Data migration from the current runs system. Old conversations are not
  converted; the old code path remains readable until it is deleted.
- Session list pagination. The index is in-memory and shipped whole.

## 3. Terminology

A **session** is a durable, ordered chain of turns plus presentation
metadata (title). Conversation content lives exclusively in turn files; the
session file stores turn references with denormalized metadata.

The **index** is an in-memory projection over all session files, used for
the session list UI. It is never a source of truth.

A **standalone turn** is a turn with `sessionId: null`, created outside any
session by headless callers. Standalone turns do not appear in the index.

## 4. Storage design

### 4.1 File location

Session files live under:

```text
WorkDir/storage/sessions/YYYY/MM/DD/<sessionId>.jsonl
```

Session IDs come from the existing
`IMonotonicallyIncreasingIdGenerator`, and the repository derives the
date-partitioned path from the ID exactly as the turn repository does,
including format validation and path-traversal rejection.

### 4.2 File rules

Identical discipline to turn files:

- The first line is always `session_created` with `schemaVersion: 1`.
- Every event contains `sessionId` and an ISO timestamp `ts`.
- Physical line order is authoritative.
- Reads validate every line strictly; any malformed line makes the session
  corrupt; no truncation, repair, or skipping.
- Unknown schema versions and unknown event types fail loudly. Future
  additive event types (queueing, grants, compaction) arrive as a schema
  version bump; the reducer will accept old and new versions and write the
  newest.
- Appends are awaited but not explicitly `fsync`ed.

### 4.3 Repository contract

```ts
interface ISessionRepo {
  create(event: SessionCreated): Promise<void>;
  read(sessionId: string): Promise<SessionEvent[]>;
  append(sessionId: string, events: SessionEvent[]): Promise<void>;
  withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T>;
  listSessionIds(): Promise<string[]>;
  delete(sessionId: string): Promise<void>;
}
```

- `create` fails if the file exists.
- `listSessionIds` enumerates the partition directories for the startup
  scan.
- `delete` removes the session file only. Deleting the referenced turn
  files is the session layer's job (see section 9.4, deletion).
- `withLock` is in-process per-session exclusion, mirroring the turn repo.

## 5. Event schemas

All session event schemas live in `@x/shared` alongside the turn schemas.

```ts
interface BaseSessionEvent {
  sessionId: string;
  ts: string;
}

interface SessionCreated extends BaseSessionEvent {
  type: "session_created";
  schemaVersion: 1;
  title?: string;
}

interface SessionTurnAppended extends BaseSessionEvent {
  type: "turn_appended";
  turnId: string;
  sessionSeq: number; // 1-based position of the turn in the session
  agentId: string;
  model: ModelDescriptor; // resolved provider/model for the turn
}

interface SessionTitleChanged extends BaseSessionEvent {
  type: "title_changed";
  title: string;
}

type SessionEvent =
  | SessionCreated
  | SessionTurnAppended
  | SessionTitleChanged;
```

`turn_appended` deliberately denormalizes `agentId` and `model` from the
turn so the index can fold from session files without opening turn files.
The turn file remains authoritative for the turn's actual configuration.

The session file never mirrors turn outcomes. Turn lifecycle facts live only
in turn files; deriving "is this session busy/suspended/failed" reads the
latest turn (section 8).

## 6. Session reducer

`@x/shared` owns one pure reducer shared by core and renderer:

```ts
function reduceSession(events: SessionEvent[]): SessionState;

interface SessionState {
  definition: SessionCreated;
  title?: string;
  turns: Array<{
    turnId: string;
    sessionSeq: number;
    agentId: string;
    model: ModelDescriptor;
    ts: string;
  }>;
  latestTurnId?: string;
  createdAt: string; // definition.ts
  updatedAt: string; // ts of the last event
}
```

Invariants (violations throw, as with the turn reducer):

- `session_created` is present, first, and unique.
- All event `sessionId` values match.
- `sessionSeq` is strictly increasing starting at 1, with no gaps.
- `turnId` values are unique.
- Unsupported schema versions and unknown event types fail loudly.

## 7. Write ordering and consistency

Per user message, the session layer performs, in order:

1. `turnRuntime.createTurn(...)` — the turn file is created.
2. `sessionRepo.append(turn_appended)` — the session references the turn.
3. `advanceTurn(...)` — execution begins.

Rules:

- A crash between steps 1 and 2 leaves an orphan turn file: unreferenced,
  never advanced, and benign. Turns are only ever found by reference, so an
  orphan is invisible. V1 does not garbage-collect orphans.
- The reverse order is forbidden: a `turn_appended` referencing a turn file
  that was never created would be a dangling reference, which is corruption.
- Step 2 precedes step 3 so that a turn that is executing is always already
  referenced by its session.
- Session-file appends happen under the session lock; turn-file appends are
  the turn runtime's concern.

## 8. In-memory index

### 8.1 Shape

```ts
interface SessionIndexEntry {
  sessionId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  lastAgentId?: string;
  lastModel?: ModelDescriptor;
  latestTurnId?: string;
  latestTurnStatus:
    | "none" // session has no turns yet
    | "completed"
    | "failed"
    | "cancelled"
    | "suspended" // durable suspension: pending permissions/async tools
    | "idle"; // non-terminal, not suspended: interrupted by a crash
}
```

`latestTurnStatus` is derived from the latest turn's reduced state, using
the same derivation everywhere: terminal event kind if present, else
`suspended` if a suspension with outstanding work is the resting state, else
`idle`. Whether a turn is *actively processing right now* is not in the
index; it is ephemeral bus state (`turn-processing-start/end`), per the turn
specification.

### 8.2 Startup scan

1. `listSessionIds()`.
2. For each session: read and reduce the session file, producing the entry's
   session-derived fields.
3. For each session with turns: read and reduce the latest turn file only,
   producing `latestTurnStatus`.
4. Publish the completed index to the renderer.

A corrupt session file or corrupt latest-turn file does not abort startup:
the entry is surfaced in an errored state (identifiable in the UI, excluded
from normal interaction) and the scan continues.

### 8.3 Maintenance

- Every session mutation updates the entry in the same code path that
  appends to the session file (write-through), then publishes a
  `session-index-changed` event on the application bus.
- When an `advanceTurn` outcome settles, the session layer updates
  `latestTurnStatus` and publishes `session-index-changed`.
- There is no filesystem watcher. Out-of-band edits to session or turn files
  while the app runs are unsupported; offline changes are reconciled by the
  next startup scan.
- The main process enforces single-instance via
  `app.requestSingleInstanceLock()`; all locking in both layers is
  in-process.

## 9. Sessions API

```ts
interface SendMessageConfig {
  agent: RequestedAgent; // agent id + optional model override
  autoPermission?: boolean; // default false
  maxModelCalls?: number; // default per turn spec
}

interface ISessions {
  createSession(input?: { title?: string }): Promise<string>;
  listSessions(): SessionIndexEntry[];
  getSession(sessionId: string): Promise<SessionState>;
  getTurn(turnId: string): Promise<Turn>; // passthrough to turn runtime

  sendMessage(
    sessionId: string,
    input: UserMessage,
    config: SendMessageConfig,
  ): Promise<{ turnId: string }>;

  // Deliver-ASAP send + ephemeral pending-queue operations (section 12.1).
  sendOrQueueMessage(
    sessionId: string,
    input: UserMessage,
    config: SendMessageConfig,
  ): Promise<{ queued: false; turnId: string } | { queued: true; queueId: string }>;
  listQueued(sessionId: string): QueuedSessionMessage[];
  editQueued(sessionId: string, queueId: string, message: UserMessage): void;
  removeQueued(sessionId: string, queueId: string): QueuedSessionMessage | undefined;

  respondToPermission(
    turnId: string,
    toolCallId: string,
    decision: "allow" | "deny",
    metadata?: JsonValue,
  ): Promise<void>;

  respondToAskHuman(
    turnId: string,
    toolCallId: string,
    answer: string,
  ): Promise<void>;

  deliverAsyncToolResult(
    turnId: string,
    toolCallId: string,
    result: ToolResultData,
  ): Promise<void>;

  // Also drains the session's pending queue (a stop must never be followed
  // by a queued message auto-starting work) and returns the drained
  // messages so the UI can restore their text to the composer.
  stopTurn(turnId: string, reason?: string): Promise<{ dequeued: QueuedSessionMessage[] }>;
  resumeTurn(sessionId: string): Promise<void>;

  setTitle(sessionId: string, title: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
```

### 9.1 sendMessage

Under the per-session lock:

1. Read and reduce the session.
2. If the session has turns, read and reduce the latest turn. If it is
   non-terminal — running, suspended, or idle — reject with a typed
   `TurnNotSettledError`. There is no implicit queueing, steering, or
   cancel-and-replace, and no implicit routing to a pending ask-human.
3. Build context: `[]` (inline, empty) for the first turn, else
   `{ previousTurnId: latestTurnId }`.
4. Create the turn: config from `SendMessageConfig` lands on the turn
   (`humanAvailable: true` always, for session turns). Sessions store no
   configuration; every turn is self-describing.
5. Append `turn_appended` with the next `sessionSeq` and denormalized
   agent/model.
6. If the session has no title, append `title_changed` derived from the
   truncated first user message.
7. Start `advanceTurn` in the background; consume its events (section 10).
8. Return `{ turnId }` immediately. The renderer follows progress through
   events, not the return value.

Continuation after a failed or exhausted (`code: "model-call-limit"`) turn
is just `sendMessage`: failed turns are terminal, and the new turn's context
reference includes the failed turn's structurally complete transcript.

### 9.2 External inputs

`respondToPermission`, `respondToAskHuman`, and `deliverAsyncToolResult`
each translate to one `advanceTurn(turnId, input)` call with the
corresponding `TurnExternalInput`. `respondToAskHuman` is the dedicated
endpoint for the `ask-human` tool — a thin wrapper over
`async_tool_result` — and is deliberately separate from `sendMessage`.
Validation (unknown call, already-resolved call, terminal turn) is the turn
runtime's job; the session layer passes its errors through.

### 9.3 stopTurn and resumeTurn

- `stopTurn` cancels via the turn runtime: aborting the signal of every
  live advance the layer has started for the turn, else advancing the turn
  with a `cancel` input. A turn can legally have several live advances at
  once — one running invocation plus external-input invocations queued on
  the turn lock — so the layer tracks them per turn and stop aborts them
  all; the queued ones observe their aborted signal when the lock frees. A
  cancel input that loses the race with a concurrent settle (the turn is
  already terminal by the time it applies) counts as a successful stop.
- `resumeTurn` re-enters the latest turn with no input — the turn spec's
  recovery entry point — for turns left `idle` by a crash. There is no
  automatic resume sweep at startup: recovery re-issues interrupted model
  calls, so resumption must be an explicit user action. Suspended turns need
  no resumption; they advance when their inputs arrive.

### 9.4 Deletion

`deleteSession` aborts any live advances for the session (mirroring
`stopTurn`), then removes the session file, the index entry, and every turn
file the session references — following spawn-agent's durable `subagent`
tool_progress links so sub-agent child turn files are removed too — and
publishes `session-index-changed`. The session file goes first: turns are
only discoverable by reference, so a crash mid-cleanup leaves unreferenced
turn files behind — the same inert orphans the v1 design retained on every
delete. Turn-file removal is best-effort (`ITurnRepo.delete` is idempotent;
missing files are not errors) and never blocks the session delete itself.
Deleting an entity's file is not a violation of append-only discipline,
which governs mutation of live logs, not their removal.

## 10. Event forwarding and live UI

1. Live turn delivery is not the session layer's job: the turn runtime
   publishes every turn's events to the process-wide turn event bus
   (turn-runtime-design.md §17.1), which the app layer bridges to renderer
   windows over one IPC channel (`turns:events` — durable events broadcast
   with their file offsets; deltas only to windows subscribed to that turn).
   The session layer drains each `TurnExecution.events` it initiates so an
   unconsumed stream never buffers, and `sessions:events` carries only
   `session-index-changed` entries.
2. When `outcome` settles, the session layer updates the index entry and
   publishes `session-index-changed`.
3. The renderer follows the turn spec's historical/live pattern: fetch
   turns via `getTurn`, run the shared `reduceTurn` per turn, compose the
   session timeline turn-by-turn (each turn renders its input and its own
   activity; the referenced prefix is never re-rendered from context),
   join live durable events by file offset (drop covered, append
   contiguous, refetch on gap) and re-reduce, and keep text/reasoning
   deltas in an ephemeral overlay cleared by canonical responses.
4. Pending approvals and ask-human prompts render from the suspended turn's
   reduced state, so they survive restarts without any session-layer
   bookkeeping.

## 11. Headless standalone turns

A helper covers the non-session callers (background tasks, live notes,
knowledge pipelines, scheduled agents). Implemented as
`HeadlessAgentRunner` in `agents/headless.ts` (start/run handle with
turn id, reduced state, and final assistant text); the shape below is
the contract it fulfils:

```ts
function runHeadlessTurn(input: {
  agent: RequestedAgent;
  context?: ConversationMessage[]; // inline; defaults to []
  input: UserMessage;
  maxModelCalls?: number;
  signal?: AbortSignal;
}): Promise<TurnOutcome>;
```

- `sessionId: null`, `autoPermission: true`, `humanAvailable: false`.
- Creates the turn, advances to the first settled outcome, and returns it.
- Standalone turns never appear in the index; callers keep their own turn
  IDs if they need history.

## 12. Follow-on designs

12.1 and 12.4 are IMPLEMENTED (they shipped together as one deliver-ASAP
feature); the remaining subsections stay deferred with committed shapes.

### 12.1 Queued messages (implemented — ephemeral, superseding the committed durable shape)

This section originally committed durable session events
(`message_queued` / `queued_message_replaced` / `queued_message_removed`,
with `turn_appended.consumedQueueIds` for promotion). The implementation
deliberately supersedes that shape: **the pending queue is process memory
only** (`SessionsImpl.pending`), never written to the session file. A
message becomes durable exactly once, at delivery — as an `input_added`
turn event when it steers the live turn, or as `turn_created.input` when it
is promoted into a new turn.

Why ephemeral won:

- One durability point. The durable-queue design needed cross-file
  consistency between the session file (queue state) and the turn file
  (consumption), with `queueId` reconciliation to avoid double delivery
  after a crash. Ephemeral pending state deletes that seam entirely.
- Consistency with §4.2 of the turn spec: durable events record facts, not
  intent. A pending message is intent-not-yet-acted-on — kin to the
  composer draft, which is also not durable.
- Coherent crash loss. A crash kills the in-flight turn (it comes back
  `idle`, needing manual resume); losing the message that was steering it
  is the consistent outcome, and matches the no-auto-resume stance — a
  durable queue promoting at startup would start model calls unprompted.
- Precedent: pi's steering/follow-up queues are in-memory; opencode's
  shipping desktop queue is client-side state.

Accepted trade-off, recorded deliberately: a remote sender (channel
bridge) whose message is queued loses it silently if the app crashes;
the local user at least sees the chip vanish. The bridge still uses strict
`sendMessage` today, so nothing regresses until it opts in.

Behavior (one user-facing mode — deliver-ASAP; there is no queue-vs-steer
choice):

- `sendOrQueueMessage` starts a turn when the session is settled and the
  queue is empty; otherwise it appends `{queueId, message, config, ts}` to
  the pending queue (arrival order is preserved even against a
  settled-but-unpromoted queue).
- Pending entries steer the live turn at its next model-call boundary
  (section 12.4). Entries still pending when a turn settles are promoted:
  the head becomes a new turn via the normal locked send path, using the
  config it arrived with; the remainder stays queued and steers the new
  turn at its first boundary (call 0) — the earliest the model can see it.
- The enqueue and the settled-check share one session-lock hold, and
  promotion re-checks everything under the same lock, so a concurrent
  settle cannot strand a message (no lost wakeup).
- Promotion failure (e.g. agent resolution) leaves the entry queued,
  visible, and editable rather than silently dropping user text.
- `stopTurn` drains the queue first and returns the drained messages; a
  stop is never followed by queued work auto-starting.
- The renderer mirror rides a new `queue-changed` session-bus event kind
  carrying the full queue (`QueuedSessionMessage[]` in shared/sessions.ts);
  `listQueued` seeds it on session open. Edit/remove are plain methods.

### 12.2 Session permission grants

```ts
{ type: "permission_grant_added", grantId, toolId, ts }
{ type: "permission_grant_removed", grantId, ts }
```

The injected `IPermissionChecker` consults a session-keyed grants view
before answering `required: true`. V1 grants would be blanket per-toolId;
argument-pattern matchers are a separate, security-sensitive project.

### 12.3 Compaction (mechanism sketch)

Compaction requires zero turn-schema change. A session-level compaction
event records `{ compactionId, summary, firstKeptTurnId }`; the next turn
after a compaction uses **inline** context (summary message + kept
transcript), which restarts the reference chain and bounds resolution depth
by construction. Trigger policy and summarizer design are unspecified.

### 12.4 Steering (implemented)

A pending message reaches the RUNNING turn at its next model-call boundary.
Mechanism (see turn-runtime-design.md §8.6/§15.2 for the turn half):

- Every advance the session layer starts — sendMessage, promotion,
  permission/ask-human/async-result routing, resumeTurn — passes a
  `takeInputs` drain callback in `advanceTurn` options. The loop polls it
  once per iteration at the boundary (batch settled, completion ruled out,
  before the budget check and the next request) and appends the drained
  messages as durable `input_added` turn events, which the very next
  `model_call_requested` must reference (`input:<n>` refs).
- No `steer` external input was needed, contrary to this section's original
  sketch: a suspended turn's queue drains automatically when the advance
  that answers its permission/async result reaches the boundary.
- Injection is purely additive (never cancels in-flight work), the message
  lands as a plain user message after the batch's tool results, and each
  accepted input resets the turn's model-call budget (counts since last
  input) — fresh user input buys the allowance a fresh turn would get.
- If the final response is already streaming (no next model call), the turn
  completes normally and the message promotes as a new turn instead;
  delivery is "earliest safe point", never "guaranteed same turn".

Rejected alternative, recorded for the road not taken: **supersede-at-
boundary** (gracefully cancel the running turn at the batch boundary with
`reason: "steered"`, then promote the message as a new turn referencing
it). Zero turn-schema change and it collapses queueing/steering into one
promotion path, but it loses on behavior: (a) transmit-time elision
(context-elision.ts) would replace the just-executed batch's large tool
results with placeholders at the very next call — the model forgets what
it just read precisely when steered mid-task; (b) cross-turn provider
continuation stripping (shared/turns.ts) would drop reasoning
signatures/blobs of a cancelled turn, breaking interleaved-thinking
continuity on every steer; (c) it is destructive by construction to turns
suspended on permissions (cancelling their pending calls), violating the
additive-only property. Within-turn injection preserves all three by
construction.

### 12.5 Persisted index cache

If the startup scan ever gets slow, a single cache file keyed by file
mtimes can be added. It is a rebuildable cache, never a source of truth:
missing, stale, or invalid means rebuild from session files.

### 12.6 Auto-titling

An LLM-generated title replacing the truncated-first-message default,
appended as an ordinary `title_changed` event.

## 13. Required test scenarios

All tests use the in-memory/mocked turn runtime and repo fakes.

### 13.1 Reducer

- Valid event sequences reduce to expected state.
- Every invariant violation throws: missing/duplicate `session_created`,
  mismatched sessionId, non-monotonic or gapped `sessionSeq`, duplicate
  turnIds, unknown type/version.
- Title folding: default, explicit changes, last-wins.

### 13.2 Repository

- Date-partitioned paths, ID validation, create-if-absent.
- Strict line validation on read; corrupt files rejected whole.
- `listSessionIds` enumeration across partitions.
- Deletion removes only the session file.

### 13.3 sendMessage

- First turn: inline `[]` context, `sessionSeq: 1`, default title appended.
- Subsequent turns: context references the latest turn; seq increments.
- Rejection with `TurnNotSettledError` when the latest turn is running,
  suspended, or idle — and success after it settles.
- Continuation after failed and model-call-limit turns.
- Concurrent sendMessage calls serialize under the session lock; exactly
  one wins, the other rejects.
- Config lands on the turn; the session file stores only denormalized
  agent/model on `turn_appended`.

### 13.4 Ordering and crash simulation

- Simulated crash between `createTurn` and `turn_appended`: orphan turn
  file, session unchanged, retry produces a fresh turn.
- `turn_appended` is present before the first advance begins.

### 13.5 External inputs

- Permission decision, ask-human answer, and async result each advance the
  correct turn with the correct input type.
- Turn-runtime rejections (unknown call, terminal turn) pass through.
- `sendMessage` never routes to ask-human.
- `stopTurn` aborts every live advance when a turn has concurrent
  invocations, and an earlier advance settling does not untrack a later
  one.
- A `stopTurn` cancel input that lost the race with a concurrent settle
  resolves as a successful stop; a non-terminal rejection still surfaces.

### 13.6 Index

- Startup fold matches write-through state for the same history.
- Latest-turn status derivation for every status value.
- Corrupt session file yields an errored entry without aborting the scan.
- Mutations publish `session-index-changed`; deletion removes the entry.

### 13.7 Event forwarding

- Forwarded events are tagged with sessionId and arrive in order.
- Outcome settlement updates `latestTurnStatus`.

### 13.8 Headless

- Standalone turns: `sessionId: null`, auto permission, human unavailable,
  absent from the index.

### 13.9 Pending queue (12.1/12.4)

- `sendOrQueueMessage`: immediate start on a settled session; queue while
  the latest turn is non-terminal (queue-changed mirrored on the bus).
- Arrival order preserved when the session settled but promotion has not
  run yet.
- The steer drain hands every advance the pending queue and empties it.
- Promotion on settle: head becomes a new turn with its arrival config and
  a context reference to the settled turn; the rest stays queued.
- Edit/remove before delivery; unknown queueIds error/return undefined.
- `stopTurn` drains first, returns the drained messages, and no promotion
  fires afterward.
- Promotion failure keeps the entry queued.
- `deleteSession` drops the pending queue.

## 14. Suggested module layout

```text
apps/x/packages/shared/src/sessions.ts        # event schemas, reducer, index types

apps/x/packages/core/src/runtime/sessions/
  sessions.ts      # ISessions implementation
  api.ts           # public contract
  repo.ts          # ISessionRepo contract
  fs-repo.ts       # filesystem implementation
  session-index.ts # in-memory index
  bus.ts           # index-changed fan-out
```

The headless helper of §11 is implemented as `HeadlessAgentRunner` in
`runtime/assembly/headless.ts` (not under `sessions/`).


Awilix registration mirrors the turn runtime: singleton scope, PROXY
constructor injection, no container resolution from inside the classes.

## 15. Integration sequence

The rollout is staged as commits on one branch (squash-merge acceptable);
old and new stacks coexist briefly but never share state, and no data is
migrated:

1. `@x/shared`: turn + session schemas and reducers.
2. Turn runtime + fs turn repo (unit tests only, wired to nothing).
3. Session layer + index (unit tests only).
4. Bridges: agent resolver, context resolver, tool runner, permission
   checker/classifier — adapted from the `new-runtime` reference
   implementation where applicable.
5. IPC (`sessions:*`) + renderer swap: Copilot chat UI moves to the
   sessions API.
6. Headless callers move to `runHeadlessTurn`.
7. Delete the old runs runtime.

## 16. Implementation acceptance criteria

The session layer is implementation-complete only when:

1. Session event schemas and `reduceSession` live in `@x/shared` and are
   consumed unchanged by core and renderer.
2. Session files follow the partitioned append-only JSONL layout with
   strict validation.
3. Turn-file-first write ordering is enforced; orphan turns are benign.
4. `sendMessage` rejects non-terminal latest turns with a typed error and
   never routes to ask-human. Queueing and steering are explicit opt-in
   through `sendOrQueueMessage` only (section 12.1); programmatic callers
   keep the strict contract.
5. Ask-human answers flow only through the dedicated endpoint.
6. The index is write-through with a startup scan, no watcher, and no
   persisted cache; single-instance is enforced.
7. Deletion removes only the session file.
8. Headless callers run standalone turns and appear nowhere in the index.
9. All required test scenarios pass with mocked dependencies.
