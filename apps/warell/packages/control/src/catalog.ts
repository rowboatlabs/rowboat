import type { Offer, PricingAssumptions } from './pricing.js';

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
  minMarginRate: 0.55,
};

const prices = (eur: number, cfa: number) => [
  { amount: eur * 100, currency: 'EUR' },
  { amount: cfa, currency: 'XOF' },
  { amount: cfa, currency: 'XAF' },
];

export const OFFERS: Offer[] = [
  // The cheapest tool-capable models only (routing comes in its own PR):
  // about 150 calls a week at 0.05 cent each.
  { id: 'decouverte', category: 'free', displayName: 'Découverte', billing: { kind: 'free', weekBudgetUsd: 0.08 } },
  // The prepaid week, for mobile money: LigdiCash has no recurring debit.
  { id: 'semaine', category: 'starter', displayName: 'Semaine', billing: { kind: 'paid', period: 'week', prices: prices(5, 3300) } },
  { id: 'essentiel', category: 'starter', displayName: 'Essentiel', billing: { kind: 'paid', period: 'month', prices: prices(20, 13000) } },
  { id: 'pro-100', category: 'pro', displayName: 'Pro', billing: { kind: 'paid', period: 'month', prices: prices(100, 65000) } },
  { id: 'pro-200', category: 'pro', displayName: 'Pro', billing: { kind: 'paid', period: 'month', prices: prices(200, 130000) } },
];
