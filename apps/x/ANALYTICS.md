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

All PostHog events include `app_version` and `platform: 'desktop'` automatically. Main-process events add them in `packages/core/src/analytics/posthog.ts`; renderer events get them from the `analytics:bootstrap` IPC payload via `posthog.register` (plus an initialization-time `before_send` hook for `app_version`). `platform` guards against the legacy web dashboard's autocapture (`apps/rowboat`, unidentified by design) muddying desktop dashboards if it ever shares the project.

### `llm_usage`

Emitted whenever ai-sdk returns token usage (one event per LLM call, not per run).

| Property | Type | Notes |
|---|---|---|
| `use_case` | enum | `copilot_chat` / `live_note_agent` / `meeting_note` / `knowledge_sync` / `code_session` |
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
| `copilot_chat` | (none) | yes | User chat in renderer (turn runtime; the ALS default when no caller set a use case) | `packages/core/src/runtime/turns/bridges/real-usage-reporter.ts` (`reportModelUsage`); legacy runs (code-mode carve-out) still emit from `packages/core/src/runtime/legacy/engine.ts` (`streamLlm` finish-step) |
| `copilot_chat` | `scheduled` | yes | Background scheduled agent runner | `packages/core/src/agent-schedule/runner.ts:167` |
| `copilot_chat` | `file_parse` | inherits | `parseFile` builtin tool inside any chat | `packages/core/src/runtime/tools/domains/parsing.ts:179` |
| `live_note_agent` | `routing` | no | Pass 1 routing classifier (`generateObject`) | `packages/core/src/knowledge/live-note/routing.ts:93` |
| `live_note_agent` | `manual` | yes | Pass 2 agent run — user clicked Run / called the `run-live-note-agent` tool | `packages/core/src/knowledge/live-note/runner.ts:140` (createRun, `subUseCase: trigger`) |
| `live_note_agent` | `cron` | yes | Pass 2 agent run — cron expression matched | same call site |
| `live_note_agent` | `window` | yes | Pass 2 agent run — fired inside a configured time-of-day window | same call site |
| `live_note_agent` | `event` | yes | Pass 2 agent run — Pass 1 routing flagged the note for an incoming event | same call site |
| `meeting_note` | (none) | no | Meeting transcript summarizer (`generateText`) | `packages/core/src/knowledge/summarize_meeting.ts:161` |
| `knowledge_sync` | `agent_notes` | yes | Agent notes learning service | `packages/core/src/knowledge/agent_notes.ts:309` (createRun) |
| `knowledge_sync` | `tag_notes` | yes | Note tagging | `packages/core/src/knowledge/tag_notes.ts:86` (createRun) |
| `knowledge_sync` | `build_graph` | yes | Knowledge graph note creation | `packages/core/src/knowledge/build_graph.ts:253` (createRun) |
| `knowledge_sync` | `inline_task_run` | yes | Inline `@rowboat` task execution (two call sites) | `packages/core/src/knowledge/inline_tasks.ts:471, 552` (createRun) |
| `knowledge_sync` | `inline_task_classify` | no | Inline task scheduling classifier (`generateText`) | `packages/core/src/knowledge/inline_tasks.ts:673` |
| `knowledge_sync` | `pre_built` | yes | Pre-built scheduled agents | `packages/core/src/pre_built/runner.ts:43` (createRun) |
| `code_session` | (none) | yes | Code-section coding session in Rowboat mode (direct mode talks to the on-device coding agent and emits no `llm_usage`) | `packages/core/src/code-mode/sessions/service.ts` (createRun) |

##### `live_note_agent` sub-use-case shape

For the live-note feature specifically, `sub_use_case` discriminates **what kind of work happened**:

- `routing` — Pass 1 LLM classifier deciding which live notes might be relevant to an incoming event. One emit per Pass 1 batch.
- `manual` / `cron` / `window` / `event` — Pass 2 agent run, tagged with the trigger that woke it up. The runner reads its `trigger` argument (`LiveNoteTriggerType`) and passes it directly as `subUseCase`, so dashboards can break runs down by trigger source.

This means a single end-to-end event flow emits both `routing` (Pass 1) and `event` (Pass 2). A scheduled cron fire emits only `cron`. A user clicking Run emits only `manual`. There is no separate "run" sub-use-case anymore — the trigger IS the sub-use-case for Pass 2.

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
- `call_started` — `{ preset: 'voice' | 'video' | 'share' | 'practice' }` — a hands-free call began (see `apps/x/VIDEO_MODE.md`)
- `call_turn_latency` — `{ endpoint_to_submit_ms, submit_to_speak_ms, speak_to_audio_ms, total_ms }` — voice-to-voice latency breakdown for one call turn (utterance accepted → submitted → first TTS speak → audio playing)
- `search_executed` — `{ types: string[] }`
- `note_exported` — `{ format }`

