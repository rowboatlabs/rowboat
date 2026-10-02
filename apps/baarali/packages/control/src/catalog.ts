import type { ModelPolicy } from './models.js';
import type { MediaPack, Offer, PricingAssumptions } from './pricing.js';

// The plans and what their budget rests on (architecture §3.5 "Les
// forfaits", decided 30/09/2026). Prices are the owner's; each one is fixed
// per currency, excluding taxes. Euro and CFA francs only (decided
// 30/09/2026): both CFA francs are pegged to the euro, so our own prices
// never drift apart. Adding a currency = one price per offer and one rate.

const EUR_USD = 1 / 0.88067; // ECB reference, 30/09/2026
const EUR_PER_CFA = 1 / 655.957; // fixed parity of XOF and XAF to the euro

export const ASSUMPTIONS: PricingAssumptions = {
  // Models are billed in dollars: the buffer below covers the euro falling.
  usdPerUnit: { EUR: EUR_USD, XOF: EUR_USD * EUR_PER_CFA, XAF: EUR_USD * EUR_PER_CFA },
  fxBufferRate: 0.05,
  // Reserve for the worst rail (an international card: a share plus a fixed
  // part). To check against LigdiCash's written answer on its fees
  // (providers doc §8) before the first real payment.
  paymentFeeRate: 0.05,
  paymentFixedUsd: 0.35,
  // OpenRouter charges 5.5 % on credit purchases.
  providerFeeRate: 0.055,
  // Pixazo's fee on its own top-ups is not written anywhere we could read:
  // OpenRouter's is reserved until it is.
  mediaProviderFeeRate: 0.055,
  minMarginRate: 0.55,
};

// Tested in French on 30/09/2026 (architecture §3.5): DeepSeek first, by the
// owner's choice, GPT-6 Luna when it fails. Reasoning off: DeepSeek otherwise
// spends the answer's tokens thinking and returns nothing.
export const DISCOVERY_MODELS: ModelPolicy = {
  models: ['deepseek/deepseek-v4.1-flash', 'openai/gpt-6-luna'],
  settings: { reasoning: { enabled: false } },
};

// The CFA price is the euro's at the fixed parity, to the franc (decided
// 01/10/2026: no rounding down, the owner wants the exact figure).
const CFA_PER_EUR = 655.957;
export const cfaOf = (eur: number) => Math.round(eur * CFA_PER_EUR);

const prices = (eur: number) => [
  { amount: Math.round(eur * 100), currency: 'EUR' },
  { amount: cfaOf(eur), currency: 'XOF' },
  { amount: cfaOf(eur), currency: 'XAF' },
];

/**
 * Paying a monthly plan for a year (decided 01/10/2026): 19 % off. Shown on
 * the pricing page only until payment opens; whether the year keeps the
 * month's usage is to settle against the margin before then.
 */
export const ANNUAL_DISCOUNT = 0.19;

export const OFFERS: Offer[] = [
  // The cheapest tool-capable models only: about 150 calls a week at 0.05
  // cent each.
  { id: 'decouverte', category: 'free', displayName: 'Découverte', billing: { kind: 'free', weekBudgetUsd: 0.08 }, models: DISCOVERY_MODELS },
  // The prepaid week, for mobile money: LigdiCash has no recurring debit.
  { id: 'semaine', category: 'starter', displayName: 'Semaine', billing: { kind: 'paid', period: 'week', prices: prices(5) } },
  { id: 'essentiel', category: 'starter', displayName: 'Essentiel', billing: { kind: 'paid', period: 'month', prices: prices(20) } },
  { id: 'pro-100', category: 'pro', displayName: 'Pro', billing: { kind: 'paid', period: 'month', prices: prices(100) } },
  { id: 'pro-200', category: 'pro', displayName: 'Pro', billing: { kind: 'paid', period: 'month', prices: prices(200) } },
];

// Media credit packs (decided 01/10/2026): small enough for mobile money,
// the smallest one still a few voice-overs or a short video. The CFA price
// is the euro's at the fixed parity, as for the plans.
export const MEDIA_PACKS: MediaPack[] = [
  { id: 'medias-2', prices: prices(2) },
  { id: 'medias-5', prices: prices(5) },
  { id: 'medias-20', prices: prices(20) },
];
