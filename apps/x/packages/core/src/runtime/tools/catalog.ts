import { z } from "zod";
import { resolveSkill, availableSkills, skillToolNames, setBuiltinToolsSkillTools } from "../assembly/skills/index.js";
import { COPILOT_BASE_TOOLS } from "../assembly/copilot/base-tools.js";
import { builtinToolDescriptor } from "./descriptors.js";
import { TOOL_ADDITIONS_KEY } from "./tool-additions.js";
import type { ToolDescriptor } from "@x/shared/dist/turns.js";
import { SPAWN_AGENT_TOOL_NAME } from "@x/shared/dist/turns.js";
import { SPAWN_AGENT_DESCRIPTION, SpawnAgentInput } from "../assembly/spawn-agent.js";
import type { ToolContext } from "./exec-tool.js";
import { fileTools } from "./domains/files.js";
import { parsingTools } from "./domains/parsing.js";
import { agentAnalysisTools } from "./domains/agent-analysis.js";
import { mcpTools } from "./domains/mcp.js";
import { shellTools } from "./domains/shell.js";
import { codeAgentRunTools, codeTaskTools } from "./domains/code.js";
import { browserTools } from "./domains/browser.js";
import { appNavigationTools, appDataTools } from "./domains/app.js";
import { webSearchTools, fetchUrlTools } from "./domains/web.js";
import { memoryTools } from "./domains/memory.js";
import { composioTools } from "./domains/composio.js";
import { modelTools } from "./domains/models.js";
import { liveNoteTools } from "./domains/live-note.js";
import { backgroundTaskTools } from "./domains/background-tasks.js";
import { notificationTools } from "./domains/notifications.js";
import { BuiltinToolsSchema } from "./types.js";
export { coalesceCodeRunEvents } from "./domains/code.js";

// The builtin-tool catalog, assembled from domain modules
// (./builtin-tools/*). SPREAD ORDER IS LOAD-BEARING: catalog key order is
// the order tools are declared to the model — provider-payload bytes inside
// the cached prompt prefix — and preserves the historical monolith order
// verbatim, including the interleaves (code/app/web domains contribute two
// fragments each). Do not alphabetize or regroup; the key-order test in
// builtin-tools.test.ts pins it. loadSkill and spawn-agent stay here:
// loadSkill is catalog infrastructure (it attaches other entries' tools),
// spawn-agent is the legacy-path shim for the turn runtime's dedicated
// handler.
export const BuiltinTools: z.infer<typeof BuiltinToolsSchema> = {
    loadSkill: {
        description: "Load a Rowboat skill definition into context by fetching its guidance string",
        inputSchema: z.object({
            skillName: z.string().describe("Skill identifier or path (e.g., 'workflow-run-ops' or 'src/runtime/assembly/skills/workflow-run-ops/skill.ts')"),
        }),
        execute: async ({ skillName }: { skillName: string }) => {
            const resolved = resolveSkill(skillName);

            if (!resolved) {
                return {
                    success: false,
                    message: `Skill '${skillName}' not found. Available skills: ${availableSkills.join(", ")}`,
                };
            }

            // The skill's declared tools ride the reserved additions key: the
            // turn runtime records a durable tools_extended event and the
            // model gets them as NATIVE tool definitions on its next call —
            // never as schema text in this result. attachedTools names them
            // so the model knows the capability landed.
            const additions = await skillToolAdditions(resolved.id);
            return {
                success: true,
                skillName: resolved.id,
                path: resolved.catalogPath,
                content: resolved.content,
                ...(additions.length > 0
                    ? {
                          attachedTools: additions.map((tool) => tool.name),
                          [TOOL_ADDITIONS_KEY]: {
                              source: resolved.id,
                              tools: additions,
                          },
                      }
                    : {}),
            };
        },
    },

    ...fileTools,
    ...parsingTools,
    ...agentAnalysisTools,
    ...mcpTools,
    ...shellTools,
    ...codeAgentRunTools,
    ...browserTools,
    ...appNavigationTools,
    ...webSearchTools,
    ...memoryTools,
    ...composioTools,
    ...appDataTools,
    ...modelTools,
    ...fetchUrlTools,
    ...liveNoteTools,
    ...backgroundTaskTools,
    ...codeTaskTools,
    ...notificationTools,

    [SPAWN_AGENT_TOOL_NAME]: {
        description: SPAWN_AGENT_DESCRIPTION,
        inputSchema: SpawnAgentInput,
        // Legacy runs-runtime path only: the turn runtime intercepts
        // builtin:spawn-agent in RealToolRegistry with a dedicated handler
        // that also records the parent→child link as durable tool progress.
        execute: async (input: unknown, ctx?: ToolContext) => {
            const { runSpawnedAgent } = await import("../assembly/spawn-agent.js");
            const result = await runSpawnedAgent(input, {
                parentTurnId: ctx?.runId ?? "",
                signal: ctx?.signal ?? new AbortController().signal,
            });
            if (result.isError) {
                throw new Error(
                    typeof result.output === "string"
                        ? result.output
                        : JSON.stringify(result.output),
                );
            }
            return result.output;
        },
    },
};

// Native ToolDescriptors for a skill's declared tools. Unknown names are
// dropped with a warning (they may come from a downloaded SKILL.md);
// availability-gated builtins (Composio, browser) drop out exactly as they
// do at agent resolution.
async function skillToolAdditions(
    skillId: string,
): Promise<Array<z.infer<typeof ToolDescriptor>>> {
    const descriptors: Array<z.infer<typeof ToolDescriptor>> = [];
    for (const name of skillToolNames(skillId)) {
        const builtin = BuiltinTools[name];
        if (!builtin) {
            console.warn(
                `[skills] Skill '${skillId}' declares unknown tool '${name}'; skipping.`,
            );
            continue;
        }
        if (builtin.isAvailable && !(await builtin.isAvailable())) {
            continue;
        }
        descriptors.push(builtinToolDescriptor(name, builtin));
    }
    return descriptors;
}

// The builtin-tools skill is the escape hatch: loading it attaches every
// builtin the copilot's base set leaves out. Derived here (not hand-written
// in the skill catalog) so new builtins can never silently fall outside it.
setBuiltinToolsSkillTools(
    Object.keys(BuiltinTools).filter(
        (name) => !COPILOT_BASE_TOOLS.includes(name),
    ),
);