### `view_opened` — feature-importance funnel

One event per view the user lands on, fired centrally from the `currentViewState` effect in `apps/renderer/src/App.tsx`. `view` is one of: `chat`, `file`, `graph`, `task`, `suggested-topics`, `meetings`, `live-notes`, `email`, `workspace`, `knowledge-view`, `chat-history`, `home`, `code`, `bg-tasks`, `apps`. Keyed on the view *type*, so switching files or threads inside a view doesn't re-fire.

This is the top of every feature funnel: unique users on `view = 'email'` ÷ all users = how many people even open email. First visit to a key view also sets a one-shot person property (`has_used_email`, `has_used_meetings`, `has_used_live_notes`, `has_used_bg_agents`, `has_used_apps`, `has_used_code`) for cohort building.

### Feature action events

All renderer events live in `apps/renderer/src/lib/analytics.ts` (typed wrappers); the emit sites are in the components named below. Events marked **(main)** are captured in `apps/main/src/ipc.ts` via `capture()` because the operation runs there.

**Email** (`components/email-view.tsx`):

- `email_thread_opened` — a thread was expanded in the list
- `email_compose_opened` — `{ mode: 'new' | 'reply' | 'replyAll' | 'forward' | 'draft' }` — a composer was opened
- `email_sent` — `{ mode, has_attachments, ai_assisted }` — `ai_assisted` is true when Write-with-AI produced a draft in that composer
- `email_ai_draft_generated` — `{ mode: 'generate' | 'rewrite' }` — the Write/Edit-with-AI bar completed
- `email_archived` / `email_trashed` — one thread archived / moved to trash
- `email_marked_unread` — explicit mark-as-unread (marking *read* fires automatically on open, so it's deliberately not tracked)
- `email_importance_changed` — `{ importance: 'important' | 'other' }` — user corrected the importance verdict
- `email_category_changed` — `{ category }` — user re-filed a thread
- `email_category_archived` — `{ category }` — bulk "archive all in category"
- `email_searched` — a search query executed (debounced, one per settled query)
- `email_instructions_saved` — standing email-agent instructions saved
- `email_sync_triggered` — manual refresh button

**Meetings** (`App.tsx`, `components/meetings-view.tsx`):

- `meeting_recording_started` — `{ has_calendar_event }` — transcription actually began (all entry points: meetings view, home, sidebar, popup funnel through one call site)
- `meeting_recording_stopped` — `{ duration_seconds }`
- `meeting_popup_action` — `{ action: 'take-notes' | 'dismiss' }` **(main)** — the "meeting detected" popup window runs without PostHog, so the action is captured in its IPC handler
- `meeting_note_opened` — a past meeting note opened from the meetings list

**Calls** (`App.tsx`):

- `call_started` — (pre-existing, above) fires on every call-button press that starts a call
- `call_ended` — `{ duration_seconds }`

**Background agents** (`components/bg-tasks-view.tsx`, `components/apps/app-detail.tsx`):

- `bg_agent_created` — `{ method: 'manual' | 'coding' | 'copilot', has_triggers }` — `copilot` means the user submitted the "describe it" form (the agent is then created by Copilot in chat)
- `bg_agent_updated` — instructions/triggers/model saved on an existing agent
- `bg_agent_toggled` — `{ active }`
- `bg_agent_run_clicked` — manual Run now
- `bg_agent_stopped` — manual stop of a run
- `bg_agent_deleted`

**Live notes** (`components/live-note-sidebar.tsx`, `components/live-notes-view.tsx`):

- `live_note_saved` — live config created or edited via the panel
- `live_note_toggled` — `{ active }`
- `live_note_run_clicked` — manual Run
- `live_note_stopped` — in-flight run stopped
- `live_note_deleted` — live config removed from the note
- `live_note_edit_with_copilot_clicked`

**Search** (`components/search-dialog.tsx`):

- `search_opened` — the palette opened
- `search_executed` — (pre-existing, above)
- `search_result_selected` — `{ type: 'knowledge' | 'chat' }`

**Apps** — all **(main)**, in `apps/main/src/ipc.ts` (pre-existing except `app_rolled_back`): `app_created`, `app_installed`, `app_uninstalled`, `app_updated`, `app_rolled_back`, `app_published`, `app_starred`, `app_deleted`. Plus renderer-side `app_opened` — `{ folder }` — an installed app's UI was opened (`components/apps/app-frame.tsx`).

**Code mode** — both **(main/core)**:

- `code_session_created` — `{ mode: 'direct' | 'rowboat', agent }` — captured in the `codeSession:create` IPC handler. This is the direct-vs-rowboat session split.
- `code_session_message_sent` — `{ mode, agent }` — one per direct-drive message (`packages/core/src/code-mode/sessions/service.ts`). Direct turns bypass the agent runtime and emit no `llm_usage`, so this is the only usage-depth signal for direct mode; Rowboat-mode depth comes from `llm_usage where use_case = code_session`.

**Billing** (`components/billing-error-dialog.tsx`):

- `billing_error_shown` — `{ kind: 'subscription_required' | 'out_of_credits' | 'subscription_inactive' }` — the paywall dialog appeared
- `billing_upgrade_clicked` — `{ kind }` — the upgrade CTA was clicked (shown → clicked = paywall conversion)

**Failures** — success events all have a failure sibling where the operation can fail after the click:

- `email_send_failed` — send returned an error or threw (`components/email-view.tsx`)
- `meeting_summarize_failed` — post-recording notes generation threw (`App.tsx`)
- `bg_agent_run_failed` / `bg_agent_run_completed` — `{ trigger: 'manual' | 'cron' | 'window' | 'event' }` **(core)** — every background-agent run settles as exactly one of these (`packages/core/src/background-tasks/runner.ts`), giving a failure *rate* across all trigger sources, not just manual clicks

**Misc**:

- `note_created` — new note from the sidebar/knowledge actions (`App.tsx`)
- `note_edited` — a note's autosave wrote changed content; deduped to one event per note per app session (so it counts "notes touched", not keystroke bursts)
- `settings_opened` — `{ tab }` — settings dialog opened (tab = the initial tab)
- `settings_tab_changed` — `{ tab }`
- `onboarding_completed` — the onboarding flow finished (`App.tsx`)

### Mobile app events

Captured by the iOS app (`apps/mobile/src/lib/analytics.ts`, typed wrappers like the renderer's). Every event carries `platform: 'mobile'`, the counterpart of desktop's `platform: 'desktop'`, so the shared project separates surfaces. The key is injected at build time via `EXPO_PUBLIC_POSTHOG_KEY` (`EXPO_PUBLIC_POSTHOG_HOST` optional); without it every call is a no-op — dev builds send nothing.

- `mobile_paired` — `{ method: 'qr' | 'manual' | 'dev-link' }` — pairing with a rowboat-server succeeded
- `mobile_unpaired` — `{ reason: 'user' | 'unauthorized' }` — `unauthorized` = the server key was rotated out from under the phone
- `mobile_message_sent` — a chat message sent from the phone
- `mobile_reconnected` — the WS feed recovered after a disconnect
- `mobile_note_opened` — a note opened in the read-only browser
- `mobile_voice_used` — reserved; fires once voice ships in the dev build

## Person properties

Persistent across sessions for the same user. Set via `posthog.people.set` or as the `properties` arg to `identify`.

| Property | Set by | Notes |
|---|---|---|
| `email` | main on identify | From `/v1/me`; powers PostHog cohort match + integrations |
| `plan`, `status` | main on identify | Subscription state |
| `api_url` | both processes (init + identify) | Distinguishes prod / staging / custom — assign meaning in PostHog dashboard. `https://api.x.rowboatlabs.com` = production |
| `platform` | both processes (init + identify) | Always `desktop` from this app; segments desktop users from any other surface |
| `app_version` | both processes (init + identify) | Electron app version; also included automatically on every event |
| `signed_in` | renderer | `true` while rowboat OAuth is connected |
| `{provider}_connected` | renderer | One of `gmail`, `calendar`, `slack`, `rowboat` |
| `total_notes` | renderer (init) | Workspace size signal |
| `has_used_search`, `has_used_voice` | renderer | One-shot first-use flags |
| `has_used_email`, `has_used_meetings`, `has_used_live_notes`, `has_used_bg_agents`, `has_used_apps`, `has_used_code` | renderer (`view_opened`) | One-shot first-use flags per feature view |
| `has_created_bg_agent` | renderer | One-shot: user set up a background agent |

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
