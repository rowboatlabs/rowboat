import { z } from 'zod';

export const BillingPlanCategorySchema = z.enum(['free', 'starter', 'pro']);
export type BillingPlanCategory = z.infer<typeof BillingPlanCategorySchema>;

export const BillingPlanIdSchema = z.string().min(1);
export type BillingPlanId = z.infer<typeof BillingPlanIdSchema>;

export const BillingCatalogPlanSchema = z.object({
  id: BillingPlanIdSchema,
  category: BillingPlanCategorySchema,
  displayName: z.string(),
  monthlyCredits: z.number(),
  dailyCredits: z.number(),
  monthlyPriceCents: z.number().nullable(),
  archived: z.boolean().optional(),
});
export type BillingCatalogPlan = z.infer<typeof BillingCatalogPlanSchema>;

export const BillingCatalogSchema = z.object({
  plans: z.array(BillingCatalogPlanSchema),
});
export type BillingCatalog = z.infer<typeof BillingCatalogSchema>;

export const BillingUsageBucketSchema = z.object({
  sanctionedCredits: z.number(),
  usedCredits: z.number(),
  availableCredits: z.number(),
});
export type BillingUsageBucket = z.infer<typeof BillingUsageBucketSchema>;

export const BillingInfoSchema = z.object({
  userEmail: z.string().nullable(),
  userId: z.string().nullable(),
  subscriptionPlanId: BillingPlanIdSchema.nullable(),
  subscriptionStatus: z.string().nullable(),
  trialExpiresAt: z.string().nullable(),
  catalog: BillingCatalogSchema,
  monthly: BillingUsageBucketSchema,
  daily: BillingUsageBucketSchema.extend({
    usageDay: z.string(),
  }),
});
export type BillingInfo = z.infer<typeof BillingInfoSchema>;

export function getBillingPlanData(
  catalog: BillingCatalog,
  planId: string | null | undefined,
): BillingCatalogPlan | null {
  if (!planId) return null;
  return catalog.plans.find((plan) => plan.id === planId) ?? null;
}
