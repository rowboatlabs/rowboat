# Turn Runtime Technical Specification

Status: implemented and live. All chat, background, and knowledge callers
run on this runtime; the legacy runs runtime remains only for code-mode
sessions (see the carve-out section in the repo-root `AGENTS.md`). The
companion session layer is specified in `session-design.md`.

This document specifies a new turn-oriented agent loop for `@x/core`. It is
intended to replace the behavioral responsibilities of the current run runtime
eventually, but migration and replacement are explicitly outside the initial
implementation scope.

The design was developed independently of sessions. Session storage,
conversation ordering, queued user messages, context compaction, and selection
of the next active turn will be designed separately.

## 1. Goals

The turn runtime must:

1. Execute one complete agent turn from one user input.
2. Repeatedly call a model and process tool calls until the model produces a
   final response, the turn suspends, or the turn reaches a terminal outcome.
3. Persist every durable fact to one append-only JSONL file per turn.
4. Support turns that do not belong to a session.
5. Support suspension for human permission decisions and externally executed
   asynchronous tools.
6. Recover deterministically from the durable log after a process restart.
7. Keep all runtime dependencies explicit and injectable.
8. Keep the core loop small and focused on flow control.
9. Expose normalized live events without coupling turn correctness to event
   consumption.
10. Make historical turns reconstructable for the UI and other consumers.

## 2. Non-goals

The first implementation will not include:

- Session storage or session scheduling.
- Queued user messages.
- Enforcement of the session-level one-active-turn rule.
- Context pruning or compaction.
- Agent-as-tool behavior. An agent tool handler may implement this separately,
  but the parent turn sees it only as a normal sync or async tool.
- Inline, caller-supplied agents.
- Mid-turn agent, model, prompt, or tool-set switching.
- Tool argument validation beyond what the model/tool integration already
  provides.
- External-input idempotency keys or duplicate-delivery handling.
- Automatic model-call retries.
- Cross-process locking.
- Explicit `fsync` after every append.
- Automatic repair of corrupt JSONL files.
- Stream backpressure or bounded event buffering.
- A shared UI timeline selector.
- Migration from the current run system.

## 3. Core terminology

### 3.1 Turn

A turn starts with one intentional user message and contains all agent work
caused by that message:

- Model requests and responses.
- Permission checks and decisions.
- Sync tool executions.
- Async tool requests, progress, and results.
- Repeated model calls after tool results.
- Final completion, failure, cancellation, or suspension.

Permission decisions and async tool results do not create new turns. They
advance the existing turn.

### 3.2 Session

A session is an optional higher-level conversation and scheduling concept. A
turn has `sessionId: string | null`, but turn execution never reads session
state.

The session layer will eventually own:

- Turn ordering.
- One-active-turn enforcement.
- Queued user messages.
- Context construction from prior turns.
- Context pruning and compaction.
- Session-wide permission grants.

### 3.3 Agent

An agent is a reusable execution preset consisting primarily of:

- A system prompt.
- A model/provider selection.
- A set of tools.

The current codebase follows this model across Copilot, background-task,
live-note, knowledge-sync, and user-defined agents.

An agent is resolved once when a turn is created. The resulting execution
snapshot is immutable for the lifetime of the turn.

## 4. Architectural principles

### 4.1 The JSONL log is the source of truth

There is one JSONL file per turn. Every line contains one validated JSON event.
State is always reconstructed by replaying the file from the beginning.

There are no mutable summary files, checkpoints, or storage sidecars.

### 4.2 Events describe facts, not current process liveness

The durable log must never claim that a turn is currently running. A process
can crash at any time and make such a claim false.

Durable events may state that:

- A model request was prepared and requested.
- A tool invocation was requested.
- A result was received.
- A turn suspended.
- A turn completed, failed, or was cancelled.

Whether an `advanceTurn` invocation is currently active is ephemeral
application state communicated through the application bus.

### 4.3 The turn runtime has no hidden dependencies

`TurnRuntime` is a class used as an immutable dependency container. It holds no
mutable per-turn execution state. All active turn state is reconstructed from
the repository inside each invocation.

Awilix constructs the singleton using PROXY/destructured-object injection.
`TurnRuntime` must never resolve dependencies from the Awilix container itself.

### 4.4 Durable barriers precede side effects

When a durable event represents intent to perform an external side effect, the
event is successfully appended before the side effect begins.

Examples:

- Append `model_call_requested` before calling the model.
- Append `tool_invocation_requested` before invoking a sync tool or exposing an
  async tool request.

This does not provide exactly-once execution. It provides conservative recovery
semantics after ambiguous interruptions.

### 4.5 Execution order and model-facing order are separate

Tool calls may complete in any order. The next model request must always contain
tool results in the original order emitted by the model.

Sync tools in one batch execute concurrently: invocation events are appended
serially in source order before any execution starts, then all sync executions
run at once, each appending its progress and result as it lands. Result order
in the log is therefore physical completion order and is not deterministic
across runs; any given log still replays deterministically. Async tools
naturally complete independently. No behavior may rely on physical completion
order.

Durable appends are serialized through a single internal queue per invocation:
the persist → reduce → stream ritual runs to completion for one batch of
events before the next begins, so file order, in-memory order, and stream
order are identical by construction even while executions overlap.

## 5. Storage design

### 5.1 File location

Turn files live under:

```text
WorkDir/storage/turns/YYYY/MM/DD/<turnId>.jsonl
```

The existing time-based `IMonotonicallyIncreasingIdGenerator` produces IDs such
as:

```text
2025-11-11T04-36-29Z-0001234-000
```

The deterministic path is therefore:

```text
WorkDir/storage/turns/2025/11/11/2025-11-11T04-36-29Z-0001234-000.jsonl
```

The repository validates the ID format before deriving the path. It extracts
the UTC `YYYY-MM-DD` prefix and rejects malformed or path-like values.

### 5.2 File rules

- The first line is always `turn_created`.
- The first line contains `schemaVersion: 1`.
- Every event contains `turnId` and an ISO timestamp `ts`.
- Physical line order is authoritative event order.
- There are no generic event IDs or sequence numbers.
- Domain identifiers such as `toolCallId` and `modelCallIndex` remain explicit.
- Every event must be JSON-serializable.
- `undefined`, `BigInt`, functions, cyclic data, class instances, and raw
  `Error` objects are rejected.
- Reads validate every line strictly.
- Any malformed line, including a malformed final line, makes the turn corrupt.
- The repository does not truncate, repair, or skip malformed lines.
- Unknown schema versions and unknown event types fail loudly.
- Appends are awaited but are not explicitly flushed with `fsync` initially.

### 5.3 Repository contract

```ts
interface ITurnRepo {
  create(event: TurnCreated): Promise<void>;
  read(turnId: string): Promise<TurnEvent[]>;
  append(turnId: string, events: TurnEvent[]): Promise<void>;
  withLock<T>(turnId: string, fn: () => Promise<T>): Promise<T>;
}
```

Rules:

