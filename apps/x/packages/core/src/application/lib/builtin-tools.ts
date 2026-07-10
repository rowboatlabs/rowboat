import { z } from "zod";
import { resolveSkill, availableSkills, skillToolNames, setBuiltinToolsSkillTools } from "../assistant/skills/index.js";
import { COPILOT_BASE_TOOLS } from "../assistant/base-tools.js";
import { builtinToolDescriptor } from "../../turns/bridges/builtin-descriptors.js";
import { TOOL_ADDITIONS_KEY } from "./tool-additions.js";
import type { ToolDescriptor } from "@x/shared/dist/turns.js";
import { SPAWN_AGENT_TOOL_NAME } from "@x/shared/dist/turns.js";
import { SPAWN_AGENT_DESCRIPTION, SpawnAgentInput } from "../../agents/spawn-agent.js";
import type { ToolContext } from "./exec-tool.js";
import { fileTools } from "./builtin-tools/files.js";
import { parsingTools } from "./builtin-tools/parsing.js";
import { agentAnalysisTools } from "./builtin-tools/agent-analysis.js";
import { mcpTools } from "./builtin-tools/mcp.js";
import { shellTools } from "./builtin-tools/shell.js";
import { codeAgentRunTools, codeTaskTools } from "./builtin-tools/code.js";
import { browserTools } from "./builtin-tools/browser.js";
import { appNavigationTools, appDataTools } from "./builtin-tools/app.js";
import { webSearchTools, fetchUrlTools } from "./builtin-tools/web.js";
import { memoryTools } from "./builtin-tools/memory.js";
import { composioTools } from "./builtin-tools/composio.js";
import { modelTools } from "./builtin-tools/models.js";
import { liveNoteTools } from "./builtin-tools/live-note.js";
import { backgroundTaskTools } from "./builtin-tools/background-tasks.js";
import { notificationTools } from "./builtin-tools/notifications.js";
import { BuiltinToolsSchema } from "./builtin-tools/support.js";
export { coalesceCodeRunEvents } from "./builtin-tools/support.js";

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
            skillName: z.string().describe("Skill identifier or path (e.g., 'workflow-run-ops' or 'src/application/assistant/skills/workflow-run-ops/skill.ts')"),
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
            const { runSpawnedAgent } = await import("../../agents/spawn-agent.js");
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
