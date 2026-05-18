import { z } from 'zod';

export const BillingPlanSchema = z.enum(['free', 'starter', 'pro']);
export type BillingPlan = z.infer<typeof BillingPlanSchema>;

export const BillingInfoSchema = z.object({
  userEmail: z.string().nullable(),
  userId: z.string().nullable(),
  subscriptionPlan: BillingPlanSchema.nullable(),
  subscriptionStatus: z.string().nullable(),
  trialExpiresAt: z.string().nullable(),
  sanctionedCredits: z.number(),
  availableCredits: z.number(),
});
export type BillingInfo = z.infer<typeof BillingInfoSchema>;