- `create` fails if the target file already exists.
- `append` validates events before writing.
- `read` validates every line and verifies event `turnId` values.
- `withLock` provides in-process per-turn exclusion.
- Cross-process coordination is out of scope.
- Whether lock contention waits or reports busy is an implementation detail for
  the first version.
- Listing, deletion, session lookup, and presentation metadata are not required
  by the loop-facing repository contract.

## 6. Agent resolution

### 6.1 Caller input

`createTurn` accepts a registered agent ID and an optional atomic model
override:

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

interface ModelDescriptor {
  provider: string;
  model: string;
}

interface RequestedAgent {
  agentId: string;
  overrides?: {
    model?: ModelDescriptor;
    // Opaque composition hints interpreted by the agent resolver (e.g.
    // work-dir id, voice/search/code modes). Persisted verbatim for audit.
    // The resolver decides which keys affect system-prompt bytes; callers
    // should keep prompt-affecting inputs session-sticky to preserve
    // provider prefix caching across turns.
    composition?: JsonValue;
  };
}
```

Provider and model are overridden together. Independent partial provider/model
overrides are not supported.

Inline resolved agents are not supported initially because there is no current
application use case.

### 6.2 AgentResolver responsibilities

`IAgentResolver` absorbs the current agent-assembly responsibilities:

- Built-in agent selection currently handled by `loadAgent`.
- User-defined agent loading from `IAgentsRepo`.
- Dynamic Copilot, background-task, live-note, and knowledge-agent builders.
- Agent-specific system-prompt augmentation.
- Agent Notes, work-directory context, and similar prompt assembly.
- Model override, agent configuration, and application-default precedence.
- Tool attachment resolution.
- Tool availability filtering.
- Creation of immutable serializable tool descriptors.

```ts
interface ResolvedAgent {
  agentId: string;
  systemPrompt: string;
  model: ModelDescriptor;
  tools: ToolDescriptor[];
}

interface IAgentResolver {
  resolve(agent: RequestedAgent): Promise<ResolvedAgent>;
}
```

The resolved system prompt is the final byte-for-byte string used by model
requests. The turn loop never appends additional instructions.

Model resolution precedence is:

1. `createTurn` model override.
2. Model/provider configured on the agent.
3. Application default model/provider.

### 6.3 Tool identity

Model-facing names and runtime implementation identities are distinct:

```ts
interface ToolDescriptor {
  toolId: string;
  name: string;
  description: string;
  inputSchema: JsonValue;
  execution: "sync" | "async";
  requiresHuman: boolean;
}
```

- `toolId` is the stable registry lookup identity.
- `name` is the name advertised to the model.
- The distinction supports aliases and MCP-backed tools.
- The descriptor is fully snapshotted at turn creation.
- `advanceTurn` may not silently add, remove, or modify tools.

### 6.4 Requested and resolved agent snapshots

`turn_created` stores both caller intent and resolved output:

```ts
agent: {
  requested: RequestedAgent;
  resolved: ResolvedAgent;
}
```

This makes defaults, aliases, and overrides visible during debugging.

If agent resolution fails, `createTurn` rejects without creating a turn file.

### 6.5 Model and tool implementation materialization

Agent resolution and live runtime materialization are separate responsibilities,
but all dependencies are constructor-injected:

- `IAgentResolver` creates the immutable serializable snapshot during
  `createTurn`.
- `IModelRegistry` resolves the persisted model descriptor to a live AI SDK
  model during `advanceTurn`.
- `IToolRegistry` resolves persisted tool descriptors to live implementations
  during `advanceTurn`.

This lets an old turn resume from its snapshot even if the registered agent
definition later changes.

### 6.6 Context references and materialization

Session turns do not inline their conversation prefix. Context is either an
inline message array or a reference to the immediately preceding turn:

```ts
type TurnContext =
  | { previousTurnId: string }
  | ConversationMessage[];
```

- `{ previousTurnId }` references an immutable prior turn. The materialized
  context is that turn's closed transcript: its own materialized context,
  followed by its input and every message it produced, including synthetic
  closure results for failed, cancelled, or interrupted work.
- Inline arrays are used by standalone turns and by callers that assemble
  context themselves (for example after a future compaction).

Materialization is performed by an injected resolver:

```ts
interface IContextResolver {
  resolve(context: TurnContext): Promise<ConversationMessage[]>;
}
```

Rules:

- Resolution happens at the start of every `advanceTurn` invocation, from
  durable state only. Normal execution and crash recovery therefore share one
  code path.
- Resolution traverses references recursively until an inline context
  terminates the chain.
- Turns with any terminal status participate in resolution. Their transcripts
  are structurally complete because unresolved work receives synthetic
  results before a terminal event is appended.
- A reference to a missing or corrupt turn file is an infrastructure error.
  It rejects the execution and does not append `turn_failed`.
- The reducer treats `context` as opaque data and never resolves references.

The app wires the resolver through a decorator (`context-elision.ts`) that
applies transmit-time elision to the materialized prefix: tool results from
prior turns above a size threshold are replaced with a short placeholder
telling the model to re-run the tool if it needs the output; inline image
parts from prior turns (video-mode webcam and screen-share frames) are
replaced with a text part recording how many frames of each kind were
dropped; and middle-pane note snapshots on prior-turn user messages keep
their kind and path but have their content replaced with a placeholder
pointing at the still-readable file. The durable log is untouched; only the
transmitted bytes change.
Elision is a pure function of each message, so resolved prefixes stay
byte-stable across calls (provider prefix caches keep working), and the
current turn's own messages never pass through the resolver, so in-flight
tool results and just-captured frames are always sent verbatim. Policy lives
in `config/context.json` (`elideHistoricToolResults`, default true;
`elideHistoricToolResultsThresholdChars`, default 2500;
`elideHistoricImages`, default true; `elideHistoricMiddlePaneContent`,
default true). The inspect CLI composes through the same decorated resolver.

Caveat: elision makes the composed payload a function of the durable log
PLUS the config in effect at compose time — the one deliberate exception to
"recomposition from durable state alone" (§8.3). Within a turn this is
harmless (policy is loaded once per execution, at resolve time), but
inspecting an old turn after a config change may show different prefix
bytes than were transmitted; the inspect CLI prints the active policy so
the divergence is visible. If exact-bytes replay ever becomes a hard
requirement, record the applied policy on the turn and compose from that.

Relatedly, Anthropic-family requests get cache_control breakpoints stamped
at the transport layer (`models/prompt-caching.ts`, applied inside the
model registry bridge just before streamText). These are provider metadata
only — message content is untouched, nothing is persisted, and inspect
does not render them; non-Anthropic requests pass through byte-identical.

### 6.7 Agent snapshot inheritance

Session turns whose resolved system prompt and tool set are byte-identical
to the context predecessor's materialized snapshot persist an inherited
form instead of repeating ~tens of KB per turn:

```ts
type ResolvedAgentSnapshot =
  | ResolvedAgent
  | { agentId: string; model: ModelDescriptor; inheritedFrom: string };
