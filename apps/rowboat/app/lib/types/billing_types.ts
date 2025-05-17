import { z } from "zod";

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
});

export const PricingTableSession = z.object({
    clientSecret: z.string(),
    pricingTableId: z.string(),
    publishableKey: z.string(),
});