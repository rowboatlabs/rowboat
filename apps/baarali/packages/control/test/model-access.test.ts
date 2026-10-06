import { describe, expect, it } from 'vitest';
import {
  AUTO_MODEL,
  accessFor,
  catalogOf,
  compareVendors,
  deduceStrength,
  defaultModel,
  fitCall,
  planLabeler,
  presentFor,
  mediaOpen,
  vendorOf,
  type ModelSetting,
} from '../src/model-access.js';
import type { Plan } from '../src/store.js';

// Which models each plan sees and calls, from the console's settings
// (decided 03/10/2026).

const plan = (id: string, category: Plan['category'], eur: number, displayName = id): Plan => ({
  id, category, displayName, weekCredits: 1, monthlyPrices: eur ? [{ amount: eur * 100, currency: 'EUR' }] : [],
  models: category === 'free' ? { models: ['deepseek/flash', 'openai/luna'], settings: { reasoning: { enabled: false } } } : null,
});
const FREE = plan('decouverte', 'free', 0, 'Découverte');
const WEEK = plan('semaine', 'starter', 0, 'Semaine');
const PRO = plan('pro-100', 'pro', 100, 'Pro');
const MAX = plan('pro-200', 'pro', 200, 'Pro');
const PLANS = [FREE, WEEK, PRO, MAX];

const setting = (modelId: string, s: Partial<ModelSetting> = {}): ModelSetting =>
  ({ modelId, enabled: true, minPlan: null, recommended: false, strength: null, freeRank: null, ...s });

describe('who sees a model', () => {
  it('keeps a model never touched open to the paid plans and out of Découverte', () => {
    const c = catalogOf(PLANS, []);
    expect(accessFor(c, WEEK, 'meta-llama/llama-5')).toEqual({ kind: 'open' });
    expect(accessFor(c, FREE, 'meta-llama/llama-5')).toEqual({ kind: 'hidden' });
  });

  it('hides OpenRouter\'s own models (routers, vanishing previews) until the owner opens one', () => {
    expect(accessFor(catalogOf(PLANS, []), MAX, 'openrouter/space-bunny-alpha')).toEqual({ kind: 'hidden' });
    expect(accessFor(catalogOf(PLANS, []), MAX, 'openrouter/auto')).toEqual({ kind: 'hidden' });
    const opened = catalogOf(PLANS, [setting('openrouter/auto')]);
    expect(accessFor(opened, MAX, 'openrouter/auto')).toEqual({ kind: 'open' });
  });

  it('hides a model switched off, from every plan', () => {
    const c = catalogOf(PLANS, [setting('anthropic/opus', { enabled: false })]);
    for (const p of PLANS) expect(accessFor(c, p, 'anthropic/opus')).toEqual({ kind: 'hidden' });
  });

  it('locks a model below the plan that opens it, and opens it from there up', () => {
    const c = catalogOf(PLANS, [setting('anthropic/opus', { minPlan: 'pro-100' })]);
    expect(accessFor(c, WEEK, 'anthropic/opus')).toEqual({ kind: 'locked', unlock: 'pro-100' });
    expect(accessFor(c, PRO, 'anthropic/opus')).toEqual({ kind: 'open' });
    expect(accessFor(c, MAX, 'anthropic/opus')).toEqual({ kind: 'open' });
    // Découverte sees it too, padlocked: what a plan would open.
    expect(accessFor(c, FREE, 'anthropic/opus')).toEqual({ kind: 'locked', unlock: 'pro-100' });
  });

  it('shows Découverte a set-up model with no minimum as opening from the first paid plan', () => {
    const c = catalogOf(PLANS, [setting('openai/gpt-6', { recommended: true })]);
    expect(accessFor(c, FREE, 'openai/gpt-6')).toEqual({ kind: 'locked', unlock: 'semaine' });
  });

  it('takes Découverte\'s list from the console, in its order, or from the code until it is set', () => {
    expect(catalogOf(PLANS, []).free).toEqual(['deepseek/flash', 'openai/luna']);
    const c = catalogOf(PLANS, [setting('google/flash', { freeRank: 1 }), setting('qwen/small', { freeRank: 0 }), setting('x/off', { freeRank: 2, enabled: false })]);
    expect(c.free).toEqual(['qwen/small', 'google/flash']);
    // Découverte's models are open to everyone.
    expect(accessFor(c, FREE, 'google/flash')).toEqual({ kind: 'open' });
    expect(accessFor(c, MAX, 'qwen/small')).toEqual({ kind: 'open' });
  });
});

