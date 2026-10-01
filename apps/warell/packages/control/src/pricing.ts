import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import type { ModelPolicy } from './models.js';

// From a plan's price to its model budget, with a guaranteed margin
// (architecture §3.5 "Les forfaits", decided 30/09/2026). The prices and the
// assumptions are data (catalog.ts); this file only computes, so a price or
// a fee changes without touching the rule.

/** ISO 4217 amount in minor units, never a float (mission §26, architecture §3.8). */
export interface Money {
  amount: number;
  currency: string;
}

/** Digits after the decimal point, per ISO 4217. The CFA francs have none. */
const MINOR_DIGITS: Record<string, number> = { EUR: 2, USD: 2, XOF: 0, XAF: 0 };

export function minorDigits(currency: string): number {
  const digits = MINOR_DIGITS[currency];
  if (digits === undefined) throw new Error(`Unknown currency ${currency}: add its ISO 4217 digits`);
  return digits;
}

export function toMajor(money: Money): number {
  return money.amount / 10 ** minorDigits(money.currency);
}

export interface PricingAssumptions {
  /** Market rate, dollars for one major unit, with its source and date. */
  usdPerUnit: Record<string, number>;
  /** Share of a non-dollar price lost if the rate turns against us. */
  fxBufferRate: number;
  /** Worst payment rail fee (card or mobile money), as a share of the price. */
  paymentFeeRate: number;
  /** Fixed part of the worst rail fee, in dollars, per payment. */
  paymentFixedUsd: number;
  /** OpenRouter's fee when buying credits: every model dollar costs this much more. */
  providerFeeRate: number;
  /** What must remain after model costs, as a share of net revenue. */
  minMarginRate: number;
}

export type Billing =
  /** One fixed price per currency, excluding taxes, for one period. */
  | { kind: 'paid'; period: 'week' | 'month'; prices: Money[] }
  /** Free plans have no revenue: their budget is a cost we accept, set in dollars. */
  | { kind: 'free'; weekBudgetUsd: number };

export interface Offer {
  id: string;
  category: 'free' | 'starter' | 'pro';
  displayName: string;
  billing: Billing;
  /** Absent: any model. */
  models?: ModelPolicy;
}

/** 52 weeks share 12 months: a full week of usage every week stays inside the month. */
export const WEEKS_PER_MONTH = 52 / 12;

/** Revenue we keep from one payment, in dollars, after fees and the FX buffer. */
export function netUsd(price: Money, a: PricingAssumptions): number {
  const rate = a.usdPerUnit[price.currency];
  if (rate === undefined) throw new Error(`No rate for ${price.currency}`);
  const fx = price.currency === 'USD' ? 1 : 1 - a.fxBufferRate;
  return toMajor(price) * rate * fx * (1 - a.paymentFeeRate) - a.paymentFixedUsd;
}

/**
 * Model budget for one billing period, in dollars of OpenRouter usage. Taken
 * from the least favorable currency, so every currency keeps the margin.
 */
export function periodModelBudgetUsd(offer: Offer, a: PricingAssumptions): number {
  if (offer.billing.kind === 'free') return offer.billing.weekBudgetUsd;
  if (offer.billing.prices.length === 0) throw new Error(`Offer ${offer.id} has no price`);
  const worstNet = Math.min(...offer.billing.prices.map((p) => netUsd(p, a)));
  return (worstNet * (1 - a.minMarginRate)) / (1 + a.providerFeeRate);
}

function weeksPerPeriod(offer: Offer): number {
  return offer.billing.kind === 'paid' && offer.billing.period === 'month' ? WEEKS_PER_MONTH : 1;
}

export function weekCredits(offer: Offer, a: PricingAssumptions): number {
  return Math.floor((periodModelBudgetUsd(offer, a) / weeksPerPeriod(offer)) * CREDITS_PER_DOLLAR);
}

/** Margin left on one price when the quota is used to the last credit every week. */
export function marginAtFullUsage(price: Money, offer: Offer, a: PricingAssumptions): number {
  const net = netUsd(price, a);
  const weeks = weeksPerPeriod(offer);
  const modelCost = (weekCredits(offer, a) / CREDITS_PER_DOLLAR) * weeks * (1 + a.providerFeeRate);
  return (net - modelCost) / net;
}

/** The plans the control plane serves: each offer with its computed week budget. */
export function plansFrom(offers: Offer[], a: PricingAssumptions) {
  return offers.map((offer) => ({
    id: offer.id,
    category: offer.category,
    displayName: offer.displayName,
    weekCredits: weekCredits(offer, a),
    monthlyPrices: offer.billing.kind === 'paid' && offer.billing.period === 'month' ? offer.billing.prices : [],
    models: offer.models ?? null,
  }));
}
