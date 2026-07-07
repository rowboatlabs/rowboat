import { ToolAttachment } from "@x/shared/dist/agent.js";
import { RunEvent } from "@x/shared/dist/runs.js";
import { z } from "zod";
import { BuiltinTools } from "./builtin-tools.js";
import { executeTool } from "../../mcp/mcp.js";
import { IAbortRegistry } from "../../runs/abort-registry.js";

/**
 * Context passed to every tool execution, providing abort signal and run metadata.
 */
export interface ToolContext {
    runId: string;
    toolCallId: string;
    signal: AbortSignal;
    abortRegistry: IAbortRegistry;
    publish: (event: z.infer<typeof RunEvent>) => Promise<void>;
    // The composer code-mode chip for the message that triggered this turn. When set,
    // it is the authoritative coding agent — code_agent_run uses it rather than the
    // agent the model guessed, so switching the chip deterministically switches agents.
    codeMode?: 'claude' | 'codex' | null;
    // Set for Code-section sessions in Rowboat mode: the session's working directory
    // and approval policy. code_agent_run honors these over the model's cwd argument
    // and the global approval policy.
    codeCwd?: string | null;
    codePolicy?: 'ask' | 'auto-approve-reads' | 'yolo' | null;
}

async function execMcpTool(agentTool: z.infer<typeof ToolAttachment> & { type: "mcp" }, input: Record<string, unknown>): Promise<unknown> {
    const result = await executeTool(agentTool.mcpServerName, agentTool.name, input);
    return result;
}

export async function execTool(agentTool: z.infer<typeof ToolAttachment>, input: Record<string, unknown>, ctx?: ToolContext): Promise<unknown> {
    // Check abort before starting any tool
    ctx?.signal.throwIfAborted();

    switch (agentTool.type) {
        case "mcp":
            // MCP tools: let complete on graceful stop (most are fast)
            return execMcpTool(agentTool, input);
        case "builtin": {
            const builtinTool = BuiltinTools[agentTool.name];
            if (!builtinTool || !builtinTool.execute) {
                throw new Error(`Unsupported builtin tool: ${agentTool.name}`);
            }
            return builtinTool.execute(input, ctx);
        }
    }
}