describe('the model a call falls back to', () => {
  it('is « Automatique » for every plan while it is open and listed (06/10/2026)', () => {
    const c = catalogOf(PLANS, [setting('anthropic/sonnet', { recommended: true })]);
    expect(defaultModel(c, WEEK)).toBe(AUTO_MODEL);
    expect(defaultModel(c, FREE)).toBe(AUTO_MODEL);
    // Withdrawn by OpenRouter, or closed by the owner: the chosen default.
    expect(defaultModel(c, WEEK, new Set(['anthropic/sonnet']))).toBe('anthropic/sonnet');
    const closed = catalogOf(PLANS, [setting(AUTO_MODEL, { enabled: false }), setting('anthropic/sonnet', { recommended: true })]);
    expect(defaultModel(closed, WEEK)).toBe('anthropic/sonnet');
  });

  it('is a paid plan\'s first « Conseillé » it opens, in vendor order', () => {
    const c = catalogOf(PLANS, [
      setting(AUTO_MODEL, { enabled: false }),
      setting('openai/gpt-6', { recommended: true }),
      setting('anthropic/opus', { recommended: true, minPlan: 'pro-100' }),
      setting('anthropic/sonnet', { recommended: true }),
    ]);
    expect(defaultModel(c, WEEK)).toBe('anthropic/sonnet');
    expect(defaultModel(c, PRO)).toBe('anthropic/opus');
  });

  it('is Découverte\'s default otherwise', () => {
    const c = catalogOf(PLANS, [setting(AUTO_MODEL, { enabled: false })]);
    expect(defaultModel(c, WEEK)).toBe('deepseek/flash');
    expect(defaultModel(c, FREE)).toBe('deepseek/flash');
  });
});

describe('a call fitted to the plan', () => {
  const body = (model: string, extra: Record<string, unknown> = {}) => JSON.stringify({ model, messages: [], ...extra });

  it('sends a paid plan\'s closed model to its default, without OpenRouter\'s own fallbacks', () => {
    const c = catalogOf(PLANS, [setting(AUTO_MODEL, { enabled: false }), setting('anthropic/opus', { minPlan: 'pro-100' }), setting('anthropic/sonnet', { recommended: true })]);
    const fitted = fitCall(c, WEEK, '/chat/completions', body('anthropic/opus', { models: ['anthropic/opus'] }));
    expect(fitted).toMatchObject({ ok: true, requested: 'anthropic/opus', served: 'anthropic/sonnet' });
    if (fitted?.ok) expect(JSON.parse(fitted.body)).toEqual({ model: 'anthropic/sonnet', messages: [] });
  });

  it('leaves an open model, and every other path, as they came', () => {
    const c = catalogOf(PLANS, [setting('anthropic/opus', { minPlan: 'pro-100' })]);
    expect(fitCall(c, PRO, '/chat/completions', body('anthropic/opus'))).toBeNull();
    expect(fitCall(c, WEEK, '/embeddings', body('anthropic/opus'))).toBeNull();
  });

  it('sends a model OpenRouter no longer lists to the default, its variants and aliases kept', () => {
    const c = catalogOf(PLANS, [setting('anthropic/sonnet', { recommended: true })]);
    const known = new Set(['anthropic/sonnet', 'deepseek/flash', 'deepseek/flash:free']);
    // A preview withdrawn while an app still has it chosen (05/10/2026).
    expect(fitCall(c, MAX, '/chat/completions', body('x-ai/gone-alpha'), known)).toMatchObject({ ok: true, requested: 'x-ai/gone-alpha', served: 'anthropic/sonnet' });
    expect(fitCall(c, MAX, '/chat/completions', body('deepseek/flash:online'), known)).toBeNull();
    expect(fitCall(c, MAX, '/chat/completions', body('~anthropic/sonnet-latest'), known)).toBeNull();
    // An image model the main list leaves out is not withdrawn.
    expect(fitCall(c, MAX, '/chat/completions', body('openai/gpt-image-1', { modalities: ['image', 'text'] }), known)).toBeNull();
    // The list never read: nothing rerouted for it.
    expect(fitCall(c, MAX, '/chat/completions', body('x-ai/gone-alpha'), null)).toBeNull();
  });

  it('keeps Découverte on its policy: its list, reasoning off', () => {
    const c = catalogOf(PLANS, []);
    const fitted = fitCall(c, FREE, '/chat/completions', body('anthropic/opus'));
    expect(fitted).toMatchObject({ ok: true, served: 'deepseek/flash' });
    if (fitted?.ok) expect(JSON.parse(fitted.body)).toMatchObject({ reasoning: { enabled: false }, models: ['deepseek/flash', 'openai/luna'] });
  });
});

