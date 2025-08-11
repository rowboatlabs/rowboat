import { Message } from "@/app/lib/types/types";
import { z } from "zod";

const chatReason = z.object({
    type: z.literal("chat"),
});

const apiReason = z.object({
    type: z.literal("api"),
});

const jobReason = z.object({
    type: z.literal("job"),
    jobId: z.string(),
});

export const Reason = z.discriminatedUnion("type", [
    chatReason,
    apiReason,
    jobReason,
]);

export const Turn = z.object({
    id: z.string(),
    reason: Reason,
    input: z.object({
        messages: z.array(Message),
        mockTools: z.record(z.string(), z.string()).nullable().optional(),
    }),
    output: z.array(Message),
    error: z.string().optional(),
    isBillingError: z.boolean().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
});

export const CachedTurnRequest = z.object({
    conversationId: z.string(),
    input: Turn.shape.input,
});

export const TurnEvent = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("message"),
        data: Message,
    }),
    z.object({
        type: z.literal("error"),
        error: z.string(),
        isBillingError: z.boolean().optional(),
    }),
    z.object({
        type: z.literal("done"),
        conversationId: z.string(),
        turn: Turn,
    }),
]);