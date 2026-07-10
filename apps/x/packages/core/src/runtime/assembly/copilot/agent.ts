import { Agent, ToolAttachment } from "@x/shared/dist/agent.js";
import z from "zod";
import { buildCopilotInstructions } from "./instructions.js";
import { COPILOT_BASE_TOOLS } from "./base-tools.js";

/**
 * Build the CopilotAgent dynamically.
 * Only the hardcoded base toolset is attached here; everything else is
 * skill-scoped — loading a skill attaches its declared tools (turns runtime
 * only). Instructions include the live Composio connection status.
 */
export async function buildCopilotAgent(): Promise<z.infer<typeof Agent>> {
    const tools: Record<string, z.infer<typeof ToolAttachment>> = {};
    for (const name of COPILOT_BASE_TOOLS) {
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
