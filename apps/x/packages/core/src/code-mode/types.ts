import z from "zod";

export const CodeModeConfig = z.object({
    enabled: z.boolean(),
});
export type CodeModeConfig = z.infer<typeof CodeModeConfig>;

export const AgentStatus = z.object({
    installed: z.boolean(),
    signedIn: z.boolean(),
});
export type AgentStatus = z.infer<typeof AgentStatus>;

export const CodeModeAgentStatus = z.object({
    claude: AgentStatus,
    codex: AgentStatus,
});
export type CodeModeAgentStatus = z.infer<typeof CodeModeAgentStatus>;
