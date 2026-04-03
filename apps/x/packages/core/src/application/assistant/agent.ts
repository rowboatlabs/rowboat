import { Agent, ToolAttachment } from "@x/shared/dist/agent.js";
import z from "zod";
import { buildCopilotInstructions } from "./instructions.js";
import { BuiltinTools } from "../lib/builtin-tools.js";

/**
 * Build the CopilotAgent dynamically.
 * Tools are derived from the current BuiltinTools (which include Composio meta-tools),
 * and instructions include the live Composio connection status.
 */
export async function buildCopilotAgent(): Promise<z.infer<typeof Agent>> {
    const tools: Record<string, z.infer<typeof ToolAttachment>> = {};
    for (const name of Object.keys(BuiltinTools)) {
        tools[name] = { type: "builtin", name };
    }
    const instructions = await buildCopilotInstructions();
    return {
        name: "rowboatx",
        description: "Rowboatx copilot",
        instructions,
        tools,
    };
}
