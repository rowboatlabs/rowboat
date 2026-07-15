# Internal Docs — Start Here

The single index of every internal engineering doc in this repo. If you're
about to change something and wonder "is there a doc for this?" — the
answer is on this page. **Rule: when a PR changes behavior a doc describes,
update the doc in the same PR, and register any new doc here.**

## Runbooks — "X happened, what do I do?"

| When | Read |
|------|------|
| A new LLM ships / retuning any curated model default | [`apps/x/MODELS.md`](apps/x/MODELS.md) |

## Feature deep-dives — "how does X work and why?"

| Feature | Read |
|---------|------|
| Sub-agents — spawn-agent, headless child turns, model tiers, `subagentModels` config, sign-in seeding | [`apps/x/SUBAGENTS.md`](apps/x/SUBAGENTS.md) |
| Live Notes — `live:` frontmatter, self-updating notes, panel UI, prompts | [`apps/x/LIVE_NOTE.md`](apps/x/LIVE_NOTE.md) |
| Calls (video mode) — call engine, four presets, frame pipeline, prompts | [`apps/x/VIDEO_MODE.md`](apps/x/VIDEO_MODE.md) |
| Analytics — PostHog event catalog, person properties, adding events | [`apps/x/ANALYTICS.md`](apps/x/ANALYTICS.md) |

## Architecture & design specs

| Area | Read |
|------|------|
| Turn runtime — event-sourced turns, tool execution, permissions, recovery, `npm run inspect` | [`apps/x/packages/core/docs/turn-runtime-design.md`](apps/x/packages/core/docs/turn-runtime-design.md) |
| Sessions — session JSONL, turn refs, context assembly | [`apps/x/packages/core/docs/session-design.md`](apps/x/packages/core/docs/session-design.md) |

## Plans (point-in-time; may be stale after shipping)

| Plan | Read |
|------|------|
| Apps v1 | [`apps/x/APPS_V1_PLAN.md`](apps/x/APPS_V1_PLAN.md) |
| Mini Apps | [`apps/x/MINI_APPS_PLAN.md`](apps/x/MINI_APPS_PLAN.md) |
| Code-mode engines | [`apps/x/CODE_MODE_ENGINES_PLAN.md`](apps/x/CODE_MODE_ENGINES_PLAN.md) |

## Setup & reference

| What | Read |
|------|------|
| AI-agent context, build commands, monorepo map | [`CLAUDE.md`](CLAUDE.md) |
| Google OAuth setup | [`google-setup.md`](google-setup.md) |

## Adding a doc

1. Write it next to the code it describes (`apps/x/FEATURE.md`, or a
   `docs/` dir inside the package).
2. Pick the right kind: **runbook** (checklist for a recurring event) vs
   **deep-dive** (how a feature works + design decisions) vs **spec**.
3. Add a row HERE, and — if AI sessions should auto-load it when touching
   that area — a row in CLAUDE.md's Feature Deep-Dives table too.
