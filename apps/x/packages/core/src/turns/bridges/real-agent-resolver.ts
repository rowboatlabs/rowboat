import { z } from "zod";
import type { Agent } from "@x/shared/dist/agent.js";
import {
    AgentByIdRequest,
    ResolvedAgent,
    SPAWN_AGENT_TOOL_NAME,
    type ToolDescriptor,
} from "@x/shared/dist/turns.js";
import { composeSystemInstructions } from "../../agents/compose-instructions.js";
import {
    loadAgentNotesContext,
    loadUserWorkDir,
} from "../../agents/runtime.js";
import { hasWorkspaceContext, loadAgent } from "../../agents/registry.js";
import { BuiltinTools } from "../../application/lib/builtin-tools.js";
import { skillToolNames } from "../../application/assistant/skills/index.js";
import { ModeFlags } from "../../application/assistant/capabilities/types.js";
import { getDefaultModelAndProvider } from "../../models/defaults.js";
import {
    builtinToolDescriptor,
    toJsonValue,
} from "./builtin-descriptors.js";

export const ASK_HUMAN_TOOL = "ask-human";

const ASK_HUMAN_DESCRIPTOR: z.infer<typeof ToolDescriptor> = {
    toolId: `builtin:${ASK_HUMAN_TOOL}`,
    name: ASK_HUMAN_TOOL,
    description:
        "Ask a human before proceeding. Optionally pass `options` (an array of short button labels) when a small set of choices would help the human answer quickly.",
    inputSchema: {
        type: "object",
        properties: {
            question: {
                type: "string",
                description: "The question to ask the human",
            },
            options: {
                type: "array",
                items: { type: "string" },
                description: "Optional short button labels the human can pick from",
            },
        },
        required: ["question"],
        additionalProperties: false,
    },
    execution: "async",
    requiresHuman: true,
};

// Recognized keys of the opaque RequestedAgent.overrides.composition value.
// Unknown keys are ignored. Prompt-affecting inputs should be session-sticky:
// every key here alters system-prompt bytes and therefore busts provider
// prefix caching when it changes between turns.
// The mode-flag keys come from the shared ModeFlags schema (the single
// source of truth in capabilities/types.ts — defaults make the parse output
// fully concrete); only the resolver-specific keys are declared here.
const CompositionOverrides = ModeFlags.extend({
    workDirId: z.string().nullable().optional(),
    // Set by spawn-agent for by-id children: strips the spawn tool so depth
    // is capped at 1 regardless of which stored agent is spawned.
    subagent: z.boolean().optional(),
    // Skills the session has loaded (maintained by the sessions layer from
    // prior turns' tools_extended events): their declared tools attach on
    // top of the copilot's base set. Order is preserved so identical sets
    // produce byte-identical snapshots and inheritance keeps working.
    activeSkills: z.array(z.string()).optional(),
});

export interface RealAgentResolverDeps {
    load?: typeof loadAgent;
    builtins?: typeof BuiltinTools;
    defaultModel?: () => Promise<{ model: string; provider: string }>;
    loadNotes?: () => string | null;
    loadWorkDir?: (workDirId: string) => string | null;
    skillTools?: typeof skillToolNames;
}

// Bridges the existing agent system (loadAgent + dynamic builders, the
// BuiltinTools catalog, MCP attachments) to the immutable ResolvedAgent
// snapshot. The composed system prompt is byte-identical to the old
// runtime's streamAgent assembly for the same inputs. Resolves only the
// by-id RequestedAgent variant; inline agents go through
// InlineAgentResolver via DispatchingAgentResolver.
export class RealAgentResolver {
    private readonly load: typeof loadAgent;
    private readonly builtins: typeof BuiltinTools;
    private readonly defaultModel: () => Promise<{ model: string; provider: string }>;
    private readonly loadNotes: () => string | null;
    private readonly loadWorkDir: (workDirId: string) => string | null;
    private readonly skillTools: typeof skillToolNames;

    constructor(deps: RealAgentResolverDeps = {}) {
        this.load = deps.load ?? loadAgent;
        this.builtins = deps.builtins ?? BuiltinTools;
        this.defaultModel = deps.defaultModel ?? getDefaultModelAndProvider;
        this.loadNotes = deps.loadNotes ?? loadAgentNotesContext;
        this.loadWorkDir = deps.loadWorkDir ?? loadUserWorkDir;
        this.skillTools = deps.skillTools ?? skillToolNames;
    }