describe('the catalog as a plan\'s picker shows it', () => {
  const upstream = JSON.stringify({
    data: [
      { id: 'meta-llama/llama-5', name: 'Meta: Llama 5' },
      { id: 'anthropic/opus', name: 'Anthropic: Claude Opus' },
      { id: 'anthropic/sonnet', name: 'Anthropic: Claude Sonnet' },
      { id: 'openai/off', name: 'OpenAI: Off' },
    ],
  });
  const c = catalogOf(PLANS, [
    setting('anthropic/opus', { minPlan: 'pro-200', strength: 'puissant' }),
    setting('anthropic/sonnet', { recommended: true }),
    setting('openai/off', { enabled: false }),
  ]);
  const label = planLabeler(PLANS);
  const name = (id: string) => label(PLANS.find((p) => p.id === id)!);

  it('drops hidden models, padlocks the others with the plan that opens them, the default first', () => {
    const { data } = JSON.parse(presentFor(c, WEEK, upstream, name)!) as { data: Array<{ id: string; name: string; baarali: Record<string, unknown> }> };
    expect(data.map((m) => m.id)).toEqual(['anthropic/sonnet', 'meta-llama/llama-5', 'anthropic/opus']);
    expect(data[0]).toMatchObject({ name: 'Claude Sonnet', baarali: { vendor: 'anthropic', vendorName: 'Anthropic', recommended: true } });
    expect(data[1].baarali).toMatchObject({ vendorName: 'Meta', strength: 'Polyvalent' });
    // The dearer of the two Pro plans is « Pro max ».
    expect(data[2].baarali).toEqual({ vendor: 'anthropic', vendorName: 'Anthropic', vendorRank: 0, strength: 'Puissant', recommended: false, unlock: 'Pro max' });
    expect(data[1].baarali.vendorRank).toBe(1);
  });

  it('opens on the plan that has it', () => {
    const { data } = JSON.parse(presentFor(c, MAX, upstream, name)!) as { data: Array<{ id: string; baarali: { unlock?: string } }> };
    expect(data.find((m) => m.id === 'anthropic/opus')?.baarali.unlock).toBeUndefined();
  });

  it('returns null on a catalog it cannot read', () => {
    expect(presentFor(c, WEEK, 'not json', name)).toBeNull();
    expect(presentFor(c, WEEK, '{"models":[]}', name)).toBeNull();
  });
});

describe('Pixazo\'s models', () => {
  const media = (id: string, s: Partial<ModelSetting>) => setting(`media:${id}`, s);

  it('opens a model never set to every plan, Découverte included', () => {
    const c = catalogOf(PLANS, []);
    expect(mediaOpen(c, FREE, 'veo')).toBe(true);
  });

  it('closes a hidden model, and one below its minimum', () => {
    const c = catalogOf(PLANS, [media('veo', { enabled: false }), media('veo-fast', { minPlan: 'pro-100' }), media('lyria', { minPlan: 'gone' })]);
    expect(mediaOpen(c, MAX, 'veo')).toBe(false);
    expect(mediaOpen(c, WEEK, 'veo-fast')).toBe(false);
    expect(mediaOpen(c, PRO, 'veo-fast')).toBe(true);
    // A minimum no plan carries any more opens nothing.
    expect(mediaOpen(c, MAX, 'lyria')).toBe(false);
  });
});

describe('vendors and strengths', () => {
  it('orders vendors as people look for them, the others by name, routers last', () => {
    expect(['openrouter', 'zeta', 'openai', 'alpha', 'anthropic'].sort(compareVendors)).toEqual(['anthropic', 'openai', 'alpha', 'zeta', 'openrouter']);
  });

  it('puts OpenRouter\'s « latest » aliases with their vendor', () => {
    expect(vendorOf('~anthropic/claude-sonnet-latest')).toBe('anthropic');
  });

  it('guesses a strength from the id', () => {
    expect(deduceStrength('qwen/qwen-4-coder')).toBe('codage');
    expect(deduceStrength('deepseek/deepseek-r1')).toBe('raisonnement');
    expect(deduceStrength('google/gemini-3-flash')).toBe('rapide');
    expect(deduceStrength('anthropic/claude-opus-5')).toBe('puissant');
    expect(deduceStrength('perplexity/sonar-pro')).toBe('recherche');
    expect(deduceStrength('openai/gpt-6')).toBe('polyvalent');
  });
});

