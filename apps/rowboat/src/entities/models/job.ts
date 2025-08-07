import { Message } from "@/app/lib/types/types";
import { z } from "zod";

export const Job = z.object({
    id: z.string(),
    trigger: z.enum(["composio_trigger"]),
    triggerData: z.object({
        composioTriggerId: z.string().optional(),
    }),
    projectId: z.string(),
    input: z.object({
        messages: z.array(Message),
    }),
    output: z.object({
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