```

Rules:

- Inheritance is decided at `createTurn` by comparing against the
  predecessor's materialized snapshot; any difference in system prompt or
  tools persists the full snapshot. An unreadable predecessor falls back to
  the full snapshot.
- The model stays concrete: it is small, the session index denormalizes it,
  and a mid-session model switch must not block inheritance. On
  materialization the inherited record's own `agentId`/`model` win; only the
  heavy fields come from the chain base.
- `inheritedFrom` must equal the turn's `context.previousTurnId` (reducer
  invariant); materialization walks the chain with cycle detection
  (`IContextResolver.resolveAgent`), exactly like context references.
- The reducer treats inherited snapshots as opaque: tool identity for
  extraction arrives via `tool_invocation_requested` events instead of the
  descriptor lookup.

## 7. Turn creation schema

The authoritative initial event is:

```ts
interface TurnCreated {
  type: "turn_created";
  schemaVersion: 1;
  turnId: string;
  ts: string;
  sessionId: string | null;

  agent: {
    requested: RequestedAgent;
    resolved: ResolvedAgent;
  };

  context: TurnContext;
  input: UserMessage;

  config: {
    autoPermission: boolean;
    humanAvailable: boolean;
    maxModelCalls: number;
  };
}
```

Rules:

- `sessionId` is explicitly nullable.
- `context` is either an inline message array or a reference to the previous
  turn (section 6.6).
- Inline context contains prior user, assistant, and tool messages only.
- System-role messages in inline context are rejected.
- A context reference is resolved by the injected context resolver during
  `advanceTurn`, never at creation and never by the reducer.
- The resolved agent owns the single authoritative system prompt.
- `input` is the user message that defines this turn boundary.
- `autoPermission` defaults to `false` before persistence.
- `humanAvailable` is required explicitly.
- `maxModelCalls` defaults to `20` before persistence.
- Persisted values are fully resolved and immutable.

The capability is named `humanAvailable`, not `headless`. `headless` describes
one deployment mode, while this flag states the exact runtime capability used
by permission fallback and human-dependent tools.

The canonical system prompt is written once in `turn_created`. It may be
deliberately duplicated inside each `model_call_requested.request` because that
event records the exact model input for auditing.

## 8. Shared event schemas

All durable serializable event schemas live in `@x/shared`. The repository,
runtime, live stream implementation, and filesystem behavior live in `@x/core`.

### 8.1 Base event

```ts
interface BaseTurnEvent {
  turnId: string;
  ts: string;
}
```

### 8.2 Usage

Usage means token usage only. Monetary pricing and cost calculation are out of
scope.

```ts
interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}
```

Usage is stored per completed model call and aggregated across the turn.

### 8.3 Model request events

Every AI SDK `streamText` invocation performs exactly one model step. Tool
execution is controlled manually by the turn loop.

```ts
// Compact string refs, so raw JSONL reads naturally:
//   "context"                  the inline context block
//   "input"                    the turn's user message
//   "assistant:<index>"        → that model_call_completed's message
//   "toolResult:<toolCallId>"  → that tool_result
type ModelRequestMessageRef = string;

interface ModelRequest {
  contextRef?: { previousTurnId: string };  // call 0 only (cross-turn prefix)
  messages: ModelRequestMessageRef[];       // what is NEW since the previous call
  parameters: Record<string, JsonValue>;
}

interface ModelCallRequested extends BaseTurnEvent {
  type: "model_call_requested";
  modelCallIndex: number;
  request: ModelRequest;
}
```

`modelCallIndex` starts at `0` and increments monotonically for each primary
agent model call in the turn.

`request` is a list of references into the turn's own events: every
referenced byte exists exactly once in the file. A request records only what
is new since the previous model call — call 0 is `["context"?, "input"]`
(context only when inline and nonempty; cross-turn prefixes ride
`contextRef`); call N is `["assistant:N-1", …that batch's
"toolResult:<id>" refs in source order]`; a re-issued call after an
interruption is `[]`. The system
prompt and tool set are not repeated: they are byte-identical to
`turn_created.agent.resolved` by construction.

The exact provider payload is rebuilt by the request composer
(`composeModelRequest` in core): resolved system prompt, wrapped tool
definitions, the materialized cross-turn prefix, and every request's
references resolved against the turn's events, all passed through the model
bridge's `encodeMessages` (the deterministic structural→wire conversion —
user-message context weaving, attachment rendering, tool-result enveloping).
The loop transmits exactly the composer's output, and debugging/audit calls
the same function, so the durable file plus the composer reproduce the wire
bytes and the two views cannot diverge.

Requests exclude credentials, auth headers, functions, model objects, and
transport objects.

The name `requested` is intentional. The event proves durable intent, not that
the provider definitely received the request.

### 8.4 Provider step events

Normalized AI SDK step events may be persisted for debugging:

```ts
interface ModelStepEvent extends BaseTurnEvent {
  type: "model_step_event";
  modelCallIndex: number;
  event: DurableLlmStepStreamEvent;
}
```

The wrapper may contain normalized events such as:

- Text start/end.
- Reasoning start/end.
- Completed tool calls.
- Finish-step metadata and usage.
- Normalized provider errors.

Raw text and reasoning delta events are not durable. Partial tool-argument
fragments are also not required; completed parsed tool calls are durable.

There is one `TurnEvent` union. Events are not permanently classified as
"state" or "diagnostic" because reducer usage will evolve. The reducer decides
which known events currently affect derived state.

### 8.5 Completed and failed model calls

```ts
interface ModelCallCompleted extends BaseTurnEvent {
  type: "model_call_completed";
  modelCallIndex: number;
  message: AssistantMessage;
  finishReason: string;
  usage: TurnUsage;
  providerMetadata?: JsonValue;
}

interface ModelCallFailed extends BaseTurnEvent {
  type: "model_call_failed";
  modelCallIndex: number;
  error: string;
}
```

`model_call_completed` is the canonical completed model response even when its
content duplicates provider step events.

Any successfully completed assistant response without tool calls completes the
turn, including responses whose finish reason is `length` or `content-filter`.
Provider and stream failures fail the turn.

Only the primary model calls directly controlled by the turn loop are recorded
as model calls. Internal model calls hidden inside the permission classifier or
tool implementations belong to those dependencies and are not turn-loop model
calls.

## 9. Permission model

### 9.1 Dependencies

An injected permission checker determines whether a tool call needs permission:

```ts
interface PermissionCheckAllowed {
  required: false;
}

interface PermissionCheckRequired {
  required: true;
  request: JsonValue;
}

interface IPermissionChecker {
  check(input: PermissionCheckInput): Promise<
    PermissionCheckAllowed | PermissionCheckRequired
  >;
}
```

Tool-specific policy, command analysis, filesystem boundaries, and allowlists
remain outside the loop.

When automatic permission is enabled, the injected classifier handles all
permission-required calls from one model response in one batch:

```ts
interface PermissionClassification {
  toolCallId: string;
  decision: "allow" | "deny" | "defer";
  reason: string;
}

