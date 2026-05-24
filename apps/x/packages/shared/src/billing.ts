import { z } from 'zod';

export const BillingPlanSchema = z.enum(['free', 'starter', 'pro']);
export type BillingPlan = z.infer<typeof BillingPlanSchema>;

export const BillingUsageBucketSchema = z.object({
  sanctionedCredits: z.number(),
  usedCredits: z.number(),
  availableCredits: z.number(),
});
export type BillingUsageBucket = z.infer<typeof BillingUsageBucketSchema>;

export const BillingInfoSchema = z.object({
  userEmail: z.string().nullable(),
  userId: z.string().nullable(),
  subscriptionPlan: BillingPlanSchema.nullable(),
  subscriptionStatus: z.string().nullable(),
  trialExpiresAt: z.string().nullable(),
  monthly: BillingUsageBucketSchema,
  daily: BillingUsageBucketSchema.extend({
    usageDay: z.string(),
  }),
});
export type BillingInfo = z.infer<typeof BillingInfoSchema>;
