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
| `use_case` | enum | Defined by `UseCase` in `packages/shared/src/analytics.ts` |
| `sub_use_case` | string? | Refines `use_case` — see taxonomy table below |
| `agent_name` | string? | Present when the call goes through an agent run; derived from the turn's immutable resolved agent id and omitted for direct `generateText`/`generateObject` |
| `model` | string | e.g. `claude-sonnet-4-6` |
| `provider` | string | The provider FLAVOR: `rowboat` = cloud LLM gateway, `codex` = ChatGPT subscription, else the BYOK flavor (`openai`, `anthropic`, `ollama`, …). Call sites pass instance ids; `captureLlmUsage` maps id → flavor so charts never fracture if user-named provider instances ship (ids never leave the app) |
| `input_tokens` | number | |
| `output_tokens` | number | |
| `total_tokens` | number | |
| `cached_input_tokens` | number? | When the provider reports it |
| `reasoning_tokens` | number? | When the provider reports it |

For the turn runtime, `{ useCase, subUseCase }` is persisted on
`turn_created.analytics`. Every advance restores that context and combines it
with `turn_created.agent.resolved.agentId`, so initial calls, permission
continuations, and crash recovery all have identical attribution. The Rowboat
gateway receives the same values through `x-rowboat-use-case`,
`x-rowboat-sub-use-case`, and `x-rowboat-agent-name`.

#### Use-case taxonomy

Every `llm_usage` emit point in the codebase:

| `use_case` | `sub_use_case` | `agent_name`? | Where | File:line |
|---|---|---|---|---|
| `copilot_chat` | (none) | yes | User chat in renderer (the durable default when no caller sets a use case) | `packages/core/src/runtime/turns/bridges/real-usage-reporter.ts` (`reportModelUsage`); legacy runs (now mini-apps host API only) still emit from `packages/core/src/runtime/legacy/engine.ts` (`streamLlm` finish-step) |
| `copilot_chat` | `scheduled` | yes | Background scheduled agent runner | `packages/core/src/agent-schedule/runner.ts:167` |
| `copilot_chat` | `file_parse` | inherits | `parseFile` builtin tool inside any chat | `packages/core/src/runtime/tools/domains/parsing.ts:179` |
| `copilot_chat` | `chat_title` | no | Auto-naming a chat from its first user message (`generateText`) | `packages/core/src/knowledge/generate_title.ts` |
| `live_note_agent` | `routing` | no | Pass 1 routing classifier (`generateObject`) | `packages/core/src/knowledge/live-note/routing.ts:93` |
| `live_note_agent` | `manual` | yes | Pass 2 agent run — user clicked Run / called the `run-live-note-agent` tool | `packages/core/src/knowledge/live-note/runner.ts` (`startHeadlessAgent`, `subUseCase: trigger`) |
| `live_note_agent` | `cron` | yes | Pass 2 agent run — cron expression matched | same call site |
| `live_note_agent` | `window` | yes | Pass 2 agent run — fired inside a configured time-of-day window | same call site |
| `live_note_agent` | `event` | yes | Pass 2 agent run — Pass 1 routing flagged the note for an incoming event | same call site |
| `meeting_note` | (none) | no | Meeting transcript summarizer (`generateText`) | `packages/core/src/knowledge/summarize_meeting.ts:161` |
| `knowledge_sync` | `agent_notes` | yes | Agent notes learning service | `packages/core/src/knowledge/agent_notes.ts` (`runWhenPossible`) |
| `knowledge_sync` | `tag_notes` | yes | Note tagging | `packages/core/src/knowledge/tag_notes.ts` (`runWhenPossible`) |
| `knowledge_sync` | `build_graph` | yes | Knowledge graph note creation | `packages/core/src/knowledge/build_graph.ts` (`runWhenPossible`) |
| `knowledge_sync` | `curation` | yes | Knowledge-note curation | `packages/core/src/knowledge/build_graph.ts` (`runWhenPossible`) |
| `knowledge_sync` | `inline_task_run` | yes | Inline `@rowboat` task execution (two call sites) | `packages/core/src/knowledge/inline_tasks.ts` (`runWhenPossible`) |
| `knowledge_sync` | `inline_task_classify` | no | Inline task scheduling classifier (`generateText`) | `packages/core/src/knowledge/inline_tasks.ts:673` |
| `knowledge_sync` | `pre_built` | yes | Pre-built scheduled agents | `packages/core/src/pre_built/runner.ts` (`runWhenPossible`) |
| `code_session` | (none) | yes | Code-section coding session — an ordinary chat session driving `code_agent_run` (direct drive removed 2026-08) | `packages/core/src/code-mode/sessions/service.ts` (create) + background code tasks |

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

