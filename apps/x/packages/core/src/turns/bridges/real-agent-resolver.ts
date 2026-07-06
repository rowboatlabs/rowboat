import { z } from "zod";
import type { Agent } from "@x/shared/dist/agent.js";
import {
    type JsonValue,
    RequestedAgent,
    ResolvedAgent,
    type ToolDescriptor,
} from "@x/shared/dist/turns.js";
import {
    composeSystemInstructions,
    loadAgent,
    loadAgentNotesContext,
    loadUserWorkDir,
} from "../../agents/runtime.js";
import { BuiltinTools } from "../../application/lib/builtin-tools.js";
import { getDefaultModelAndProvider } from "../../models/defaults.js";
import type { IAgentResolver } from "../agent-resolver.js";

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
const CompositionOverrides = z.object({
    workDirId: z.string().nullable().optional(),
    voiceInput: z.boolean().optional(),
    voiceOutput: z.enum(["summary", "full"]).nullable().optional(),
    searchEnabled: z.boolean().optional(),
    codeMode: z.enum(["claude", "codex"]).nullable().optional(),
    codeCwd: z.string().nullable().optional(),
    videoMode: z.boolean().optional(),
    coachMode: z.boolean().optional(),
});

export interface RealAgentResolverDeps {
    load?: typeof loadAgent;
    builtins?: typeof BuiltinTools;
    defaultModel?: () => Promise<{ model: string; provider: string }>;
    loadNotes?: () => string | null;
    loadWorkDir?: (workDirId: string) => string | null;
}

// Bridges the existing agent system (loadAgent + dynamic builders, the
// BuiltinTools catalog, MCP attachments) to the immutable ResolvedAgent
// snapshot. The composed system prompt is byte-identical to the old
// runtime's streamAgent assembly for the same inputs.
export class RealAgentResolver implements IAgentResolver {
    private readonly load: typeof loadAgent;
    private readonly builtins: typeof BuiltinTools;
    private readonly defaultModel: () => Promise<{ model: string; provider: string }>;
    private readonly loadNotes: () => string | null;
    private readonly loadWorkDir: (workDirId: string) => string | null;

    constructor(deps: RealAgentResolverDeps = {}) {
        this.load = deps.load ?? loadAgent;
        this.builtins = deps.builtins ?? BuiltinTools;
        this.defaultModel = deps.defaultModel ?? getDefaultModelAndProvider;
        this.loadNotes = deps.loadNotes ?? loadAgentNotesContext;
        this.loadWorkDir = deps.loadWorkDir ?? loadUserWorkDir;
    }

    async resolve(
        requested: z.infer<typeof RequestedAgent>,
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
        const composition = parsed.success ? parsed.data : {};
        // Agent notes and work-dir context are copilot-scoped, matching the
        // old runtime's behavior.
        const copilotContext =
            requested.agentId === "copilot" || requested.agentId === "rowboatx";
        const systemPrompt = composeSystemInstructions({
            instructions: agent.instructions,
            agentNotesContext: copilotContext ? this.loadNotes() : null,
            userWorkDir:
                copilotContext && composition.workDirId
                    ? this.loadWorkDir(composition.workDirId)
                    : null,
            voiceInput: composition.voiceInput ?? false,
            voiceOutput: composition.voiceOutput ?? null,
            searchEnabled: composition.searchEnabled ?? false,
            codeMode: composition.codeMode ?? null,
            codeCwd: composition.codeCwd ?? null,
            videoMode: composition.videoMode ?? false,
            coachMode: composition.coachMode ?? false,
        });

        const tools = await this.resolveTools(agent);
        return ResolvedAgent.parse({
            agentId: requested.agentId,
            systemPrompt,
            model,
            tools,
        });
    }

    private async resolveTools(
        agent: z.infer<typeof Agent>,
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
            const builtin = this.builtins[attachment.name];
            if (!builtin) {
                continue;
            }
            if (builtin.isAvailable && !(await builtin.isAvailable())) {
                continue;
            }
            tools.push({
                toolId: `builtin:${attachment.name}`,
                name,
                description: builtin.description,
                inputSchema: toJsonSchema(builtin.inputSchema),
                execution: "sync",
                requiresHuman: false,
            });
        }
        return tools;
    }
}

function toJsonSchema(schema: unknown): JsonValue {
    try {
        return toJsonValue(z.toJSONSchema(schema as z.ZodType)) ?? {
            type: "object",
            properties: {},
        };
    } catch {
        // An exotic zod schema must not break the whole turn.
        return { type: "object", properties: {} };
    }
}

function toJsonValue(value: unknown): JsonValue | undefined {
    try {
        return JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
        return undefined;
    }
}
