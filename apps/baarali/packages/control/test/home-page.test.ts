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

describe('the download section', () => {
  const base = 'https://github.com/benewende-dev/warell/releases/latest/download';
  const withDownloads = createApp({
    store: new MemoryStore(new Map(), plans), openRouterKey: 'or', publicUrl: 'https://app.baarali.test', appName: 'Baarali',
    mediaPacks: packs, home: { offers: OFFERS, weekCredits: {}, packs, downloadBase: base },
    fetch: (async () => new Response('{}')) as typeof fetch, now: Date.now,
  });

  it('links the installers of the latest release once one is published', async () => {
    const page = await (await withDownloads.request('/')).text();
    for (const file of ['Baarali-mac-arm64.dmg', 'Baarali-mac-intel.dmg', 'Baarali-windows-setup.exe']) expect(page).toContain(`${base}/${file}`);
    expect(page).toContain('href="#telecharger"');
  });

  it('offers the account only while there is nothing to download', async () => {
    const page = await (await app.request('/')).text();
    expect(page).not.toContain('telecharger');
    expect(page).toContain('href="/auth/v1/sign-in"');
  });
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
    expect(await res.text()).toContain('<title>Baarali — the assistant that acts for you</title>');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('carries the Baarali mark, in the header and as the tab icon', async () => {
    const page = await (await app.request('/')).text();
    expect(page).toMatch(/<a class="brand" href="\/"><svg [^>]*aria-hidden="true"/);
    expect(page).toContain('role="img" aria-label="Baarali"');
    expect(page).toContain('<link rel="icon" href="data:image/svg+xml,');
  });

  it('writes prices the way people write them', () => {
    expect(norm(formatPrice({ amount: 2000, currency: 'EUR' }, 'fr'))).toBe('20 €');
    expect(formatPrice({ amount: 2000, currency: 'EUR' }, 'en')).toBe('€20');
    expect(norm(formatPrice({ amount: 65000, currency: 'XOF' }, 'fr'))).toBe('65 000 F CFA');
    // Never a line break inside a price.
    expect(formatPrice({ amount: 65000, currency: 'XOF' }, 'fr')).not.toContain(' ');
  });
});

describe('the page files', () => {
  it('serves its fonts, for a year', async () => {
    const res = await app.request('/assets/inter.woff2');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('font/woff2');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('serves nothing outside its list', async () => {
    for (const path of ['/assets/OFL-Inter.txt', '/assets/..%2Fsrc%2Fapp.ts', '/assets/..%2F..%2Fpackage.json', '/assets/']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });
});

describe('the legal pages', () => {
  it('publishes who we are, what we do with data, and the terms', async () => {
    for (const [path, text] of [['/mentions-legales', 'OpenBaara SAS'], ['/confidentialite', 'loi burkinabè'], ['/conditions', 'droit burkinabè']]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      const page = await res.text();
      expect(page).toContain(text);
      expect(page).toContain('contact@baarali.com');
    }
  });

  it('answers in English when asked', async () => {
    const page = await (await app.request('/confidentialite', { headers: { 'accept-language': 'en' } })).text();
    expect(page).toContain('<title>Privacy — Baarali</title>');
  });

  it('is linked from the home page footer', async () => {
    const page = await (await app.request('/')).text();
    for (const path of ['/mentions-legales', '/confidentialite', '/conditions']) expect(page).toContain(`href="${path}"`);
  });
});

