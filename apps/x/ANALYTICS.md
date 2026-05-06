# Analytics

> PostHog instrumentation for `apps/x`. We capture LLM token usage (broken down by feature) and identity/auth events. Renderer (`posthog-js`) and main (`posthog-node`) share one stable distinct_id and one identified user, so events from either process resolve to the same person.

## Identity model

- **Anonymous distinct_id** = `installationId` from `~/.rowboat/config/installation.json` (auto-generated on first run; see `packages/core/src/analytics/installation.ts`).
- Renderer fetches it from main on startup via the `analytics:bootstrap` IPC channel and passes it as PostHog's `bootstrap.distinctID`. Main uses it directly in `posthog-node`.
- **On rowboat sign-in**: `posthog.identify(rowboatUserId)` runs in **both** processes.
  - Main does it from `apps/main/src/oauth-handler.ts:285` (after `getBillingInfo()` resolves) — this is the load-bearing call, since main always runs.
  - Renderer mirrors via `apps/renderer/src/hooks/useAnalyticsIdentity.ts` listening on the `oauth:didConnect` IPC event.
  - Main also calls `alias()` so events emitted under the anonymous installation_id are linked to the identified user retroactively.
- **On every app startup**: main re-identifies if rowboat tokens exist (`packages/core/src/analytics/identify.ts`, called from `apps/main/src/main.ts` whenReady). Idempotent — PostHog merges person properties on duplicate identifies. This catches users who installed before analytics existed, and refreshes person properties (plan/status) on every launch.
- **On rowboat sign-out**: `posthog.reset()` in both processes; future events resolve to the installation_id again.
- **`email`** is set on `identify` from main only (sourced from `/v1/me`). Person properties are server-side, so the renderer's events resolve to the same record without redundantly setting it.

## Event catalog

### `llm_usage`

Emitted whenever ai-sdk returns token usage (one event per LLM call, not per run).

| Property | Type | Notes |
|---|---|---|
| `use_case` | enum | `copilot_chat` / `track_block` / `meeting_note` / `knowledge_sync` |
| `sub_use_case` | string? | Refines `use_case` — see taxonomy table below |
| `agent_name` | string? | Present when the call goes through an agent run (`createRun`); omitted for direct `generateText`/`generateObject` |
| `model` | string | e.g. `claude-sonnet-4-6` |
| `provider` | string | `rowboat` = cloud LLM gateway; otherwise the BYOK provider (`openai`, `anthropic`, `ollama`, etc.) |
| `input_tokens` | number | |
| `output_tokens` | number | |
| `total_tokens` | number | |
| `cached_input_tokens` | number? | When the provider reports it |
| `reasoning_tokens` | number? | When the provider reports it |

#### Use-case taxonomy

Every `llm_usage` emit point in the codebase:

| `use_case` | `sub_use_case` | `agent_name`? | Where | File:line |
|---|---|---|---|---|
| `copilot_chat` | (none) | yes | User chat in renderer (default for any `createRun` without `useCase`) | `packages/core/src/agents/runtime.ts:1313` (finish-step in `streamLlm`) |
| `copilot_chat` | `scheduled` | yes | Background scheduled agent runner | `packages/core/src/agent-schedule/runner.ts:167` |
| `copilot_chat` | `file_parse` | inherits | `parseFile` builtin tool inside any chat | `packages/core/src/application/lib/builtin-tools.ts:770` |
| `track_block` | `routing` | no | Pass 1 routing classifier (`generateObject`) | `packages/core/src/knowledge/track/routing.ts:104` |
| `track_block` | `run` | yes | Pass 2 track block execution | `packages/core/src/knowledge/track/runner.ts:109` (createRun) |
| `meeting_note` | (none) | no | Meeting transcript summarizer (`generateText`) | `packages/core/src/knowledge/summarize_meeting.ts:161` |
| `knowledge_sync` | `agent_notes` | yes | Agent notes learning service | `packages/core/src/knowledge/agent_notes.ts:309` (createRun) |
| `knowledge_sync` | `tag_notes` | yes | Note tagging | `packages/core/src/knowledge/tag_notes.ts:86` (createRun) |
| `knowledge_sync` | `build_graph` | yes | Knowledge graph note creation | `packages/core/src/knowledge/build_graph.ts:253` (createRun) |
| `knowledge_sync` | `label_emails` | yes | Email labeling | `packages/core/src/knowledge/label_emails.ts:73` (createRun) |
| `knowledge_sync` | `inline_task_run` | yes | Inline `@rowboat` task execution (two call sites) | `packages/core/src/knowledge/inline_tasks.ts:471, 552` (createRun) |
| `knowledge_sync` | `inline_task_classify` | no | Inline task scheduling classifier (`generateText`) | `packages/core/src/knowledge/inline_tasks.ts:673` |
| `knowledge_sync` | `pre_built` | yes | Pre-built scheduled agents | `packages/core/src/pre_built/runner.ts:43` (createRun) |

`testModelConnection` in `packages/core/src/models/models.ts` is **not** instrumented (diagnostic only — would skew per-model counts).

### `user_signed_in`

Emitted when rowboat OAuth completes. Properties: `plan`, `status` (subscription state from `/v1/me`).

Emitted from **both** processes:
- Main (`apps/main/src/oauth-handler.ts:290`) — always fires; load-bearing.
- Renderer (`apps/renderer/src/hooks/useAnalyticsIdentity.ts:75`) — fires only when the renderer is open. Same distinct_id, so dedup is automatic in PostHog dashboards.

