import z from "zod";
import { ApprovalPolicy } from "@x/shared/dist/code-mode.js";

export const CodeModeConfig = z.object({
    enabled: z.boolean(),
    // How the ACP engine answers the coding agent's permission requests.
    // Optional for back-compat; the tool defaults to "ask" when unset.
    approvalPolicy: ApprovalPolicy.optional(),
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
