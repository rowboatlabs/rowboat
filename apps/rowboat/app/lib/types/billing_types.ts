import { z } from "zod";

const UsageType = z.enum([
    "copilot_requests",
    "agent_messages",
    "rag_tokens",
]);

export const Customer = z.object({
    _id: z.string(),
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    stripeCustomerId: z.string(),
    subscriptionPlan: z.enum(["free", "basic", "pro"]).optional(),
    subscriptionActive: z.boolean().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    subscriptionPlanUpdatedAt: z.string().datetime().optional(),
    usage: z.record(UsageType, z.number()).optional(),
    usageUpdatedAt: z.string().datetime().optional(),
});

export const LogUsageRequest = z.object({
    type: UsageType,
    amount: z.number().int().positive(),
});

export const PricingTableResponse = z.object({
    clientSecret: z.string(),
    pricingTableId: z.string(),
    publishableKey: z.string(),
});

export const AuthorizeRequest = z.discriminatedUnion("type", [
    z.object({
        "type": z.literal("create-project"),
        "data": z.object({
            "existingProjectCount": z.number(),
        }),
    }),
    z.object({
        "type": z.literal("process-rag"),
        "data": z.object({
            "expected_rag_tokens": z.number(),
        }),
    }),
    z.object({
        "type": z.literal("copilot-request"),
        "data": z.object({}),
    }),
]);

export const AuthorizeResponse = z.object({
    success: z.boolean(),
    error: z.string().optional(),
});