interface PermissionClassificationBatch {
  turnId: string;
  // Conversation context: resolved context plus current-turn settled
  // messages (the pending batch's tool results are not yet terminal).
  messages: ConversationMessage[];
  requests: PermissionClassificationInput[];
}

interface IPermissionClassifier {
  classify(
    batch: PermissionClassificationBatch,
    signal: AbortSignal,
  ): Promise<PermissionClassification[]>;
}
```

The classifier's internal implementation and internal model calls are opaque to
the turn loop.

### 9.2 Permission events

```ts
interface ToolPermissionRequired extends BaseTurnEvent {
  type: "tool_permission_required";
  toolCallId: string;
  toolName: string;
  request: JsonValue;
  checkerError?: string;
}

interface ToolPermissionClassified extends BaseTurnEvent {
  type: "tool_permission_classified";
  toolCallId: string;
  decision: "allow" | "deny" | "defer";
  reason: string;
}

interface ToolPermissionClassificationFailed extends BaseTurnEvent {
  type: "tool_permission_classification_failed";
  toolCallIds: string[];
  error: string;
}

interface ToolPermissionResolved extends BaseTurnEvent {
  type: "tool_permission_resolved";
  toolCallId: string;
  decision: "allow" | "deny";
  source: "classifier" | "human" | "human_unavailable";
  reason?: string;
  metadata?: JsonValue;
}
```

Only `tool_permission_resolved` is an effective execution decision.

### 9.3 Permission behavior matrix

`autoPermission` and `humanAvailable` are orthogonal:

| autoPermission | humanAvailable | Behavior |
| --- | --- | --- |
| false | true | Ask human and suspend. |
| false | false | Deny and continue with an error tool result. |
| true | true | Classify; deferred calls ask human. |
| true | false | Classify; deferred calls are denied. |

Classifier decisions behave as follows:

- `allow`: resolve allow and execute/dispatch immediately.
- `deny`: resolve deny and create an error tool result.
- `defer`: ask a human if available; otherwise deny.
- Classifier failure or omitted decision: record failure and treat as `defer`.

If the permission checker itself throws, the loop fails closed:

- Record the checker error as a permission-required event.
- Ask a human if available.
- Otherwise create a denied error result.
- Never execute automatically.

### 9.4 Partial decisions

Permission resolution is per tool call, not a batch barrier.

When one permission decision arrives:

- An allowed sync tool executes immediately.
- An allowed async tool is exposed immediately.
- A denied tool receives an immediate error result.
- Other unresolved permission requests remain pending.
- The turn suspends again if any external inputs remain outstanding.

Permission responses are accepted one at a time. The caller is never required
to batch external inputs.

### 9.5 Permission scopes

The turn consumes only the effective allow/deny decision for the current tool
call. Session-wide or global approval grants are persisted by the caller before
advancing the turn. Scope may be retained as audit metadata, but the loop does
not interpret or apply it.

## 10. Tool model

### 10.1 Runtime tools

Sync and async execution are immutable tool metadata:

```ts
interface ToolExecutionContext {
  turnId: string;
  toolCallId: string;
  signal: AbortSignal;
  reportProgress(progress: JsonValue): Promise<void>;
}

interface SyncRuntimeTool {
  descriptor: ToolDescriptor & { execution: "sync" };
  execute(
    input: JsonValue,
    context: ToolExecutionContext,
  ): Promise<ToolResultData>;
}

interface AsyncRuntimeTool {
  descriptor: ToolDescriptor & { execution: "async" };
}

type RuntimeTool = SyncRuntimeTool | AsyncRuntimeTool;
```

An async tool has no in-process executor. Its request is exposed externally and
its progress/result is later supplied through `advanceTurn`.

`ask-human` is an ordinary async tool. Other externally resolved async tools may
be added without changing the loop.

### 10.2 Human-dependent tools

`requiresHuman` is generic metadata, not a hard-coded `ask-human` name check.

If `requiresHuman` is true and `humanAvailable` is false:

- Append the tool invocation request.
- Append an immediate runtime error result such as "Human input is unavailable
  for this turn."
- Continue the tool batch.

`humanAvailable` affects human-dependent tools and permission fallback. It does
not disable other async tools.

### 10.3 Tool events

```ts
interface ToolInvocationRequested extends BaseTurnEvent {
  type: "tool_invocation_requested";
  toolCallId: string;
  toolId: string;
  toolName: string;
  execution: "sync" | "async";
  input: JsonValue;
}

interface ToolProgress extends BaseTurnEvent {
  type: "tool_progress";
  toolCallId: string;
  source: "sync" | "async";
  progress: JsonValue;
}

interface ToolResultData {
  output: JsonValue;
  isError: boolean;
  metadata?: JsonValue;
}

interface ToolResult extends BaseTurnEvent {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  source: "sync" | "async" | "runtime";
  result: ToolResultData;
}
```

`runtime` results cover:

- Permission denial.
- Unknown tools.
- Invalid or unusable model tool calls.
- Human unavailability.
- Cancellation.
- Interrupted sync execution.

A tool result may exist without an invocation event when execution is rejected
before dispatch, such as permission denial or unknown tool handling.

### 10.4 Progress

Any sync or async tool may report progress.

- Sync tools call and await `reportProgress`.
- The loop appends `tool_progress` before resolving that callback.
- Async progress arrives as one external `advanceTurn` input.
- Progress is durable and informational.
- Progress does not satisfy the pending tool call.
- Progress after a terminal tool result is rejected.
- Backend flow control may ignore progress while UI reducers retain it.

No progress write queue or non-blocking batching is included initially.

### 10.5 Tool scheduling and ordering

For one completed assistant response:

1. Identify all model-produced tool calls and their source order.
2. Determine permission requirements.
3. Apply automatic permission decisions when enabled.
4. Advance each tool independently as its permission is resolved.
5. Record invocations for allowed tools serially in source order (sync and
   async alike), then execute all allowed sync tools concurrently. There is
   no concurrency cap and no per-tool serialization; tools that share state
   must tolerate racing (or reject stale operations, as file edits do via
   their search/replace precondition). Secondary kill-path state (the abort
   registry) is scoped per tool call, never per turn.
6. Expose allowed async tool requests.
7. Suspend when any permissions or async results remain outstanding.
8. Once all calls have terminal results, build the next model request with
   results in original model-call order.

The model is not called while any tool in the current batch lacks a terminal
result.

## 11. Suspension and external inputs

### 11.1 Suspension event

```ts
interface TurnSuspended extends BaseTurnEvent {
  type: "turn_suspended";
  pendingPermissions: Array<{
    toolCallId: string;
    toolName: string;
    request: JsonValue;
  }>;
  pendingAsyncTools: Array<{
    toolCallId: string;
    toolId: string;
    toolName: string;
    input: JsonValue;
  }>;
  usage: TurnUsage;
}
```

Before an invocation returns suspended, it appends a full snapshot of currently
pending external work.

Calling `advanceTurn` with no input when the turn is already suspended returns
the current suspended outcome without appending a duplicate event.

After a valid external input, if work remains pending, a new suspension snapshot
is appended before returning.

### 11.2 One input per invocation

```ts
type TurnExternalInput =
  | {
      type: "permission_decision";
      toolCallId: string;
      decision: "allow" | "deny";
      metadata?: JsonValue;
    }
  | {
      type: "async_tool_progress";
      toolCallId: string;
      progress: JsonValue;
    }
  | {
      type: "async_tool_result";
      toolCallId: string;
      result: ToolResultData;
    }
  | {
      type: "cancel";
      reason?: string;
    };
