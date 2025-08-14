import { z } from "zod";

export const SubscriptionPlan = z.enum(["free", "starter", "pro"]);

export const UsageTypeKey = z.enum([
    "LLM_USAGE",
    "EMBEDDING_MODEL_USAGE",
    "COMPOSIO_TOOL_USAGE",
    "FIRECRAWL_SCRAPE_USAGE",
]);

export const LLMUsage = z.object({
    type: z.literal(UsageTypeKey.Enum.LLM_USAGE),
    modelName: z.string(),
    inputTokens: z.number().positive(),
    outputTokens: z.number().positive(),
    context: z.string(),
});

export const EmbeddingModelUsage = z.object({
    type: z.literal(UsageTypeKey.Enum.EMBEDDING_MODEL_USAGE),
    modelName: z.string(),
    tokens: z.number().positive(),
    context: z.string(),
});

export const ComposioToolUsage = z.object({
    type: z.literal(UsageTypeKey.Enum.COMPOSIO_TOOL_USAGE),
    toolSlug: z.string(),
    context: z.string(),
});

export const FirecrawlScrapeUsage = z.object({
    type: z.literal(UsageTypeKey.Enum.FIRECRAWL_SCRAPE_USAGE),
    context: z.string(),
});

export const UsageItem = z.discriminatedUnion("type", [
    LLMUsage,
    EmbeddingModelUsage,
    ComposioToolUsage,
    FirecrawlScrapeUsage,
]);

export const LogUsageRequest = z.object({
    items: z.array(UsageItem),
});

export const CustomerUsageData = z.record(z.string(), z.number());

export const Customer = z.object({
    _id: z.string(),
    userId: z.string(),
    email: z.string(),
    stripeCustomerId: z.string(),
    stripeSubscriptionId: z.string().optional(),
    subscriptionPlan: SubscriptionPlan.optional(),
    subscriptionStatus: z.enum([ 'active', 'past_due' ]).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    subscriptionPlanUpdatedAt: z.string().datetime().optional(),
    usage: CustomerUsageData.optional(),
    usageUpdatedAt: z.string().datetime().optional(),
    creditsOverride: z.number().optional(),
    maxProjectsOverride: z.number().optional(),
    agentModelsOverride: z.array(z.string()).optional(),
 });

export const AuthorizeRequest = z.discriminatedUnion("type", [
    z.object({
        "type": z.literal("use_credits"),
    }),
    z.object({
        "type": z.literal("create_project"),
        "data": z.object({
            "existingProjectCount": z.number(),
        }),
    }),
    z.object({
        "type": z.literal("agent_response"),
        "data": z.object({
            agentModels: z.array(z.string()),
        }),
    }),
]);

export const AuthorizeResponse = z.object({
    success: z.boolean(),
    error: z.string().optional(),
});

export const UsageResponse = z.object({
    sanctionedCredits: z.number(),
    availableCredits: z.number(),
    usage: CustomerUsageData,
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

export const ModelsResponse = z.object({
    agentModels: z.array(z.object({
        name: z.string(),
        eligible: z.boolean(),
        plan: SubscriptionPlan,
    })),
});