# Model Curation Runbook

**Read this whenever a new model ships (or one is deprecated) and we want
the app to use it.** This is the checklist of every place a model id is
hardcoded or curated, what each one controls, and the gotchas that bite.

## The checklist

When adopting a new model, walk this table top to bottom and decide for
each row: update, or leave.

| # | What | Where | Used for |
|---|------|-------|----------|
| 1 | `SIGNED_IN_DEFAULT_MODEL` | `packages/core/src/models/defaults.ts` | Signed-in assistant/chat default |
| 2 | `SIGNED_IN_KG_MODEL` | same file | Knowledge-graph agents (note_creation etc.) — always-on, high volume |
| 3 | `SIGNED_IN_LIVE_NOTE_AGENT_MODEL` | same file | Live-note agent + background tasks (via `getBackgroundTaskAgentModel`) |
| 4 | `SIGNED_IN_AUTO_PERMISSION_DECISION_MODEL` | same file | Auto-permission classifier (runs on every headless turn) |
| 5 | `SIGNED_IN_SUBAGENT_LIGHT/MEDIUM/HEAVY_MODEL` | same file | **Seed values only** for sub-agent tiers (see gotcha A) |
| 6 | BYOK fallback default (`model: "gpt-5.4"`) | `packages/core/src/models/repo.ts` (`defaultConfig`) | First-run models.json when signed out |
| 7 | Bundled models.dev snapshot | `packages/core/src/models/models-dev.ts` | Offline fallback catalog (pricing/limits); live cache at `~/.rowboat/config/models.dev.json` refreshes itself |

Also check (usually no change needed):
- `packages/core/src/models/reasoning.ts` — per-provider reasoning-effort
  mapping; new providers/model families sometimes need a case.
- `packages/core/src/models/prompt-caching.ts` — caching behavior is
  per-provider; verify a new family caches as expected.
- Settings dropdowns need no update — they list the gateway catalog +
  configured BYOK providers dynamically.

## Gotchas (the reasons this doc exists)

**A. Sub-agent tier seeds do NOT retro-apply.** The tier constants (#5)
are written into the user's `models.json` **once, at Rowboat sign-in, and
only if `subagentModels` is absent**. Changing the constants affects new
sign-ins only. Existing users keep whatever is in their config until they
change it in settings themselves. If a tier retune must reach existing
users, that needs a migration (or the future gateway-side symbolic-id
mechanism — see SUBAGENTS.md future work).

**B. Verify the model exists on the gateway before curating it.** There is
no startup validation of these constants — a wrong id fails at the first
model call. We shipped `anthropic/claude-sonnet-5` once; it wasn't on the
gateway. Check the gateway catalog (settings dropdowns, or
`models:list` → provider `rowboat`) first. Gateway ids are
`vendor/model` (`google/gemini-3.5-flash`, `anthropic/claude-opus-4.8`).

**C. Cheap-tier roles need verified tool calling.** Roles #2-#5(light) run
agentic multi-step tool loops on lite-tier models. Before downtiering,
verify the candidate at tool calling — flash-lite was only serviceable for
KG after prompt hardening (see the comment above `SIGNED_IN_KG_MODEL`).
Also remember lite models know nothing implicitly (spawned children get a
date stamp for exactly this reason).

**D. Category overrides beat curated defaults.** Users who ever set
`knowledgeGraphModel` / `liveNoteAgentModel` / `subagentModels` /
`defaultSelection` in models.json keep their choice; curated constants
only apply where the user hasn't chosen. Don't expect a constants bump to
change every install's behavior.

**E. Pricing sanity check.** Pull the new model's cost from the models.dev
cache (`~/.rowboat/config/models.dev.json`) and compare against the role's
volume. #2 and #4 are the high-volume always-on roles — a pricier model
there multiplies across thousands of turns/day.

## Verification after a change

```bash
cd apps/x && npm run deps && npm run typecheck
cd packages/core && npx vitest run
```

Then in the dev app, exercise the changed role once and confirm the turn's
`turn_created` event records the new model
(`~/.rowboat/storage/turns/YYYY/MM/DD/*.jsonl`, first line,
`agent.resolved.model`).

## Related docs

- `SUBAGENTS.md` — the sub-agent tier system end to end
- `CLAUDE.md` → "LLM configuration" — models.json schema basics
