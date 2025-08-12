import { Message } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { z } from "zod";

const composioTriggerReason = z.object({
    type: z.literal("composio_trigger"),
    triggerId: z.string(),
    triggerDeploymentId: z.string(),
    triggerTypeSlug: z.string(),
    payload: z.object({}).passthrough(),
});

const scheduledJobRuleReason = z.object({
    type: z.literal("scheduled_job_rule"),
    ruleId: z.string(),
});

const reason = z.discriminatedUnion("type", [
    composioTriggerReason,
    scheduledJobRuleReason,
]);

export const Job = z.object({
    id: z.string(),
    reason,
    projectId: z.string(),
    input: z.object({
        messages: z.array(Message),
    }),
    output: z.object({
        workflow: Workflow.optional(),
        conversationId: z.string().optional(),
        turnId: z.string().optional(),
        error: z.string().optional(),
    }).optional(),
    workerId: z.string().nullable(),
    lastWorkerId: z.string().nullable(),
    status: z.enum([
        "pending",
        "running",
        "completed",
        "failed",
    ]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
});