describe('« Automatique », Jev Router within the plan (06/10/2026)', () => {
  const body = (model: string, extra: Record<string, unknown> = {}) => JSON.stringify({ model, messages: [], ...extra });
  const KNOWN = new Set([AUTO_MODEL, 'deepseek/flash', 'deepseek/pro', 'openai/luna', 'openai/gpt-6', 'anthropic/opus', 'anthropic/sonnet', 'openrouter/auto']);
  const plugin = (b: string) => (JSON.parse(b) as { plugins: Array<Record<string, unknown>> }).plugins.find((p) => p.id === 'jev-router');

  it('routes Découverte within its list, every other model excluded, an app\'s own plugin replaced', () => {
    const c = catalogOf(PLANS, []);
    const fitted = fitCall(c, FREE, '/chat/completions', body(AUTO_MODEL, { plugins: [{ id: 'jev-router', models: ['anthropic/*'] }, { id: 'web' }] }), KNOWN);
    expect(fitted).toMatchObject({ ok: true, served: AUTO_MODEL });
    if (!fitted?.ok) return;
    const sent = JSON.parse(fitted.body) as Record<string, unknown>;
    expect(sent).toMatchObject({ model: AUTO_MODEL, reasoning: { enabled: false } });
    expect(sent.models).toBeUndefined();
    expect(sent.plugins).toContainEqual({ id: 'web' });
    expect(plugin(fitted.body)).toEqual({
      id: 'jev-router',
      models: ['deepseek/flash', 'openai/luna'],
      excluded_models: ['deepseek/pro', 'openai/gpt-6', 'anthropic/*', 'openrouter/*'],
    });
  });

  it('sends Découverte\'s other calls to it too, and never lists it as a fallback', () => {
    const c = catalogOf(PLANS, []);
    const fitted = fitCall(c, FREE, '/chat/completions', body('anthropic/opus'), KNOWN);
    expect(fitted).toMatchObject({ ok: true, requested: 'anthropic/opus', served: AUTO_MODEL });
    const listed = fitCall(c, FREE, '/chat/completions', body('openai/luna'), KNOWN);
    if (listed?.ok) expect(JSON.parse(listed.body).models).toEqual(['openai/luna', 'deepseek/flash']);
  });

  it('does not route Découverte while the catalog is unknown: its first model instead', () => {
    const c = catalogOf(PLANS, []);
    const fitted = fitCall(c, FREE, '/chat/completions', body(AUTO_MODEL), null);
    expect(fitted).toMatchObject({ ok: true, requested: AUTO_MODEL, served: 'deepseek/flash' });
    if (fitted?.ok) expect(JSON.parse(fitted.body)).toMatchObject({ model: 'deepseek/flash', models: ['deepseek/flash', 'openai/luna'] });
  });

  it('excludes from a paid plan\'s routing what the plan does not open', () => {
    const c = catalogOf(PLANS, [setting('anthropic/opus', { minPlan: 'pro-100' }), setting('openai/gpt-6', { enabled: false })]);
    const week = fitCall(c, WEEK, '/chat/completions', body(AUTO_MODEL), KNOWN);
    expect(week?.ok && plugin(week.body)).toEqual({ id: 'jev-router', excluded_models: ['openrouter/*', 'anthropic/opus', 'openai/gpt-6'] });
    const pro = fitCall(c, PRO, '/chat/completions', body(AUTO_MODEL), KNOWN);
    expect(pro?.ok && plugin(pro.body)).toEqual({ id: 'jev-router', excluded_models: ['openrouter/*', 'openai/gpt-6'] });
  });

  it('shows it first, as « Automatique » in Baarali\'s group, and never Jev itself', () => {
    const c = catalogOf(PLANS, []);
    const raw = JSON.stringify({ data: [{ id: 'deepseek/flash', name: 'DeepSeek: Flash' }, { id: AUTO_MODEL, name: 'TypeSafe: Jev Router' }, { id: 'typesafe/jev-1.13', name: 'TypeSafe: Jev 1.13' }] });
    const shown = JSON.parse(presentFor(c, FREE, raw, (id) => id)!) as { data: Array<{ id: string; name: string; baarali: Record<string, unknown> }> };
    expect(shown.data.map((m) => m.id)).toEqual([AUTO_MODEL, 'deepseek/flash']);
    expect(shown.data[0]).toMatchObject({ name: 'Automatique', baarali: { vendor: 'baarali', vendorName: 'Baarali', vendorRank: 0, strength: 'Le bon modèle pour chaque tâche' } });
  });

  it('answers /systemone with Jev only, on every plan', () => {
    const c = catalogOf(PLANS, []);
    for (const p of [FREE, WEEK]) {
      const fitted = fitCall(c, p, '/systemone', JSON.stringify({ model: 'anthropic/opus', state: {}, questions: {} }));
      expect(fitted).toMatchObject({ ok: true, served: 'typesafe/jev-1.13' });
    }
    expect(fitCall(c, FREE, '/systemone', JSON.stringify({ model: 'jev-latest', questions: {} }))).toMatchObject({ ok: true, served: 'jev-latest' });
  });
});
