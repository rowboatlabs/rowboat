import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ASSUMPTIONS, MEDIA_PACKS, OFFERS } from '../src/catalog.js';
import { formatPrice } from '../src/home-page.js';
import { packCredits, plansFrom } from '../src/pricing.js';
import { MemoryStore } from '../src/store.js';

const plans = plansFrom(OFFERS, ASSUMPTIONS);
// French writes 13 000 F CFA with narrow no-break spaces: compared as plain spaces.
const norm = (s: string) => s.replace(/[\s\u00a0\u202f]+/g, ' ');
const packs = MEDIA_PACKS.map((p) => ({ id: p.id, credits: packCredits(p, ASSUMPTIONS), prices: p.prices }));
const app = createApp({
  store: new MemoryStore(new Map(), plans), openRouterKey: 'or', publicUrl: 'https://app.baarali.test', appName: 'Baarali',
  mediaPacks: packs, home: { offers: OFFERS, weekCredits: Object.fromEntries(plans.map((p) => [p.id, p.weekCredits])), packs },
  fetch: (async () => new Response('{}')) as typeof fetch, now: Date.now,
});

describe('the home page', () => {
  it('shows every plan at the catalog prices, in euros and CFA francs', async () => {
    const page = norm(await (await app.request('/')).text());
    for (const text of ['Découverte', 'Semaine', 'Essentiel', 'Pro', '5 €', '3 300 F CFA', '20 €', '13 000 F CFA', '100 €', '200 €', '130 000 F CFA']) {
      expect(page).toContain(text);
    }
    // Usage relative to Essentiel, from the computed budgets.
    expect(page).toContain('Utilisation ×5 par rapport à Essentiel');
    expect(page).toContain('Utilisation ×10 par rapport à Essentiel');
  });

  it('shows the media packs with the credits they give', async () => {
    const page = await (await app.request('/')).text();
    for (const p of packs) expect(page).toContain(`${p.credits} crédits`);
  });

  it('never shows what a plan costs us', async () => {
    // The visible page, without its stylesheet (CSS says "margin" a lot).
    const page = (await (await app.request('/')).text()).replace(/<style[\s\S]*?<\/style>/, '');
    expect(page).not.toMatch(/\$|USD|\bmarge\b|\bmargin\b/i);
  });

  it('answers in English when asked, and runs only its own script', async () => {
    const res = await app.request('/', { headers: { 'accept-language': 'en-US,en' } });
    expect(await res.text()).toContain('The assistant that acts for you.');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('writes prices the way people write them', () => {
    expect(norm(formatPrice({ amount: 2000, currency: 'EUR' }, 'fr'))).toBe('20 €');
    expect(formatPrice({ amount: 2000, currency: 'EUR' }, 'en')).toBe('€20');
    expect(norm(formatPrice({ amount: 65000, currency: 'XOF' }, 'fr'))).toBe('65 000 F CFA');
    // Never a line break inside a price.
    expect(formatPrice({ amount: 65000, currency: 'XOF' }, 'fr')).not.toContain(' ');
  });
});