    async resolve(
        requested: z.infer<typeof AgentByIdRequest>,
    ): Promise<z.infer<typeof ResolvedAgent>> {
        const agent = await this.load(requested.agentId);
        if (!agent) {
            throw new Error(`agent not found: ${requested.agentId}`);
        }

        // Model precedence: createTurn override > agent config > app default.
        let model = requested.overrides?.model;
        if (!model) {
            const fallback = await this.defaultModel();
            model = {
                provider: agent.provider ?? fallback.provider,
                model: agent.model ?? fallback.model,
            };
        }

        const parsed = CompositionOverrides.safeParse(
            requested.overrides?.composition ?? {},
        );
        // An unparseable composition falls back to all defaults (same shape
        // as parsing {}), preserving the historical "ignore garbage" rule.
        const composition = parsed.success
            ? parsed.data
            : CompositionOverrides.parse({});
        const { workDirId, subagent, activeSkills, ...modeFlags } = composition;
        // Agent notes and work-dir context are scoped to agents with the
        // workspaceContext trait (the copilot), per the agent registry.
        const copilotContext = hasWorkspaceContext(requested.agentId);
        const systemPrompt = composeSystemInstructions({
            instructions: agent.instructions,
            agentNotesContext: copilotContext ? this.loadNotes() : null,
            userWorkDir:
                copilotContext && workDirId ? this.loadWorkDir(workDirId) : null,
            ...modeFlags,
        });

        const tools = await this.resolveTools(agent, {
            subagent: subagent ?? false,
        });
        if (copilotContext && activeSkills?.length) {
            await this.appendSkillTools(tools, activeSkills);
        }
        return ResolvedAgent.parse({
            agentId: requested.agentId,
            systemPrompt,
            model,
            tools,
        });
    }

    // Skill-scoped tools carried across turns: each active skill's declared
    // BuiltinTools attach on top of the base set. Unknown skill ids (deleted
    // disk skill) and unknown/unavailable tool names skip gracefully.
    // Iteration order (skills, then declaration order) is deterministic, so
    // an unchanged activeSkills list yields a byte-identical snapshot and
    // agent-snapshot inheritance keeps working.
    private async appendSkillTools(
        tools: Array<z.infer<typeof ToolDescriptor>>,
        activeSkills: string[],
    ): Promise<void> {
        const attached = new Set(tools.map((tool) => tool.name));
        for (const skillId of activeSkills) {
            for (const name of this.skillTools(skillId)) {
                if (attached.has(name)) {
                    continue;
                }
                const builtin = this.builtins[name];
                if (!builtin) {
                    continue;
                }
                if (builtin.isAvailable && !(await builtin.isAvailable())) {
                    continue;
                }
                tools.push(builtinToolDescriptor(name, builtin));
                attached.add(name);
            }
        }
    }

    private async resolveTools(
        agent: z.infer<typeof Agent>,
        options: { subagent: boolean },
    ): Promise<Array<z.infer<typeof ToolDescriptor>>> {
        const tools: Array<z.infer<typeof ToolDescriptor>> = [];
        for (const [name, attachment] of Object.entries(agent.tools ?? {})) {
            if (attachment.type === "agent") {
                continue; // agent-as-tool is not supported in v1
            }
            if (attachment.type === "mcp") {
                tools.push({
                    toolId: `mcp:${attachment.mcpServerName}:${attachment.name}`,
                    name,
                    description: attachment.description,
                    inputSchema:
                        toJsonValue(attachment.inputSchema) ??
                        { type: "object", properties: {} },
                    execution: "sync",
                    requiresHuman: false,
                });
                continue;
            }
            if (name === ASK_HUMAN_TOOL) {
                tools.push(ASK_HUMAN_DESCRIPTOR);
                continue;
            }
            // Depth cap: a spawned child never spawns, whichever stored
            // agent it happens to be.
            if (
                options.subagent &&
                attachment.name === SPAWN_AGENT_TOOL_NAME
            ) {
                continue;
            }
            const builtin = this.builtins[attachment.name];
            if (!builtin) {
                continue;
            }
            if (builtin.isAvailable && !(await builtin.isAvailable())) {
                continue;
            }
            tools.push({
                ...builtinToolDescriptor(attachment.name, builtin),
                name,
            });
        }
        return tools;
    }
}
