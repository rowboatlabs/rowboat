import { z } from "zod";
import { Agent, ToolAttachment } from "@x/shared/dist/agent.js";
import type { ToolDefinition } from "../agent-loop/types.js";
import { BuiltinTools } from "../application/lib/builtin-tools.js";
import { loadAgent } from "../agents/runtime.js";

// "ask-human" is a builtin attachment but has no entry in the BuiltinTools
// catalog: it never executes through execTool. The loop dispatches it (run →
// pending) and the user's answer arrives via setToolResult. Its advertised
// schema mirrors the old runtime's mapAgentTool special case.
export const ASK_HUMAN_TOOL = "ask-human";
const ASK_HUMAN_DEFINITION: ToolDefinition = {
    name: ASK_HUMAN_TOOL,
    description:
        "Ask a human before proceeding. Optionally pass `options` (an array of short button labels) to render the question as a one-click choice; the user's response will be the chosen label verbatim.",
    inputSchema: {
        type: "object",
        properties: {
            question: { type: "string", description: "The question to ask the human" },
            options: {
                type: "array",
                items: { type: "string" },
                description:
                    "Optional short button labels (2-4 recommended). If provided, the user picks one with a single click instead of typing. The response you receive will be the chosen label.",
            },
        },
        required: ["question"],
        additionalProperties: false,
    },
};

type ResolvedAgentTools = {
    agent: z.infer<typeof Agent> | null;
    definitions: ToolDefinition[];
    attachments: Map<string, z.infer<typeof ToolAttachment>>;
};

// Loads an agent's tool set once and serves both bridges: the ToolRunner reads
// `definitions` (advertised to the model) and resolves an `attachment` per call
// (to know how to execute it); the PermissionGate reads `attachment` (to decide
// whether a call needs approval). Cached by agentId — agent config is immutable
// for the life of a turn, so re-reading the file each model iteration is waste.
export class AgentTools {
    private cache = new Map<string, ResolvedAgentTools>();

    constructor(private load: (id: string) => Promise<z.infer<typeof Agent>> = loadAgent) {}

    async resolve(agentId: string | null): Promise<ResolvedAgentTools> {
        if (agentId === null) return { agent: null, definitions: [], attachments: new Map() };
        const cached = this.cache.get(agentId);
        if (cached) return cached;
        const resolved = await this.build(agentId);
        this.cache.set(agentId, resolved);
        return resolved;
    }

    async agent(agentId: string | null): Promise<z.infer<typeof Agent> | null> {
        return (await this.resolve(agentId)).agent;
    }

    async definitions(agentId: string | null): Promise<ToolDefinition[]> {
        return (await this.resolve(agentId)).definitions;
    }

    async attachment(
        agentId: string | null,
        toolName: string,
    ): Promise<z.infer<typeof ToolAttachment> | null> {
        return (await this.resolve(agentId)).attachments.get(toolName) ?? null;
    }

    private async build(agentId: string): Promise<ResolvedAgentTools> {
        const agent = await this.load(agentId);
        const definitions: ToolDefinition[] = [];
        const attachments = new Map<string, z.infer<typeof ToolAttachment>>();

        for (const [name, attachment] of Object.entries(agent.tools ?? {})) {
            attachments.set(name, attachment);

            if (attachment.type === "mcp") {
                definitions.push({
                    name,
                    description: attachment.description,
                    inputSchema: attachment.inputSchema,
                });
                continue;
            }
            if (attachment.type === "agent") {
                // agent-as-tool is unused in shipped agents and unsupported here.
                continue;
            }
            // builtin
            if (name === ASK_HUMAN_TOOL) {
                definitions.push(ASK_HUMAN_DEFINITION);
                continue;
            }
            const builtin = BuiltinTools[name];
            if (!builtin) continue;
            if (builtin.isAvailable && !(await builtin.isAvailable())) continue;
            definitions.push({
                name,
                description: builtin.description,
                inputSchema: toJsonSchema(builtin.inputSchema),
            });
        }

        return { agent, definitions, attachments };
    }
}

// Builtin schemas are zod; the model adapter expects JSON Schema. Convert
// defensively — a tool with an exotic schema that won't convert still gets
// advertised (with an open object schema) rather than breaking the whole turn.
function toJsonSchema(schema: unknown): unknown {
    try {
        return z.toJSONSchema(schema as z.ZodType);
    } catch {
        return { type: "object", properties: {} };
    }
}
