import z from "zod";
import { ToolCallPart } from "./message.js";
import { ToolPermissionMetadata } from "./runs.js";
import { PermissionAsk } from "./code-mode.js";

// A permission ask from a headless background-task run, waiting on the user.
// 'tool' items come from the standard pre-call permission gate and are answered
// via `runs:authorizePermission`; 'code' items are mid-turn asks from a
// code_agent_run coding turn, answered via `codeRun:resolvePermission`.
export const PendingApproval = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("tool"),
        runId: z.string(),
        slug: z.string(),
        taskName: z.string(),
        toolCallId: z.string(),
        subflow: z.array(z.string()),
        toolCall: ToolCallPart,
        permission: ToolPermissionMetadata.optional(),
        ts: z.string(),
    }),
    z.object({
        kind: z.literal("code"),
        runId: z.string(),
        slug: z.string(),
        taskName: z.string(),
        requestId: z.string(),
        toolCallId: z.string(),
        ask: PermissionAsk,
        ts: z.string(),
    }),
]);
export type PendingApproval = z.infer<typeof PendingApproval>;
