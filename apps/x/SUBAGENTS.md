# Sub-Agents — Feature Deep-Dive

Spawned sub-agents: the copilot delegates a self-contained task to an
isolated, headless child turn and gets back only the final answer. This doc
is the source of truth for how spawning works, how the model-tier system
picks the child's model, and why it's designed the way it is.

History: shipped in PR #747 (`feat/subagent-model-tiers`, July 2026). The
tier design went through one live-testing revision (raw model ids removed
from the tool schema) and one CTO review (hardcoded curated tiers →
user-configurable `subagentModels` config, seeded at sign-in).

## Product flow

1. The copilot decides to delegate (prompt guidance below) and calls the
   `spawn-agent` builtin with a self-contained `task`, optionally a
   `name`/`instructions` (inline specialist) or `agent_id` (stored agent),
   `tools`, `max_model_calls`, `reasoning_effort`, and a `tier`.
2. The child runs as a standalone headless turn: no session, no human,
   auto-permission (LLM classifier). The parent's abort cancels it.
3. The UI shows a collapsed card (name + task) that expands into the
   child's **live transcript**; the parent receives only the final text.
4. Cost: children get ~0% prompt-cache hits (fresh system prompt), so the
   tier system exists to stop routine children from burning frontier-model
   tokens. Measured before tiers: ~10x overpay on real spawn workloads.

## The tier system

One semantic knob. The spawning LLM judges **task difficulty**, never
model ids; the user's config owns the tier→model mapping; every unmappable
case inherits the parent model.

- `tier: "light"` — routine extraction, search, summarization
- `tier: "medium"` — multi-step comparison or synthesis
- `tier: "heavy"` — hard analysis, high-stakes synthesis
- omitted — child runs on the conversation's model

Resolution (`getSubagentModel` in `packages/core/src/models/defaults.ts`):

1. Read `subagentModels: { light?, medium?, heavy? }` from
   `~/.rowboat/config/models.json` (each a `{provider, model}` ref, same
   format as the other category overrides).
2. Tier unset in config → `null` → child inherits the parent model.
3. Ref points at the `rowboat` gateway while signed out → `null` (gateway
   needs auth; same rule as every rowboat model ref).
4. Resolver errors are swallowed in `runSpawnedAgent` — a spawn never
   fails because of its tier.

Per-user-mode behavior:

| User | Behavior |
|---|---|
| Signed in | Tiers seeded once at sign-in: light → `google/gemini-3.1-flash-lite`, medium → `anthropic/claude-sonnet-4.6`, heavy → `anthropic/claude-opus-4.8`. Retunable in settings. |
| BYOK only | Never seeded → all spawns inherit the parent model (pre-tier behavior). Opt in by setting tiers in settings or models.json. |
| Signed in + BYOK | Seeded gateway defaults; any tier can point at any configured provider (gateway, OpenRouter, Ollama, …). |

Sign-in seeding (`seedSubagentModelDefaults`, called from the rowboat
branch of `apps/main/src/oauth-handler.ts`): writes the suggested defaults
**only when `subagentModels` is absent**. The settings Save always writes
the key (even all-unset), marking "user has chosen" — so a re-sign-in
never clobbers user edits, including an explicit "no tiering" choice.

### Design decisions (and why)

- **The LLM never picks model ids.** The original schema had raw
  `model`/`provider` inputs with explicit-wins precedence. Live testing
  showed the copilot volunteering arbitrary ids out of habit
  (`claude-sonnet-4-6` on a gateway parent), silently defeating the tier;
  prompt guidance alone did not stop it. The fields were removed — Claude
  Code and Codex likewise never expose raw ids to the orchestrating model.
  Stored agents still pin models in their own config.
- **Config over constants** (CTO review): retuning a tier must not require
  an app release, and BYOK users deserve the same knob. The curated models
  survive only as sign-in seed values.
