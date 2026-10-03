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
  // When this window starts over (ISO). Baarali (02/10/2026): absent when
  // the window is not running yet — a session opens with its first message.
  resetsAt: z.string().optional(),
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

// The plans as Baarali's pricing page shows them, for the app to show the
// same in its own window (Baarali, 02/10/2026: the account lives in the
// app, the site is a showcase). Served by the control plane at /v1/plans,
// already worded and priced in the person's language: the app displays.
export const PlanOfferLevelSchema = z.object({
  /** The catalog plan id (BillingCatalogPlan.id). */
  id: z.string(),
  /** Short name of the level, when a plan has several (Pro: "×5", "×10"). */
  label: z.string().nullable(),
  /** The price, written, in each currency; null for a free plan. */
  price: z.object({ xof: z.string(), eur: z.string() }).nullable(),
  /** "par semaine", "par mois", "pour toujours". */
  per: z.string(),
  /** A line under the price, or null. */
  note: z.string().nullable(),
});
export type PlanOfferLevel = z.infer<typeof PlanOfferLevelSchema>;

export const PlanOfferSchema = z.object({
  id: z.string(),
  name: z.string(),
  tag: z.string(),
  for: z.string(),
  plus: z.string(),
  points: z.array(z.string()),
  /** The plan the page sets apart. */
  featured: z.boolean(),
  free: z.boolean(),
  levels: z.array(PlanOfferLevelSchema).min(1),
});
export type PlanOffer = z.infer<typeof PlanOfferSchema>;

export const PlanOffersSchema = z.object({
  lang: z.enum(['fr', 'en']),
  lead: z.string(),
  /** What a paid plan's button says while payment is not open. */
  soon: z.string(),
  /** Taxes and payment, under the plans. */
  foot: z.string(),
  plans: z.array(PlanOfferSchema),
});
export type PlanOffers = z.infer<typeof PlanOffersSchema>;