```

Each `advanceTurn` accepts at most one input. It validates that input against the
current durable pending state, persists the resulting semantic event, advances
as far as possible, and settles again.

Inputs targeting calls that are no longer pending are rejected.

No caller-generated input IDs or duplicate-delivery semantics are included.

### 11.3 Partial async results

Async progress and results may arrive independently and in any order.

- Persist each input immediately.
- Keep the turn suspended while any permission or async result remains pending.
- Do not initiate the next model call until every original tool call has a
  terminal result.

## 12. Terminal events

```ts
interface TurnCompleted extends BaseTurnEvent {
  type: "turn_completed";
  output: AssistantMessage;
  finishReason: string;
  usage: TurnUsage;
}

interface TurnFailed extends BaseTurnEvent {
  type: "turn_failed";
  error: string;
  code?: string;
  usage: TurnUsage;
}

interface TurnCancelled extends BaseTurnEvent {
  type: "turn_cancelled";
  reason?: string;
  usage: TurnUsage;
}
```

The completed event deliberately duplicates the final assistant message,
finish reason, and aggregate usage so the final line is a self-contained
completion summary.

Errors begin as a single descriptive string. Structured details may be added
later when they are naturally available upstream; the loop does not invent
structure by parsing arbitrary errors.

`code` is an optional machine-readable discriminator for failures that
callers must tell apart. This specification defines `"model-call-limit"`
(section 20); other codes may be added when a caller concretely needs them.

Terminal states are immutable:

- Events may not be appended after completion, failure, or cancellation.
- Re-advancing a terminal turn returns its existing outcome.
- Retrying a failed turn means creating a new turn with a new ID.

## 13. Turn event union and live deltas

```ts
type TurnEvent =
  | TurnCreated
  | ModelCallRequested
  | ModelStepEvent
  | ModelCallCompleted
  | ModelCallFailed
  | ToolPermissionRequired
  | ToolPermissionClassified
  | ToolPermissionClassificationFailed
  | ToolPermissionResolved
  | ToolInvocationRequested
  | ToolProgress
  | ToolResult
  | TurnSuspended
  | TurnCompleted
  | TurnFailed
  | TurnCancelled;
```

Ephemeral model deltas are stream-only:

```ts
interface TextDelta {
  type: "text_delta";
  turnId: string;
  modelCallIndex: number;
  delta: string;
}

interface ReasoningDelta {
  type: "reasoning_delta";
  turnId: string;
  modelCallIndex: number;
  delta: string;
}

type TurnStreamEvent = TurnEvent | TextDelta | ReasoningDelta;
```

All durable provider step events are appended before the loop reads the next
provider stream event. This intentionally applies simple filesystem
backpressure. Text and reasoning deltas bypass storage.

## 14. Derived turn state

### 14.1 One canonical reducer

`@x/shared` owns one pure reducer used by core and renderer:

```ts
function reduceTurn(events: TurnEvent[]): TurnState;
```

Properties:

- Pure and deterministic.
- Performs no I/O.
- Performs no expensive external work.
- Replays the full bounded turn log from the beginning.
- Known events that do not currently affect state may be ignored.
- Invalid event transitions throw a corruption/state error.
- There is no incremental reducer API initially.

Consumers may append a newly received durable event to their local event list
and call `reduceTurn` again.

### 14.2 State shape

```ts
interface TurnState {
  definition: TurnCreated;
  modelCalls: ModelCallState[];
  toolCalls: ToolCallState[];
  suspension?: TurnSuspended;
  terminal?: TurnCompleted | TurnFailed | TurnCancelled;
  usage: TurnUsage;
}

interface ModelCallState {
  index: number;
  request: ModelRequest;
  stepEvents: DurableLlmStepStreamEvent[];
  response?: AssistantMessage;
  finishReason?: string;
  usage?: TurnUsage;
  error?: string;
}

interface ToolCallState {
  modelCallIndex: number;
  order: number;
  toolCallId: string;
  toolId?: string;
  toolName: string;
  input: JsonValue;
  execution?: "sync" | "async";

  permission?: {
    required: ToolPermissionRequired;
    classification?: ToolPermissionClassified;
    resolved?: ToolPermissionResolved;
  };

  invocation?: ToolInvocationRequested;
  progress: ToolProgress[];
  result?: ToolResult;
}
```

The exact implementation may refine these field names, but the state must
retain enough information for both execution and historical presentation.

### 14.3 No durable or derived running status

`TurnState` does not contain a single status field.

Consumers derive what they need from:

- `suspension`.
- `terminal`.
- Outstanding model and tool records.
- Ephemeral application bus activity.

This avoids encoding process liveness in durable or replayed state.

### 14.4 No transient streaming buffer

`TurnState` contains only durable projections. It does not contain partial text
or reasoning buffers. The renderer owns those ephemeral buffers while handling
live deltas and discards them when a canonical model response arrives.

### 14.5 No shared timeline selector initially

The renderer may interpret `modelCalls` and `toolCalls` directly. A shared
semantic timeline selector can be added later if duplicated presentation logic
becomes a concrete problem.

### 14.6 Historical read API

```ts
interface Turn {
  turnId: string;
  events: TurnEvent[];
}

interface ITurnRuntime {
  getTurn(turnId: string): Promise<Turn>;
}
```

`getTurn` is strictly read-only:

- It reads and validates the JSONL file.
- It returns the validated event list.
- It never resumes work.
- It never appends recovery records.
- Callers use the shared reducer to obtain `TurnState`.

Only `advanceTurn` may reconcile or advance execution.

Prior session context remains inside `state.definition.context`. Historical UI
for one turn should normally show the triggering input and activity produced by
that turn, not repeat the prior context. Session presentation will handle
composition later.

## 15. TurnRuntime API and dependency injection

### 15.1 Constructor

```ts
interface TurnRuntimeDependencies {
  turnRepo: ITurnRepo;
  idGenerator: IMonotonicallyIncreasingIdGenerator;
  clock: IClock;
  agentResolver: IAgentResolver;
  modelRegistry: IModelRegistry;
  toolRegistry: IToolRegistry;
  contextResolver: IContextResolver;
  permissionChecker: IPermissionChecker;
  permissionClassifier: IPermissionClassifier;
  lifecycleBus: ITurnLifecycleBus;
}

