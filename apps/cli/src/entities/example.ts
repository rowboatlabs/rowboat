import z from "zod"
import { Agent } from "../agents/agents.js"
import { McpServerDefinition } from "../mcp/schema.js";

export const Example = z.object({
    id: z.string(),
    instructions: z.string().optional(),
    description: z.string().optional(),
    entryAgent: z.string().optional(),
    agents: z.array(Agent).optional(),
    mcpServers: z.record(z.string(), McpServerDefinition).optional(),
});
