# AGENTS.md — Working on the Rowboat runtime

Context for AI coding agents (and humans) working on this repo. General
codebase orientation lives in `CLAUDE.md`; this file covers the **new
turn/session runtime** in `apps/x` — its storage, its debugging tools, and
the invariants you must not break.

## The runtime in one paragraph

Chats are **sessions**; each user message starts a **turn**. Both are
append-only JSONL event logs under `~/.rowboat/storage/{turns,sessions}/YYYY/MM/DD/`.
All state is derived by pure reducers (`reduceTurn`, `reduceSession` in
`@x/shared/src/turns.ts` / `sessions.ts`) shared byte-for-byte between the
main process and the renderer. Design specs:
`apps/x/packages/core/docs/turn-runtime-design.md` and `session-design.md` —
read the relevant spec before changing runtime behavior.

## Storage is reference-based — files store each fact once

Three applications of the same mechanism:

1. **Context**: a session turn's `context` is `{ previousTurnId }`; the
   conversation prefix is materialized by walking the chain
   (`TurnRepoContextResolver`).
2. **Model requests**: `model_call_requested.request.messages` is a list of
   string refs into the turn's own events — `"context"`, `"input"`,
   `"assistant:<index>"`, `"toolResult:<toolCallId>"` — recording only what
   is NEW since the previous call.
3. **Agent snapshots**: when a turn's system prompt + tools are
   byte-identical to its predecessor's, `turn_created.agent.resolved` is
   `{ agentId, model, inheritedFrom }` instead of re-persisting ~70KB. The
   model stays concrete (mid-session model switches still inherit).

The exact provider payload is rebuilt by `composeModelRequest`
(`packages/core/src/turns/compose-model-request.ts`) — **the same code path
the loop transmits through**, so the file plus the composer reproduce the
wire bytes exactly (there is a property test asserting composed == sent).

## Inspecting turns and sessions

```bash
cd apps/x/packages/core

# A whole session: title, per-turn status/size/input preview
npm run inspect -- <sessionId | path/to/session.jsonl>

# One turn: per model call, the EXACT provider payload — resolved system
# prompt, tool list, wire-form messages (user-message context woven in,
# tool-result envelopes), and the response/failure
npm run inspect -- <turnId | path/to/turn.jsonl> [modelCallIndex] [--full]

# Cascade full turn inspection across a session
npm run inspect -- <sessionId> --turns
```

`--full` prints untruncated system prompts and message contents. Turn vs
session ids are auto-detected. This is the intended way to see "what did the
model actually receive" — the raw JSONL deliberately stores structural facts
and references, never the derived wire form.

## Invariants to respect

- Turn/session files are **append-only**; reducers reject impossible
  histories loudly (`TurnCorruptionError`). Never hand-edit files.
- Durable events are persisted **before** side effects (model calls, tool
  invocations). Deltas (`text_delta`, …) are stream-only, never persisted.
- The reducers in `@x/shared` must stay pure (no I/O, no node imports) —
  the renderer imports them directly.
- Every behavior change needs tests: reducers in `packages/shared`,
  runtime/sessions in `packages/core`, renderer stores/views in
  `apps/renderer` (all vitest; run `npm test` per package).
- Schema changes: the schema is pre-release (`schemaVersion: 1` throughout);
  breaking changes are acceptable but require wiping `~/.rowboat/storage`
  and a note in the commit message.