class TurnRuntime implements ITurnRuntime {
  constructor({
    turnRepo,
    idGenerator,
    clock,
    agentResolver,
    modelRegistry,
    toolRegistry,
    contextResolver,
    permissionChecker,
    permissionClassifier,
    lifecycleBus,
  }: TurnRuntimeDependencies);
}
```

The injected clock exposes a simple deterministic timestamp source for unit
tests. The existing ID generator remains responsible for turn IDs.

Awilix registration is singleton-scoped:

```ts
turnRepo: asClass<ITurnRepo>(FSTurnRepo).singleton(),
turnRuntime: asClass<ITurnRuntime>(TurnRuntime).singleton(),
```

Model, tool, permission, clock, and bus dependencies are also explicitly
registered and injected.

### 15.2 Public API

```ts
interface CreateTurnInput {
  agent: RequestedAgent;
  sessionId?: string | null;
  context: TurnContext;
  input: UserMessage;
  config: {
    autoPermission?: boolean;
    humanAvailable: boolean;
    maxModelCalls?: number;
  };
}

interface ITurnRuntime {
  createTurn(input: CreateTurnInput): Promise<string>;

  advanceTurn(
    turnId: string,
    input?: TurnExternalInput,
    options?: { signal?: AbortSignal },
  ): TurnExecution;

  getTurn(turnId: string): Promise<Turn>;
}
```

Creation and execution remain separate operations. A turn may exist before its
first model call.

### 15.3 Runtime dependency validation

Before advancing, the runtime resolves live model and tool implementations from
the persisted descriptors and validates compatibility.

Missing or mismatched runtime dependencies:

- Reject the execution.
- Do not append `turn_failed`.
- Leave the turn unchanged so the caller can fix its environment and retry.

Provider failures after actual execution begins are modeled turn failures.

## 16. Hot TurnExecution stream

### 16.1 Shape

```ts
interface TurnExecution {
  events: AsyncIterable<TurnStreamEvent>;
  outcome: Promise<TurnOutcome>;
}
```

`advanceTurn` returns immediately with a hot execution object. Execution starts
independently of event consumption.

### 16.2 Rationale

A plain async generator would make execution pull-driven:

- Never consuming it would mean execution never starts.
- Slow consumers would pause the loop at every yield.
- Abandoning a partially consumed iterator could leave execution paused and a
  lock held indefinitely.

The hot stream prevents turn correctness and lock release from depending on an
observer.

### 16.3 Initial stream semantics

- One event consumer is assumed.
- The caller may fan events out through its own event emitter or bus bridge.
- Events produced by that `advanceTurn` invocation only are emitted.
- Historical events are not replayed.
- Durable events enter the stream only after successful persistence.
- Text and reasoning deltas enter without persistence.
- The stream uses a simple in-memory queue.
- There is no backpressure or queue bound initially.
- A slow or absent consumer may cause memory growth.
- If the consumer closes, subsequent events are dropped.
- Closing or abandoning event consumption does not cancel turn execution.
- Cancellation is explicit through `AbortSignal` or a cancel input.
- `outcome` may be awaited independently of `events`.

### 16.4 Outcome

```ts
type TurnOutcome =
  | {
      status: "completed";
      output: AssistantMessage;
      finishReason: string;
      usage: TurnUsage;
    }
  | {
      status: "suspended";
      pendingPermissions: TurnSuspended["pendingPermissions"];
      pendingAsyncTools: TurnSuspended["pendingAsyncTools"];
      usage: TurnUsage;
    }
  | {
      status: "failed";
      error: string;
      usage: TurnUsage;
    }
  | {
      status: "cancelled";
      reason?: string;
      usage: TurnUsage;
    };
```

### 16.5 Infrastructure errors

If trustworthy turn state cannot be established:

- Event iteration terminates by throwing the infrastructure error.
- `outcome` rejects with the same error.
- Already persisted events remain in the file.
- No synthetic `turn_failed` is appended unless the failure is explicitly a
  modeled turn failure.

Infrastructure examples:

- Corrupt JSONL.
- Repository failure.
- Lock failure.
- Missing or mismatched injected runtime dependency.

## 17. Ephemeral application lifecycle events

`TurnRuntime` publishes process-lifecycle events through the injected bus:

```ts
interface TurnProcessingStart {
  type: "turn-processing-start";
  turnId: string;
}

interface TurnProcessingEnd {
  type: "turn-processing-end";
  turnId: string;
}
```

These events are never written to `TurnRepo` and never replayed.

The UI may maintain an in-memory set of active turn IDs. If the process crashes,
that set disappears, which accurately reflects that no execution is known to be
active.

Lifecycle publication is observational and must not alter durable turn
semantics. Live durable events and deltas are consumed from `TurnExecution` by
the application and may be forwarded over the existing bus/IPC bridge.

## 18. Main execution algorithm

At a high level, `advanceTurn` performs:

```text
1. Start hot execution task.
2. Acquire per-turn lock.
3. Publish turn-processing-start.
4. Read and validate JSONL.
5. Reduce events to TurnState.
6. Materialize context through the injected context resolver.
7. Validate terminal state, input, and runtime dependencies.
8. Apply the optional single external input.
9. Repeatedly advance deterministic work:
   a. Recover from the current durable boundary.
   b. Resolve permissions.
   c. Execute eligible sync tools.
   d. Expose eligible async tools.
   e. If external work remains, append turn_suspended and settle.
   f. If a tool batch is complete, build ordered tool-result messages.
   g. If no model-call budget remains, fail.
   h. Append model_call_requested with exact input.
   i. Call streamText for one step.
   j. Persist normalized non-delta events and stream deltas.
   k. Append model_call_completed or model_call_failed.
   l. Complete when the response has no tool calls.
