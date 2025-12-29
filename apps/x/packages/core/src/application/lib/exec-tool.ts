import { ToolAttachment } from "@x/shared/dist/agent.js";
import { z } from "zod";
import { BuiltinTools } from "./builtin-tools.js";
import { executeTool } from "../../mcp/mcp.js";

async function execMcpTool(agentTool: z.infer<typeof ToolAttachment> & { type: "mcp" }, input: Record<string, unknown>): Promise<unknown> {
    const result = await executeTool(agentTool.mcpServerName, agentTool.name, input);
    return result;
}

export async function execTool(agentTool: z.infer<typeof ToolAttachment>, input: Record<string, unknown>): Promise<unknown> {
    switch (agentTool.type) {
        case "mcp":
            return execMcpTool(agentTool, input);
        case "builtin": {
            const builtinTool = BuiltinTools[agentTool.name];
            if (!builtinTool || !builtinTool.execute) {
                throw new Error(`Unsupported builtin tool: ${agentTool.name}`);
            }
            return builtinTool.execute(input);
        }
    }
}