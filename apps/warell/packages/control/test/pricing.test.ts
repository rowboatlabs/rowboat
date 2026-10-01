import { describe, expect, it } from 'vitest';
import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import { ASSUMPTIONS, OFFERS } from '../src/catalog.js';
import {
  WEEKS_PER_MONTH,
  marginAtFullUsage,
  netUsd,
  periodModelBudgetUsd,
  plansFrom,
  weekCredits,
  type Offer,
} from '../src/pricing.js';

const paid = OFFERS.filter((o) => o.billing.kind === 'paid');

// The guarantee decided on 30/09/2026 (architecture §3.5): whatever the plan
// and the currency, a person who uses the quota to the last credit every
// week still leaves at least 55 % of net revenue after model costs.
describe('plan catalog guarantee', () => {
  for (const offer of paid) {
    if (offer.billing.kind !== 'paid') continue;
    for (const price of offer.billing.prices) {
      it(`${offer.id} in ${price.currency} keeps at least 55 % at full usage`, () => {
        expect(marginAtFullUsage(price, offer, ASSUMPTIONS)).toBeGreaterThanOrEqual(ASSUMPTIONS.minMarginRate - 1e-9);
      });
    }
  }

  it('prices every paid offer in the same currencies', () => {
    const currencies = paid.map((o) => (o.billing.kind === 'paid' ? o.billing.prices.map((p) => p.currency).sort().join(',') : ''));
    expect(new Set(currencies).size).toBe(1);
  });

  it('orders the week budgets: free < week pass ≈ Essentiel < Pro 100 < Pro 200', () => {
    const w = Object.fromEntries(OFFERS.map((o) => [o.id, weekCredits(o, ASSUMPTIONS)]));
    expect(w.decouverte).toBeLessThan(w.essentiel);
    expect(Math.abs(w.semaine - w.essentiel) / w.essentiel).toBeLessThan(0.1);
    expect(w['pro-100'] / w.essentiel).toBeGreaterThan(4.5);
    expect(w['pro-200'] / w['pro-100']).toBeGreaterThan(1.9);
  });

  it('keeps the free plan under 10 cents a week', () => {
    const free = OFFERS.find((o) => o.billing.kind === 'free')!;
    expect(weekCredits(free, ASSUMPTIONS)).toBeLessThanOrEqual(0.1 * CREDITS_PER_DOLLAR);
  });
});

describe('pricing arithmetic', () => {
  const a = { ...ASSUMPTIONS, paymentFixedUsd: 0.3, usdPerUnit: { USD: 1, EUR: 1.2 } };
  const monthly: Offer = { id: 'x', category: 'starter', displayName: 'X', billing: { kind: 'paid', period: 'month', prices: [
    { amount: 10000, currency: 'USD' },
    { amount: 10000, currency: 'EUR' },
  ] } };

  it('applies the payment fee to every price and the FX buffer to non-dollar prices', () => {
    expect(netUsd({ amount: 10000, currency: 'USD' }, a)).toBeCloseTo(100 * 0.95 - 0.3);
    expect(netUsd({ amount: 10000, currency: 'EUR' }, a)).toBeCloseTo(100 * 1.2 * 0.95 * 0.95 - 0.3);
  });

  it('reads CFA francs without minor units', () => {
    const cfa = { ...a, usdPerUnit: { XOF: 0.002 } };
    expect(netUsd({ amount: 32000, currency: 'XOF' }, cfa)).toBeCloseTo(32000 * 0.002 * 0.95 * 0.95 - 0.3);
  });

  it('takes the budget from the least favorable currency, net of the OpenRouter fee', () => {
    expect(periodModelBudgetUsd(monthly, a)).toBeCloseTo(((95 - 0.3) * 0.45) / 1.055);
  });

  it('spreads a month over 52/12 weeks, and a week pass over one', () => {
    const budget = ((95 - 0.3) * 0.45) / 1.055;
    expect(weekCredits(monthly, a)).toBe(Math.floor((budget / WEEKS_PER_MONTH) * CREDITS_PER_DOLLAR));
    const week: Offer = { ...monthly, billing: { kind: 'paid', period: 'week', prices: [{ amount: 10000, currency: 'USD' }] } };
    expect(weekCredits(week, a)).toBe(Math.floor(budget * CREDITS_PER_DOLLAR));
  });

  it('serves only monthly prices in the upstream monthly price field', () => {
    const plans = plansFrom(OFFERS, ASSUMPTIONS);
    expect(plans.find((p) => p.id === 'semaine')!.monthlyPrices).toEqual([]);
    expect(plans.find((p) => p.id === 'decouverte')!.monthlyPrices).toEqual([]);
    expect(plans.find((p) => p.id === 'essentiel')!.monthlyPrices.map((p) => p.currency)).toEqual(['EUR', 'XOF', 'XAF']);
  });

  it('refuses an unknown currency instead of guessing', () => {
    expect(() => netUsd({ amount: 100, currency: 'NGN' }, a)).toThrow(/NGN/);
  });
});