- **Inherit-parent as the universal fallback** matches industry practice
  (Claude Code, Codex, Cursor, Goose all default subagents to inherit).
- **Depth cap of 1** (children can't spawn) is enforced in three places:
  both agent resolvers strip the spawn tool, and `runSpawnedAgent` refuses
  child-shaped parents.
- **Children get the current date** appended to their task message. A
  fresh light-tier child once searched "October 2024" news in July 2026 —
  children start with zero context, including the date. The UI still shows
  the clean task (the stamp rides only on the model-visible message).
- **Empty-string inputs normalize to absent** — models routinely send
  `"agent_id": ""` instead of omitting; an `""` slipped past `??` and
  blanked the child's display name.

## Key files

| Concern | File |
|---|---|
| Tool schema + execution (`runSpawnedAgent`) | `packages/core/src/runtime/assembly/spawn-agent.ts` |
| Tier resolution + sign-in seeding | `packages/core/src/models/defaults.ts` (`getSubagentModel`, `seedSubagentModelDefaults`) |
| `subagentModels` config schema | `packages/shared/src/models.ts` (`LlmModelConfig`), patch type in `packages/core/src/models/repo.ts`, IPC in `packages/shared/src/ipc.ts` (`models:updateConfig`) |
| Seeding hook (sign-in completion) | `apps/main/src/oauth-handler.ts` (rowboat branch) |
| Settings UI (tier dropdowns) | `apps/renderer/src/components/settings-dialog.tsx` (`RowboatModelSettings`) |
| Headless child runner | `packages/core/src/runtime/assembly/headless.ts` |
| Inline-agent resolution + default tool profile | `packages/core/src/runtime/turns/bridges/inline-agent-resolver.ts` |
| Stored-agent resolution (subagent flag strips spawn tool) | `packages/core/src/runtime/turns/bridges/real-agent-resolver.ts` |
| Tool-registry handler (parent→child progress link) | `packages/core/src/runtime/turns/bridges/real-tool-registry.ts` |
| UI card with live child transcript | `apps/renderer/src/components/sub-agent-block.tsx` (used by `App.tsx` and `chat-sidebar.tsx`) |
| Tests | `packages/core/src/runtime/assembly/spawn-agent.test.ts` |

## Prompts catalog

- **Tool description** — `SPAWN_AGENT_DESCRIPTION` in `spawn-agent.ts`:
  when to spawn, tier/effort guidance, depth cap.
- **Copilot guidance** — `runtime/assembly/copilot/instructions.ts`,
  "Sub-Agents (parallel & heavy work)" section: strong signals, the
  mechanical trigger (expecting >2-3 web searches → spawn one
  `tier: light` researcher), do-NOT-spawn list, reasoning-effort and tier
  paragraphs. Verified live: a research prompt that ran 11 inline searches
  on the parent model now spawns a single light child (~24x cheaper).
- **Default worker instructions** — `defaultWorkerInstructions()` in
  `spawn-agent.ts`: system prompt for task-only inline workers.

## Durable data

- Parent→child link: one `tool_progress` event
  `{kind: "subagent", childTurnId, agentName, task}` on the parent turn —
  the only linkage; the UI's live transcript hangs off it.
- The child turn's `turn_created` event records the resolved model — the
  ground truth when verifying tier behavior
  (`~/.rowboat/storage/turns/YYYY/MM/DD/<turnId>.jsonl`).

## Future work (deliberately out of scope in v1)

- Durable/background children (restart survivability; async suspension)
- Per-child usage rollup in the session UI (usage is already in the tool
  result envelope)
- Stored-agent discovery for `agent_id` (nothing enumerates spawnable
  agents to the model today)
- Structured output (`output_schema`) for child answers
- Aggregate fan-out guardrails (child-count cap, shared token budget,
  wall-clock timeout)
- Gateway-side symbolic tier ids (retune signed-in defaults server-side,
  no app release)