### Model-provider lifecycle

Privacy rules (enforced in `packages/core/src/analytics/model-providers.ts`): only provider **flavors** are captured — never instance ids (future-proofing for user-named instances), never `apiKey`/`headers`, and never `baseURL` (local endpoints can carry internal hostnames). Model ids are allowed.

- `llm_provider_connected` / `llm_provider_disconnected` — `{ flavor }` — one event family across every surface. BYOK fires from `FSModelConfigRepo.setProvider` (new entries only — key rotation is not a connect) / `removeProvider`; `rowboat` from sign-in/out (`apps/main/src/oauth-handler.ts`); `codex` from ChatGPT sign-in/out (`apps/main/src/ipc.ts`).
- `llm_initial_model_selected` — `{ flavor, model, recommended, task_overrides_seeded, source: 'connect' | 'onboarding' | 'sign_in' }` — a connect seeded the assistant model (only when none was configured). `recommended: false` = first-listed fallback; the hit rate measures backend recommendation quality. `task_overrides_seeded` counts the per-task recommendations written alongside (the server-controlled lite-tier task models — 0 when the provider has none). Emit points: `apps/renderer/src/components/settings/providers-section.tsx` (connect/onboarding) and `packages/core/src/models/rowboat-selection.ts` / `chatgpt-selection.ts` (sign-in).
- `models_config_migrated` — `{ had_assistant, materialized_overrides, provider_count }` — one-shot per install at the models.json v1 → v2 boot migration (`FSModelConfigRepo.ensureConfig`); rollout health for the schema change.

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

### Client auto-update funnel

The desktop client's own updates — distinct from the in-app apps feature, which owns `app_updated`:

