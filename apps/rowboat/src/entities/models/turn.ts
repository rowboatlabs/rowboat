import { Message } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { z } from "zod";

export const Turn = z.object({
    id: z.string(),
    projectId: z.string(),
    conversationId: z.string(),
    createdAt: z.string().datetime(),
    trigger: z.enum([
        "chat",
        "api",
    ]),
    triggerData: z.object({
        messages: z.array(Message),
        workflow: Workflow,
    }),
    messages: z.array(Message),
    status: z.enum([
        "pending",
        "running",
        "completed",
        "failed",
    ]),
    error: z.string().optional(),
    lastUpdatedAt: z.string().datetime().optional(),
    lockedByWorkerId: z.string().optional(),
    lockAcquiredAt: z.string().datetime().optional(),
    lockReleasedAt: z.string().datetime().optional(),
});

export const TurnEvent = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("message"),
        index: z.number(),
        data: Message,
    }),
    z.object({
        type: z.literal("error"),
        error: z.string(),
    }),
    z.object({
        type: z.literal("done"),
        turn: Turn,
    }),
]);