### `user_signed_out`

Emitted on rowboat disconnect. No properties. Followed immediately by `posthog.reset()`.

Emit points: `apps/main/src/oauth-handler.ts:369` and `apps/renderer/src/hooks/useAnalyticsIdentity.ts:82`.

### Other events (pre-existing, not added by the LLM-usage work)

All in `apps/renderer/src/lib/analytics.ts`:

- `chat_session_created` — `{ run_id }`
- `chat_message_sent` — `{ voice_input, voice_output, search_enabled }`
- `oauth_connected` / `oauth_disconnected` — `{ provider }`
- `voice_input_started` — no properties
- `search_executed` — `{ types: string[] }`
- `note_exported` — `{ format }`

## Person properties

Persistent across sessions for the same user. Set via `posthog.people.set` or as the `properties` arg to `identify`.

| Property | Set by | Notes |
|---|---|---|
| `email` | main on identify | From `/v1/me`; powers PostHog cohort match + integrations |
| `plan`, `status` | main on identify | Subscription state |
| `api_url` | both processes (init + identify) | Distinguishes prod / staging / custom — assign meaning in PostHog dashboard. `https://api.x.rowboatlabs.com` = production |
| `signed_in` | renderer | `true` while rowboat OAuth is connected |
| `{provider}_connected` | renderer | One of `gmail`, `calendar`, `slack`, `rowboat` |
| `total_notes` | renderer (init) | Workspace size signal |
| `has_used_search`, `has_used_voice` | renderer | One-shot first-use flags |

## How to add a new event

1. **Naming**: `snake_case`, `[object]_[verb]` shape (e.g. `note_exported`, not `exportedNote`). Matches PostHog convention.
2. **Pick the right helper**:
   - LLM token usage → `captureLlmUsage()` from `@x/core/dist/analytics/usage.js`. Always include `useCase`; add `subUseCase` if it refines an existing top-level case.
   - Anything else from main → `capture()` from `@x/core/dist/analytics/posthog.js`.
   - Anything else from renderer → add a typed wrapper to `apps/renderer/src/lib/analytics.ts` and call it from the UI code (don't call `posthog.capture()` directly from components).
3. **If it's a new LLM call site**:
   - Goes through `createRun`? Pass `useCase` (and optionally `subUseCase`) to the create call. The runtime auto-emits at every `finish-step` — no further code needed.
   - Direct `generateText` / `generateObject`? Call `captureLlmUsage` after the call with `model`, `provider`, `usage` from the result.
   - Inside a builtin tool? Call `getCurrentUseCase()` from `analytics/use_case.ts` first — the parent run's tag is propagated via `AsyncLocalStorage`. Use `ctx?.useCase ?? 'copilot_chat'` as fallback.
4. **Update this file in the same PR.** That's the contract — without it, dashboards and downstream consumers drift.

## How to add a new use-case sub-case

- **New `sub_use_case` under an existing top-level case**: just pick a string and add a row to the taxonomy table above. No code changes beyond the call site.
- **New top-level `use_case`**: edit the `UseCase` enum in `packages/shared/src/runs.ts` and the matching `UseCase` type in `packages/core/src/analytics/use_case.ts`. Then update this doc.

## Configuration

PostHog credentials live in two env vars (also baked into the binary at packaging time — never set at runtime in distributed builds):

- `VITE_PUBLIC_POSTHOG_KEY` — project API key (e.g. `phc_xxx`). Public-facing — safe to commit if you'd rather hardcode.
- `VITE_PUBLIC_POSTHOG_HOST` — e.g. `https://us.i.posthog.com`. Defaults to US cloud if unset.

Where they're consumed:
- **Renderer** (Vite): `import.meta.env.VITE_PUBLIC_POSTHOG_*` — inlined at build time.
- **Main** (esbuild via `apps/main/bundle.mjs`): inlined into `main.cjs` at packaging time using esbuild `define`. In dev (`npm run dev`), main reads them from `process.env` at runtime.

For GitHub Actions / packaged builds: set both as workflow env vars (from secrets) on the step that runs `npm run package` or `npm run make`. They'll be baked in.

If unset, analytics no-op silently — you'll see `[Analytics] POSTHOG_KEY not set; analytics disabled` in main-process logs.

`installationId`: stored in `~/.rowboat/config/installation.json`, generated on first run.

## File map

| File | Purpose |
|---|---|
| `packages/core/src/analytics/installation.ts` | Stable per-install distinct_id |
| `packages/core/src/analytics/posthog.ts` | Main-process client (`capture`, `identify`, `reset`, `shutdown`) |
| `packages/core/src/analytics/usage.ts` | `captureLlmUsage()` helper |
| `packages/core/src/analytics/use_case.ts` | `AsyncLocalStorage` for tool-internal LLM call inheritance |
| `apps/renderer/src/lib/analytics.ts` | Renderer event wrappers |
| `apps/renderer/src/hooks/useAnalyticsIdentity.ts` | Renderer identify/reset on OAuth events |
| `apps/main/src/oauth-handler.ts` | Main-side identify/reset/sign-in/sign-out events |
| `apps/main/src/main.ts` | `before-quit` hook flushes queued events |
| `packages/shared/src/ipc.ts` | `analytics:bootstrap` IPC channel definition |
| `apps/main/src/ipc.ts` | `analytics:bootstrap` handler + forwards `userId` on `oauth:didConnect` |
| `apps/main/bundle.mjs` | Bakes `POSTHOG_KEY`/`POSTHOG_HOST` into packaged `main.cjs` |
