import { Agent, ToolAttachment } from "@x/shared/dist/agent.js";
import z from "zod";
import { CopilotInstructions } from "./instructions.js";
import { BuiltinTools } from "../lib/builtin-tools.js";

const tools: Record<string, z.infer<typeof ToolAttachment>> = {};
for (const name of Object.keys(BuiltinTools)) {
    tools[name] = {
        type: "builtin",
        name,
    };
}

export const CopilotAgent: z.infer<typeof Agent> = {
    name: "rowboatx",
    description: "Rowboatx copilot",
    instructions: CopilotInstructions,
    tools,
}