10. Publish turn-processing-end in finalization.
11. Release the lock.
12. Resolve/reject outcome and close/error event stream.
```

The loop does not read session queues, accept new user messages, switch agents,
or transform context.

## 19. Context and model requests

Context selection before turn creation belongs to the caller/session layer.
The turn receives either inline messages or a reference to the previous turn
(section 6.6). Within a turn:

- The initial context — inline or resolved from the reference — is immutable.
- The system prompt is immutable.
- The model and tools are immutable.
- The loop appends current-turn assistant messages and ordered tool results.
- No pruning or compaction occurs.
- Context overflow is a model failure.

Every model call persists the current-turn portion of its request
byte-for-byte, even when it duplicates earlier events in the same file
(section 8.3). The referenced prefix is deterministic and is not re-inlined.
Within-turn storage size is not treated as a constraint.

## 20. Model-call limit

`maxModelCalls` limits primary agent model calls, not permission-classifier or
tool-internal model calls.

When the final allowed model call returns tool calls:

1. Resolve permissions.
2. Execute/dispatch and collect the complete tool batch.
3. Do not make a disallowed next model call.
4. Append `turn_failed` with `code: "model-call-limit"`.

If the final allowed call returns a response without tool calls, complete
normally.

Limit exhaustion is a distinguishable outcome, not a generic failure. The
transcript is structurally complete — every tool call has a result — so a
caller such as the session layer can offer continuation by creating a new
turn whose context references the exhausted turn.

## 21. Failure semantics

### 21.1 Model failures

- No automatic retry in the turn loop.
- The injected model/provider may perform internal transport retries.
- Append `model_call_failed`.
- Append `turn_failed`.
- Return a failed outcome.

These rules apply to failures observed during live execution. Closing a model
call that was interrupted by a process crash is a recovery action (section
23) and does not fail the turn.

### 21.2 Tool failures

Tool failures do not fail the turn:

- Sync tool throws: append an error tool result.
- Async tool reports failure: append an error tool result.
- Permission denial: append an error tool result.
- Human unavailable: append an error tool result.

Once every call has a result, send all results to the model in source order.

### 21.3 Unknown tools and unusable calls

Unknown tools and unusable model tool calls become runtime error results so the
model can observe and potentially correct its behavior. They do not fail the
turn directly.

### 21.4 Storage and configuration failures

Repository failures, corrupt data, and incompatible live dependencies reject
the execution without pretending the agent turn itself failed.

## 22. Cancellation

Cancellation enters through:

- An `AbortSignal` for an active invocation.
- A `{ type: "cancel" }` external input for a suspended turn.

Rules:

- Propagate the signal to the model, permission classifier, and sync tools.
- Create synthetic cancellation results for unresolved tool calls from a
  completed assistant response.
- Append `model_call_failed` when an active model call is cancelled.
- Append `turn_cancelled`.
- Never initiate another model call.
- Reject late permission decisions, progress, and results after cancellation.

Sync tools are cooperatively cancellable. A tool that ignores the signal may not
settle immediately. The runtime cannot guarantee rollback of external side
effects.

## 23. Recovery model

Provider streams are not resumable. Sync tool side effects are not assumed
idempotent. Recovery never repeats side-effecting work; side-effect-free
model calls are re-issued rather than failing the turn.

Calling `advanceTurn(turnId)` with no external input is the recovery entry point.

| Last durable condition | Recovery behavior |
| --- | --- |
| `turn_created` only | Safely initiate the first model call. |
| `model_call_requested` without completion/failure | Append `model_call_failed` (interrupted) to close the call, then re-issue the request as a new model call with the next index. The re-issue counts against `maxModelCalls`. No `turn_failed`. |
| Completed model response before permission/tool processing | Safely continue processing. |
| Permission required/classification partially processed | Continue unresolved permission work safely. |
| Permission resolved allow before invocation | Safely invoke the tool. |
| Sync `tool_invocation_requested` without result | Append an indeterminate error tool result and continue the turn; never re-execute. No `turn_failed`. |
| Async `tool_invocation_requested` without result | Remain suspended awaiting external result. |
| Some async results present | Preserve them and await remaining inputs. |
| All tool results present before next model request | Safely initiate the next model call. |
| Terminal event present | Return existing outcome without writing or executing. |
| Corrupt JSONL | Reject as infrastructure error. |

The synthetic interrupted sync result should communicate:

```text
Tool execution was interrupted; its outcome is unknown and it was not retried.
```

This preserves a structurally complete transcript for later session context
without claiming that the side effect did or did not happen. The model sees
the indeterminate result on the next model call and can decide whether to
re-run the tool, verify its effect, or proceed — consistent with section
21.2's rule that tool-level problems are conversational, not terminal.

Async invocation requests act as durable external requests. Exactly-once
delivery is not guaranteed. External systems that perform side effects should
use `toolCallId` as a correlation/deduplication key if they need that guarantee,
but the first turn implementation does not enforce it.

## 24. Reducer invariants

`reduceTurn` must reject impossible histories, including:

- Missing or non-first `turn_created`.
- Multiple `turn_created` events.
- Mismatched turn IDs.
- Unsupported schema version.
- Model-call indices that are reused or out of order.
- Concurrent unresolved primary model requests.
- Model completion/failure without a matching request.
- Duplicate model completion/failure.
- Duplicate tool-call IDs within one model response.
- Permission records targeting unknown tool calls.
- Conflicting effective permission decisions.
- Tool progress after a terminal tool result.
- Duplicate terminal tool results.
- Async external results for sync tools.
- Sync execution results for async tools unless explicitly represented as
  runtime-generated errors.
- Starting the next model call before all prior tool calls have results.
- Model-facing tool-result ordering that differs from original call order.
- Completion while tool calls remain unresolved.
- Terminal turn events while unresolved calls lack synthetic terminal results.
- Multiple terminal turn events.
- Any event after a terminal turn event.
- Mutation of immutable turn definition data.
- `model_call_requested.contextRef` values inconsistent with the turn
  definition's context, or present on a non-initial model call.
- Request references that do not match the transcript: call 0 must be
  `[{context}?, {input}]`; call N must reference the previous completed
  call's response and its batch's tool results in source order (or nothing,
  after an interrupted call).

The reducer validates `context` structurally but treats it as opaque; it
never resolves references (section 6.6).

## 25. Historical and live UI behavior

### 25.1 Historical load

```text
1. UI requests a turn by ID.
2. TurnRuntime.getTurn reads and validates the JSONL file.
3. Core returns { turnId, events }.
4. Renderer calls reduceTurn(events).
5. Renderer renders messages, tools, progress, permissions, usage, and terminal
   information from TurnState.
