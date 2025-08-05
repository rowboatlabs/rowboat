import { Message } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { z } from "zod";

export const Turn = z.object({
    id: z.string(),
    trigger: z.enum([
        "chat",
        "api",
    ]),
    input: z.object({
        messages: z.array(Message),
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
        turn: Turn,
    }),
]);