- `update_prompted` — renderer (`apps/renderer/src/lib/analytics.ts`): the "Update available" card was shown for a staged update
- `update_restarted` — main (`apps/main/src/updater.ts`), `{ from, to? }`: the user clicked restart-to-update (`to` may be missing when the update feed doesn't report the release name)
- `update_failed` — main (`apps/main/src/updater.ts`), `{ message }`: the auto-updater errored (includes network errors for now)
- `client_updated` — main (`apps/main/src/ipc.ts`), `{ from, to }`: first launch on a newer version (fires once per update, whatever the restart path; downgrades restamp silently and don't fire)
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

**Spaces** (`components/spaces/*`, `components/spaces-view.tsx`):

- `spaces_message_posted` — `{ kind: 'general' | 'topic', mentions_rowboat }` — a human posted in a space: to general, or into a topic
- `spaces_reaction_toggled` — `{ action: 'add' | 'remove' }` — a human toggled an emoji reaction on a message
- `spaces_message_deleted` — a human deleted (tombstoned) their own message
- `spaces_topic_started` — replying to a general message created a new topic from it
- `spaces_fold_requested` — "Fold into file…" asked the person's agent to fold a topic's decision into a file (the agent's resulting change is an `llm_usage` + a change-set on the org, not a renderer event)
- `spaces_tab_viewed` — `{ tab: 'general' | 'topics' | 'files' }` — the segmented control inside a space

The adoption metric for the chat-first spike is `spaces_message_posted` where `kind = general`, per day, vs. the team Slack channel.

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

**Code mode** — **(main)**:

- `code_session_created` — `{ agent }` — captured in the `codeSession:create` IPC handler. All code sessions are Rowboat-driven (direct drive was removed 2026-08); usage depth comes from `llm_usage where use_case = code_session`. (`code_session_message_sent` and the `mode` property died with direct drive.)

**Billing** (`components/billing-error-dialog.tsx`):

- `billing_error_shown` — `{ kind: 'subscription_required' | 'out_of_credits' | 'subscription_inactive' }` — the paywall dialog appeared
- `billing_upgrade_clicked` — `{ kind }` — the upgrade CTA was clicked (shown → clicked = paywall conversion)

**Failures** — success events all have a failure sibling where the operation can fail after the click:

- `email_send_failed` — send returned an error or threw (`components/email-view.tsx`)
- `meeting_summarize_failed` — post-recording notes generation threw (`App.tsx`)
- `bg_agent_run_failed` — `{ trigger: 'manual' | 'cron' | 'window' | 'event', error: string }` **(core)** — emitted when a background-agent run fails; `error` contains the normalized failure message
- `bg_agent_run_completed` — `{ trigger: 'manual' | 'cron' | 'window' | 'event' }` **(core)** — emitted when a background-agent run succeeds; together these events give a failure *rate* across all trigger sources, not just manual clicks

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
| `llm_provider_flavors` | main | Sorted array of connected provider flavors incl. `rowboat`/`codex` from auth state (e.g. `["openai","openrouter","rowboat"]`). Synced on every launch and after any provider/assistant change (`packages/core/src/analytics/model-providers.ts`) |
| `llm_provider_count` | main | Size of `llm_provider_flavors` |
| `assistant_model`, `assistant_model_flavor` | main | The configured primary model (complements `llm_usage`, which reports actual usage). Absent until an assistant is configured |

## How to add a new event

1. **Naming**: `snake_case`, `[object]_[verb]` shape (e.g. `note_exported`, not `exportedNote`). Matches PostHog convention.
2. **Pick the right helper**:
   - LLM token usage → `captureLlmUsage()` from `@x/core/dist/analytics/usage.js`. Always include `useCase`; add `subUseCase` if it refines an existing top-level case.
   - Anything else from main → `capture()` from `@x/core/dist/analytics/posthog.js`.
   - Anything else from renderer → add a typed wrapper to `apps/renderer/src/lib/analytics.ts` and call it from the UI code (don't call `posthog.capture()` directly from components).
3. **If it's a new LLM call site**:
   - Goes through the turn runtime? Pass `useCase` (and optionally `subUseCase`) to `sessions.sendMessage` or the headless runner. It is persisted on `turn_created`, and the runtime emits once per completed model call.
   - Goes through legacy `createRun`? Pass the same fields to the create call.
   - Direct `generateText` / `generateObject`? Call `captureLlmUsage` after the call with `model`, `provider`, `usage` from the result.
   - Inside a builtin tool? Call `getCurrentUseCase()` from `analytics/use_case.ts`; the turn runtime restores the persisted context around every advance.
4. **Update this file in the same PR.** That's the contract — without it, dashboards and downstream consumers drift.

## How to add a new use-case sub-case

- **New `sub_use_case` under an existing top-level case**: just pick a string and add a row to the taxonomy table above. No code changes beyond the call site.
- **New top-level `use_case`**: edit the `UseCase` enum in `packages/shared/src/analytics.ts`. Then update this doc.

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
| `packages/shared/src/analytics.ts` | Shared use-case taxonomy and durable turn analytics schema |
| `apps/renderer/src/lib/analytics.ts` | Renderer event wrappers |
| `apps/renderer/src/hooks/useAnalyticsIdentity.ts` | Renderer identify/reset on OAuth events |
| `apps/main/src/oauth-handler.ts` | Main-side identify/reset/sign-in/sign-out events |
| `apps/main/src/main.ts` | `before-quit` hook flushes queued events |
| `packages/shared/src/ipc.ts` | `analytics:bootstrap` IPC channel definition |
| `apps/main/src/ipc.ts` | `analytics:bootstrap` handler + forwards `userId` on `oauth:didConnect` |
| `apps/main/bundle.mjs` | Bakes `POSTHOG_KEY`/`POSTHOG_HOST` into packaged `main.cjs` |