```

### 25.2 Live updates

```text
1. TurnRuntime publishes turn-processing-start.
2. The application consumes TurnExecution.events.
3. The application forwards events through the existing bus/IPC bridge.
4. The renderer appends each durable TurnEvent to its local event list.
5. The renderer reruns reduceTurn(events).
6. Text/reasoning deltas update separate ephemeral renderer buffers.
7. A canonical completed model response replaces/clears partial display state.
8. TurnRuntime publishes turn-processing-end.
```

The UI derives current activity from ephemeral bus events. It does not infer
that a turn is running from the JSONL log.

## 26. Required unit-test scenarios

All dependencies are injectable, so these tests must use fakes/mocks and avoid
real providers, tools, clocks, filesystems where unnecessary, and permission
classifiers.

### 26.1 Plain model response

Expected sequence:

```text
turn_created
model_call_requested
model_step_event(s)
model_call_completed
turn_completed
```

Assertions:

- Exact model request is persisted.
- Deltas are streamed but absent from JSONL.
- Completed response includes finish reason and usage.
- Terminal event duplicates final output and aggregate usage.
- Bus processing events are emitted but not persisted.

### 26.2 Mixed sync and async tools

Model order:

```text
sync-A, async-B, sync-C, async-D
```

Assertions:

- Sync tools execute and store results.
- Async invocation requests are exposed and turn suspends.
- Async results can arrive in reverse order.
- The next model request contains results in original source order.
- Physical event order does not change model-facing order.

### 26.3 Partial human permission decisions

Assertions:

- All required permissions are recorded.
- One approval advances only its tool.
- Approved sync tools execute immediately.
- Approved async tools become pending immediately.
- Denied calls receive runtime error results.
- Remaining permissions and async tools coexist in one suspension snapshot.
- Async results may arrive while other permissions remain unresolved.
- No next model call occurs until all original calls have terminal results.

### 26.4 Automatic permission classification

Test `allow`, `deny`, and `defer` in one classifier batch.

Assertions:

- Classifier decisions and effective decisions are distinct records.
- Allow executes.
- Deny creates an error result without invocation.
- Defer asks a human when available.
- Defer denies when no human is available.
- Classifier failure and missing decisions normalize to defer.
- Manual mode never calls the classifier.

### 26.5 Cancellation

Test cancellation:

- While suspended.
- During a model call.
- During a sync tool.

Assertions:

- Signals are propagated.
- Unresolved calls receive synthetic cancellation results.
- Turn becomes terminal cancelled.
- No subsequent model request occurs.
- Late external inputs are rejected.

### 26.6 Failures

Assertions:

- Provider failure appends model and turn failures.
- Sync throw becomes an error tool result and does not fail the turn.
- Async failure becomes an error tool result.
- Permission-checker failure fails closed.
- Repository, corruption, and dependency errors reject stream and outcome.
- Infrastructure errors do not append a false `turn_failed` event.

### 26.7 Process crash and recovery

Construct logs ending at every recovery boundary in the recovery table.

Assertions:

- Safe boundaries resume.
- Unmatched model requests are closed as interrupted and re-issued; the
  re-issue counts against the model-call budget and no `turn_failed` is
  appended.
- Unmatched sync invocation requests get indeterminate error results and the
  turn continues.
- Unmatched async requests remain pending.
- Completed tool batches proceed to the next model call.
- Terminal turns perform no writes or side effects.

### 26.8 Historical and live reconstruction

Assertions:

- `getTurn` is read-only.
- Full replay reconstructs messages, model calls, tools, progress, permissions,
  usage, suspension, and terminal data.
- Appending a durable live event and rerunning the reducer matches full replay.
- Ephemeral deltas are absent after reload.
- Final completed messages remain available after reload.
- No running state is inferred from durable events.

### 26.9 Model-call limit

With `maxModelCalls = 10`:

- A tool-free response on call 10 completes normally.
- Tool calls from call 10 are fully processed.
- Call 11 is never made.
- After the call-10 tool batch completes, the turn fails with a limit error.
- The limit failure carries `code: "model-call-limit"`.

## 27. Additional unit-test coverage

Beyond the nine end-to-end loop scenarios, implementation should include focused
tests for:

### 27.1 Repository

- Deterministic date-partitioned paths.
- ID path-traversal rejection.
- Create-if-absent behavior.
- Append ordering.
- Read/write schema validation.
- Mismatched turn IDs.
- Empty files.
- Malformed first, middle, and final lines.
- Unsupported schema versions.
- In-process locking.

### 27.2 Reducer

- Every valid event transition.
- Every corruption invariant.
- Usage aggregation.
- Original tool-call ordering.
- Suspension replacement/invalidation after new inputs.
- Terminal immutability.
- Multiple model iterations.
- Progress retention.
- Requested versus resolved agent snapshots.

### 27.3 Hot stream

- Execution starts without event consumption.
- Outcome resolves without draining events.
- Events retain order.
- Durable events appear only after repository append.
- Closing the consumer drops future events without cancelling execution.
- Producer completion closes events.
- Infrastructure failure errors events and rejects outcome with the same error.
- Cancellation remains explicit.

### 27.4 Agent resolution

- Override precedence.
- Application-default fallback.
- Final system prompt snapshot.
- Tool availability filtering.
- Tool aliases and stable `toolId` resolution.
- Resolution failure creates no file.
- Agent edits after creation do not alter the turn.
- Runtime dependency mismatch leaves the turn unchanged.

### 27.5 Context resolution

- Inline context passes through unchanged.
- A single reference materializes the referenced turn's closed transcript.
- A chain of references materializes recursively down to the inline base.
- Referenced failed/cancelled/exhausted turns contribute their synthetic
  closure results.
- A reference to a missing or corrupt turn file is an infrastructure error
  and appends nothing.
- The composed request equals what the loop sent (byte-for-byte property:
  durable file + composer reproduce the provider payload).
- The reducer never resolves references.

## 28. Suggested module layout

This is a suggested organization, not a locked implementation requirement:

```text
apps/x/packages/shared/src/turns.ts

apps/x/packages/core/src/turns/
  runtime.ts
  reducer.ts              # if implementation is re-exported through shared,
                          # locate pure code to avoid dependency cycles
  repo.ts
  fs-repo.ts
  stream.ts
  agent-resolver.ts
  context-resolver.ts
  model-registry.ts
  tool-registry.ts
  permission.ts
  index.ts
```

The final reducer location must permit both core and renderer to use exactly the
same pure implementation. It may therefore live entirely in `@x/shared` despite
being used heavily by `@x/core`.

## 29. Deferred design work

The following topics must be handled in later specifications rather than
implicitly added to the turn loop:

### 29.1 Sessions

The session layer is specified in `session-design.md`. It covers the session
JSONL schema, turn references and ordering, one-active-turn enforcement,
context assembly through turn references, the in-memory index, session UI
projections, and startup reconciliation. Queued user messages, steering,
session-level permission grants, and compaction remain deferred there with
committed future shapes.

### 29.2 Agent-as-tool

The main loop treats agent tools as ordinary sync or async tools. A dedicated
tool handler may create and execute child turns, forward progress, and return a
parent tool result. No subflow or parent-turn concept is added to this initial
turn schema.

### 29.3 Reliability enhancements

- External-input idempotency.
- Exactly-once async dispatch acknowledgements.
- Tool retry-safety metadata.
- Automatic retry policies.
- Cross-process locking.
- `fsync` durability.
- Torn-write repair.
- Event-stream bounds and backpressure.
- Large-blob sidecars, if ever required.

### 29.4 API refinements

- Inline agent support if a real use case appears.
- Explicit tool-argument validation.
- Shared semantic timeline selectors.
- Public query projections beyond `getTurn`.
- Turn listing and deletion APIs.

## 30. Implementation acceptance criteria

The turn layer is implementation-complete only when:

1. All durable schemas are defined and exported from `@x/shared`.
2. Filesystem storage follows the deterministic partitioned JSONL layout.
3. `TurnRuntime` uses explicit PROXY constructor injection.
4. Agent resolution produces one immutable snapshot.
5. Each model invocation is exactly one AI SDK model step.
6. Sync, async, permission, suspension, cancellation, and recovery behavior
   matches this specification.
7. The pure reducer is shared by core and renderer.
8. No durable running state exists.
9. The hot stream is independent of consumer progress.
10. Every required scenario and focused test group passes using mocked
    dependencies.
11. No session, agent-as-tool, compaction, or migration behavior leaks into the
    turn loop.
