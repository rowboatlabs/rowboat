import z from "zod";

// Shared zod schemas for the ACP code-mode engine. Single source of truth: the
// core engine re-exports the inferred TS types, and runs.ts builds the RunEvent
// variants that carry these to the renderer.

export const CodingAgent = z.enum(["claude", "codex"]);
export type CodingAgent = z.infer<typeof CodingAgent>;

// How the permission broker answers the agent's requests before any per-tool
// "always allow" memory is applied. `yolo` is the safe, scoped equivalent of
// `claude --dangerously-skip-permissions` (our toggle, not a CLI flag).
export const ApprovalPolicy = z.enum(["ask", "auto-approve-reads", "yolo"]);
export type ApprovalPolicy = z.infer<typeof ApprovalPolicy>;

export const PermissionDecision = z.enum(["allow_once", "allow_always", "reject"]);
export type PermissionDecision = z.infer<typeof PermissionDecision>;

// What the UI needs to render a permission card.
export const PermissionAsk = z.object({
    toolCallId: z.string().optional(),
    title: z.string(),
    kind: z.string().optional(), // tool kind, e.g. "edit" | "execute" | "read"
    isRead: z.boolean(),
});
export type PermissionAsk = z.infer<typeof PermissionAsk>;

// Normalized per-run stream items. The engine maps raw ACP session/update
// notifications onto this union; the renderer renders them.
export const CodeRunEvent = z.discriminatedUnion("type", [
    // role distinguishes the agent's own output from replayed user turns
    // (loadSession streams the whole prior conversation back on resume).
    z.object({ type: z.literal("message"), role: z.enum(["agent", "user"]), text: z.string() }),
    z.object({ type: z.literal("thought") }),
    z.object({
        type: z.literal("tool_call"),
        id: z.string().optional(),
        title: z.string().optional(),
        kind: z.string().optional(),
        status: z.string().optional(),
    }),
    z.object({
        type: z.literal("tool_call_update"),
        id: z.string().optional(),
        status: z.string().optional(),
        diffs: z.array(z.string()),
    }),
    z.object({
        type: z.literal("plan"),
        entries: z.array(z.object({
            content: z.string(),
            status: z.string().optional(),
            priority: z.string().optional(),
        })),
    }),
    z.object({
        type: z.literal("usage"),
        used: z.number().nonnegative(),
        size: z.number().positive(),
    }),
    z.object({
        type: z.literal("permission"),
        ask: PermissionAsk,
        decision: z.union([PermissionDecision, z.literal("cancelled")]),
        auto: z.boolean(),
    }),
    z.object({ type: z.literal("other"), sessionUpdate: z.string() }),
]);
export type CodeRunEvent = z.infer<typeof CodeRunEvent>;

export const RunPromptResult = z.object({
    stopReason: z.string(),
    sessionId: z.string(),
});
export type RunPromptResult = z.infer<typeof RunPromptResult>;

// One item on the ephemeral CodeRunFeed (`codeRun:events` broadcast): a live
// code-run event tagged with the tool call it belongs to. Fire-and-forget —
// the durable record is the code-run-events-batch written when the run settles.
export type CodeRunFeedEvent = {
    toolCallId: string;
    event: CodeRunEvent;
};
