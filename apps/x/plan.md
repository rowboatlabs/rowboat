# Sub-Agent Model Tiers — Implementation Plan

Branch: `feat/subagent-model-tiers` (off `main` @ `4182794b`)

## Problem

Spawned sub-agents always inherit the parent turn's model
(`runtime/assembly/spawn-agent.ts`). A copilot running a frontier model
fans out children on that same frontier model, even for routine
extraction/summarization work. The `model`/`provider` spawn params don't
help in practice: the parent LLM can't see which models the user has
configured, so it either omits them or guesses wrong.

## Evidence (local turn history, 7,935 turns)

- **100% of real spawn-agent calls inherited an expensive model.** All 3
  observed spawns ran inline worker children on `claude-sonnet-4.6`
  (inherited from a background-task parent).
- **Children get ~zero prompt-cache benefit.** Parents ran 84–90% cached
  input; children ran ~0% (fresh system prompts) — so child tokens are
  disproportionately expensive on frontier models.
- **Repricing the observed children at flash-lite is 10.3× cheaper**
  ($0.67 → $0.066 for the observed workload; models.dev pricing).
  A typical research child (60k in / 6k out) is 6× cheaper on flash-lite
  vs the gateway default flash ($0.144 → $0.024).
- **The light tier already carries production load:** 81% of all local
  tokens run on `gemini-3.1-flash-lite` today (note_creation, KG agents,
  auto-permission classifier) — the curated-cheap-tier pattern is proven
  in this codebase.

## Prior art (researched)

- **Claude Code**: LLM passes a semantic model alias (`haiku`/`sonnet`/
  `opus`) per spawn; runtime resolves alias → concrete model. Resolution:
  env var → spawn param → agent-definition pin → inherit. Verified live.
- **Codex / Cursor / OpenCode / Goose**: inherit-by-default, static
  per-agent-definition model pins; the LLM never picks raw model ids.
- **Amp**: users/vendor pick semantic tiers, vendor binds models per role;
  "Oracle" = curated *stronger* model for hard analysis.
- **Cursor**: billing-aware routing — cheap plans force subagents onto
  their in-house Composer model.

## Design

One semantic knob, resolved differently per auth mode; every path falls
back to "inherit the parent model."

1. `spawn-agent` gains an optional `tier` input: `light | medium | heavy`.
   The copilot LLM picks the tier from task difficulty (same mental model
   as `reasoning_effort`). It never picks model ids. Omitted tier = the
   parent model.
2. Tier→model mapping is **user config**, not code (per CTO review):
   `subagentModels: { light?, medium?, heavy? }` in `models.json`, each a
   provider-qualified `ModelRef` — same format as the existing category
   overrides. `getSubagentModel(tier)` reads it and returns `null`
   (= inherit parent) when the tier is unset, or when the ref points at the
   gateway while signed out. Editable in settings → models (post-onboarding
   surface, both signed-in and BYOK configs can use it).
3. **Sign-in seeding:** when a Rowboat sign-in completes, suggested
   defaults are written ONCE — only if `subagentModels` is absent, so
   re-sign-ins never clobber user edits (the settings Save also always
   writes the key, marking "user has chosen"):
   - `light` → `google/gemini-3.1-flash-lite`
   - `medium` → `anthropic/claude-sonnet-4.6`
   - `heavy` → `anthropic/claude-opus-4.8`
4. Model precedence in `runSpawnedAgent`: tier mapping → parent model.
   The raw `model`/`provider` spawn inputs are REMOVED from the schema —
   live testing showed the copilot volunteering explicit ids out of habit
   ("claude-sonnet-4-6" on a gateway parent), which silently defeated the
   tier. The LLM only ever sizes the task; ids live in stored-agent config
   (matches Claude Code/Codex, which never expose raw ids to the model).
   Tier-mapping failures degrade silently to inherit; a spawn never fails
   because a tier couldn't be mapped. Empty-string inputs (`agent_id: ""`
   etc., another observed model habit) normalize to absent.
5. **BYOK default: no behavior change.** With no `subagentModels`
   configured, children inherit the parent model. BYOK users can now opt
   in to tiering explicitly via the same config key.
6. Copilot prompt: one guidance block steering `tier` alongside
   `reasoning_effort` (light = routine extraction/search/summaries,
   heavy = hard analysis; omit to inherit).

Guards worth keeping explicit:
- `parentProvider !== "rowboat"` → inherit, even when signed in: a
  signed-in user who deliberately set a BYOK default keeps children on it.
- Stored agents' own `model`/`provider` config continues to work
  unchanged (the Claude-Code-style "definition pin" — already supported
  by `RealAgentResolver`).

## Changes

| File | Change |
|---|---|
| `packages/core/src/models/defaults.ts` | 2 constants + `getSubagentModel()` |
| `packages/core/src/runtime/assembly/spawn-agent.ts` | `tier` in schema; tier step in model resolution; description update |
| `packages/core/src/runtime/assembly/copilot/instructions.ts` | tier guidance next to reasoning-effort guidance |
| `packages/core/src/runtime/assembly/spawn-agent.test.ts` | tier resolution cases (mapped / null / explicit-model-wins / standard / resolver-throws) |

## Out of scope (deliberate)

- BYOK tier mapping (`subagentModels` config, models.dev sibling lookup)
- Per-child usage rollup in session UI
- Durable/resumable background children
- Depth >1 / orchestrator patterns

## Verification

- `cd apps/x && npm run deps && npm run lint && npm run typecheck`
- `vitest` on `packages/core` (spawn-agent tests)
- Manual: dev app, signed-in — spawn a light-tier child, confirm the child
  turn's `turn_created` event records `google/gemini-3.1-flash-lite`.
