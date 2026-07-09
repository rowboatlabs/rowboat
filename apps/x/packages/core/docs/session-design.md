# Session Layer Technical Specification

Status: design complete for the session layer v1. No implementation exists
yet.

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

- Queued user messages. The committed future shape is in section 12.1.
- Steering / mid-turn message injection (section 12.4).
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
- `delete` removes the session file only. Turn files referenced by the
  session are left in place as harmless orphans (see section 9, deletion).
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

  stopTurn(turnId: string, reason?: string): Promise<void>;
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

- `stopTurn` cancels via the turn runtime: aborting the active invocation's
  signal if one is running, else advancing a suspended turn with a `cancel`
  input.
- `resumeTurn` re-enters the latest turn with no input — the turn spec's
  recovery entry point — for turns left `idle` by a crash. There is no
  automatic resume sweep at startup: recovery re-issues interrupted model
  calls, so resumption must be an explicit user action. Suspended turns need
  no resumption; they advance when their inputs arrive.

### 9.4 Deletion

`deleteSession` removes the session file and the index entry, and publishes
`session-index-changed`. Referenced turn files are retained as orphans:
turns are only discoverable by reference, so orphaned files are inert.
Deleting an entity's file is not a violation of append-only discipline,
which governs mutation of live logs, not their removal.

## 10. Event forwarding and live UI

1. For every `advanceTurn` it initiates, the session layer consumes
   `TurnExecution.events` and forwards each `TurnStreamEvent` — tagged with
   `sessionId` — through the application bus to renderer windows over one
   IPC channel (`sessions:events`).
2. When `outcome` settles, the session layer updates the index entry and
   publishes `session-index-changed`.
3. The renderer follows the turn spec's historical/live pattern: fetch
   turns via `getTurn`, run the shared `reduceTurn` per turn, compose the
   session timeline turn-by-turn (each turn renders its input and its own
   activity; the referenced prefix is never re-rendered from context),
   append live durable events and re-reduce, and keep text/reasoning deltas
   in an ephemeral overlay cleared by canonical responses.
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

## 12. Deferred designs with committed shapes

These are not implemented in v1. Their shapes are recorded so v1 decisions
stay compatible; each arrives as a session schema version bump.

### 12.1 Queued messages

```ts
{ type: "message_queued", queueId, message, ts }
{ type: "queued_message_replaced", queueId, message, ts } // edit
{ type: "queued_message_removed", queueId, ts }           // cancel
// promotion: turn_appended gains consumedQueueIds?: string[]
```

The reducer derives the pending queue by supersession. Promotion rules
(collapse-into-one-turn vs FIFO, behavior after failed turns) are decided
together with steering.

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

### 12.4 Steering

Rides the queue events with a different promotion rule, and additionally
requires a turn-level `steer` external input (a turn schema bump) with an
injection boundary after tool-batch completion. Recorded here so the session
design does not foreclose it.

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

## 14. Suggested module layout

```text
apps/x/packages/shared/src/sessions.ts   # event schemas, reducer, index types

apps/x/packages/core/src/sessions/
  sessions.ts      # ISessions implementation
  repo.ts          # ISessionRepo contract
  fs-repo.ts       # filesystem implementation
  index.ts         # in-memory index + startup scan
  headless.ts      # runHeadlessTurn
```

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
4. `sendMessage` rejects non-terminal latest turns with a typed error; no
   implicit queueing, steering, or ask-human routing exists.
5. Ask-human answers flow only through the dedicated endpoint.
6. The index is write-through with a startup scan, no watcher, and no
   persisted cache; single-instance is enforced.
7. Deletion removes only the session file.
8. Headless callers run standalone turns and appear nowhere in the index.
9. All required test scenarios pass with mocked dependencies.
