import z from "zod";
import { ApprovalPolicy } from "@x/shared/dist/code-mode.js";

export const CodeModeConfig = z.object({
    enabled: z.boolean(),
    // How the ACP engine answers the coding agent's permission requests.
    // Optional for back-compat; the tool defaults to "ask" when unset.
    approvalPolicy: ApprovalPolicy.optional(),
});
export type CodeModeConfig = z.infer<typeof CodeModeConfig>;

// Who is signed in, when detectable. `plan` is the raw subscription tier as
// reported by the agent ("max", "pro", "enterprise" for Claude; ChatGPT plan
// types like "plus" / "go" for Codex) — the UI formats it for display.
export const AgentAccount = z.object({
    email: z.string().optional(),
    plan: z.string().optional(),
});
export type AgentAccount = z.infer<typeof AgentAccount>;

export const AgentStatus = z.object({
    installed: z.boolean(),
    signedIn: z.boolean(),
    account: AgentAccount.optional(),
});
export type AgentStatus = z.infer<typeof AgentStatus>;

export const CodeModeAgentStatus = z.object({
    claude: AgentStatus,
    codex: AgentStatus,
});
export type CodeModeAgentStatus = z.infer<typeof CodeModeAgentStatus>;
