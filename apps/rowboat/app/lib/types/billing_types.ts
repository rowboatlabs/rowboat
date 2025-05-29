import { z } from "zod";

export const SubscriptionPlan = z.enum(["free", "basic", "pro"]);

export const UsageType = z.enum([
    "copilot_requests",
    "agent_messages",
    "rag_tokens",
]);

export const Customer = z.object({
    _id: z.string(),
    userId: z.string(),
    email: z.string(),
    stripeCustomerId: z.string(),
    subscriptionPlan: SubscriptionPlan.optional(),
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
        "type": z.literal("create_project"),
        "data": z.object({
            "existingProjectCount": z.number(),
        }),
    }),
    z.object({
        "type": z.literal("process_rag"),
        "data": z.object({}),
    }),
    z.object({
        "type": z.literal("copilot_request"),
        "data": z.object({}),
    }),
    z.object({
        "type": z.literal("agent_response"),
        "data": z.object({}),
    }),
]);

export const AuthorizeResponse = z.object({
    success: z.boolean(),
    error: z.string().optional(),
});

export const UsageResponse = z.object({
    usage: z.record(UsageType, z.object({
        usage: z.number(),
        total: z.number(),
    })),
});

export const CustomerPortalSessionRequest = z.object({
    returnUrl: z.string(),
});

export const CustomerPortalSessionResponse = z.object({
    url: z.string(),
});

export const PricesResponse = z.object({
    prices: z.record(SubscriptionPlan, z.object({
        monthly: z.number(),
    })),
});

export const UpdateSubscriptionPlanRequest = z.object({
    plan: SubscriptionPlan,
    returnUrl: z.string(),
});

export const UpdateSubscriptionPlanResponse = z.object({
    url: z.string(),
});