import { z } from 'zod';

// Mirrors the backend's shared billing constant — credits are denominated so
// that 100M credits == $1 of usage.
export const CREDITS_PER_DOLLAR = 100_000_000;

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

// Bonus/promotional credits granted outside the plan buckets (credit store).
// Not sanctioned per period, so it carries a plain balance instead of a quota.
export const BillingStoreBucketSchema = z.object({
  availableCredits: z.number(),
});
export type BillingStoreBucket = z.infer<typeof BillingStoreBucketSchema>;

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
  store: BillingStoreBucketSchema,
});
export type BillingInfo = z.infer<typeof BillingInfoSchema>;

export function getBillingPlanData(
  catalog: BillingCatalog,
  planId: string | null | undefined,
): BillingCatalogPlan | null {
  if (!planId) return null;
  return catalog.plans.find((plan) => plan.id === planId) ?? null;
}
