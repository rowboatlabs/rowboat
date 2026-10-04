import { applyPolicy, displayName, type ModelPolicy, type PolicyResult } from './models.js';
import type { Plan } from './store.js';

// Which models each plan sees and calls, set from the admin console (decided
// 03/10/2026, after wenastudio's catalog). A model has a setting once the
// owner touched it: shown or hidden, the plan it opens from, « Conseillé »,
// its strength, and for Découverte its place in the free list. A model never
// touched stays open to the paid plans, as before the console, and out of
// Découverte: nothing disappears from anyone's picker on the day this ships.

export interface ModelSetting {
  /** The OpenRouter id, `vendor/model`. */
  modelId: string;
  enabled: boolean;
  /** The cheapest paid plan that opens it; null: every paid plan. */
  minPlan: string | null;
  /** Shown first in its vendor's group, with « Conseillé ». */
  recommended: boolean;
  /** Written under its name; null: deduced from its id. */
  strength: Strength | null;
  /** Its place in Découverte's list (0 is the default); null: not in it. */
  freeRank: number | null;
}

/** What a model is good at, the word under its name in the picker (wenastudio, 26/09/2026). */
export const STRENGTHS = {
  polyvalent: 'Polyvalent',
  puissant: 'Puissant',
  raisonnement: 'Raisonnement',
  codage: 'Codage',
  recherche: 'Recherche web',
  analyse: "Analyse d'images",
  rapide: 'Rapide',
} as const;

export type Strength = keyof typeof STRENGTHS;

export const isStrength = (s: unknown): s is Strength => typeof s === 'string' && s in STRENGTHS;

/**
 * Vendors in the order people look for them; the others follow by name, and
 * the routers, which make no model of their own, close the list. The same
 * order in the console and in the apps, so the list keeps its shape.
 */
export const VENDOR_ORDER = ['anthropic', 'openai', 'google', 'x-ai', 'mistralai', 'deepseek', 'qwen', 'z-ai', 'moonshotai', 'minimax'];
const ROUTERS = new Set(['openrouter']);

const VENDOR_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  'x-ai': 'xAI',
  mistralai: 'Mistral',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  'z-ai': 'Z.ai',
  moonshotai: 'Moonshot',
  minimax: 'MiniMax',
  'meta-llama': 'Meta',
  nvidia: 'NVIDIA',
  microsoft: 'Microsoft',
  amazon: 'Amazon',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  openrouter: 'OpenRouter',
};

/** `~anthropic/…` is OpenRouter's alias for a vendor's latest model: same vendor. */
export const vendorOf = (modelId: string) => (modelId.split('/')[0] ?? modelId).replace(/^~/, '');

export function vendorName(vendor: string): string {
  return VENDOR_NAMES[vendor] ?? vendor.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Sorts vendor ids: the known order first, then by name, routers last. */
export function compareVendors(a: string, b: string): number {
  const rank = (v: string): [number, number, string] => {
    const i = VENDOR_ORDER.indexOf(v);
    if (i >= 0) return [0, i, v];
    return [ROUTERS.has(v) ? 2 : 1, 0, vendorName(v).toLowerCase()];
  };
  const [x, y] = [rank(a), rank(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
}

/** A first guess from the id, until the owner sets one in the console. */
export function deduceStrength(modelId: string): Strength {
  const id = modelId.toLowerCase();
  if (/coder|codestral|codex|devstral/.test(id)) return 'codage';
  if (/sonar|search|online/.test(id)) return 'recherche';
  if (/\b(r1|o\d)\b|reason|think|qwq/.test(id)) return 'raisonnement';
  if (/vision|-vl\b|-vl-/.test(id)) return 'analyse';
  if (/flash|mini|nano|lite|haiku|small|tiny|fast|turbo/.test(id)) return 'rapide';
  if (/opus|ultra|large|max|-pro\b|-pro-/.test(id)) return 'puissant';
  return 'polyvalent';
}

/**
 * Two Pro levels share a display name: the dearer one is « Pro max », the
 * owner's word for it (03/10/2026). Any other plan keeps its name.
 */
export function planLabeler(plans: Plan[]): (plan: Plan) => string {
  const eur = (p: Plan) => p.monthlyPrices.find((m) => m.currency === 'EUR')?.amount ?? 0;
  return (plan) => {
    const twins = plans.filter((p) => p.displayName === plan.displayName);
    return twins.length > 1 && eur(plan) === Math.max(...twins.map(eur)) ? `${plan.displayName} max` : plan.displayName;
  };
}

export const isFreePlan = (plan: Plan) => plan.category === 'free';

/** Découverte's models in order: the console's list, or the code's until it is set. */
export function freeModels(settings: ModelSetting[], fallback: ModelPolicy | null): string[] {
  const set = settings
    .filter((s) => s.enabled && s.freeRank !== null)
    .sort((a, b) => a.freeRank! - b.freeRank! || a.modelId.localeCompare(b.modelId))
    .map((s) => s.modelId);
  return set.length ? set : (fallback?.models ?? []);
}

/** The plans in catalog order, cheapest first: that order says what « dès » means. */
function rankIn(plans: Plan[], planId: string | null): number {
  if (planId === null) return plans.findIndex((p) => !isFreePlan(p));
  const i = plans.findIndex((p) => p.id === planId);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

export type Access =
  | { kind: 'open' }
  /** Shown with a padlock and the plan that opens it; never called. */
  | { kind: 'locked'; unlock: string }
  | { kind: 'hidden' };

export interface Catalog {
  plans: Plan[];
  settings: Map<string, ModelSetting>;
  /** Découverte's list, in order. */
  free: string[];
}

export function catalogOf(plans: Plan[], settings: ModelSetting[]): Catalog {
  const freePlan = plans.find(isFreePlan) ?? null;
  return { plans, settings: new Map(settings.map((s) => [s.modelId, s])), free: freeModels(settings, freePlan?.models ?? null) };
}

export function accessFor(c: Catalog, plan: Plan, modelId: string): Access {
  const s = c.settings.get(modelId);
  if (s && !s.enabled) return { kind: 'hidden' };
  const firstPaid = c.plans.find((p) => !isFreePlan(p));
  if (isFreePlan(plan)) {
    if (c.free.includes(modelId)) return { kind: 'open' };
    // A model the owner set up shows Découverte what a plan would open;
    // the hundreds never touched would only bury the free list.
    if (!s) return { kind: 'hidden' };
    const unlock = s.minPlan ?? firstPaid?.id;
    return unlock ? { kind: 'locked', unlock } : { kind: 'hidden' };
  }
  if (c.free.includes(modelId) || !s?.minPlan) return { kind: 'open' };
  return rankIn(c.plans, s.minPlan) > rankIn(c.plans, plan.id) ? { kind: 'locked', unlock: s.minPlan } : { kind: 'open' };
}

/**
 * The model a call falls back to when it names one the plan cannot use:
 * core's background work asks for its own models and must keep running.
 * Découverte: the first of its list. A paid plan: its first « Conseillé »
 * model in vendor order, else Découverte's default, cheap and always there.
 */
export function defaultModel(c: Catalog, plan: Plan): string | null {
  if (!isFreePlan(plan)) {
    const recommended = [...c.settings.values()]
      .filter((s) => s.recommended && accessFor(c, plan, s.modelId).kind === 'open')
      .sort((a, b) => compareVendors(vendorOf(a.modelId), vendorOf(b.modelId)) || a.modelId.localeCompare(b.modelId));
    if (recommended[0]) return recommended[0].modelId;
  }
  return c.free[0] ?? null;
}

/** What the picker needs beside a model's id and name (the apps read `baarali`). */
export interface PickerMeta {
  vendor: string;
  vendorName: string;
  /** The vendor's place in the picker: the apps sort by it rather than keep their own copy of the order. */
  vendorRank: number;
  strength: string;
  recommended: boolean;
  /** Set when the plan does not open it: the plan's name that does. */
  unlock?: string;
}

type RawModel = { id: string; name?: unknown } & Record<string, unknown>;

/**
 * The catalog as one plan's picker shows it (decided 03/10/2026): hidden
 * models dropped, locked ones kept with the plan that opens them, readable
 * names, and the plan's default first, since core seeds a new install with
 * the first model listed (core models/rowboat-selection.ts). null when the
 * upstream catalog cannot be read.
 */
export function presentFor(c: Catalog, plan: Plan, raw: string, planName: (id: string) => string): string | null {
  let parsed: { data?: unknown };
  try {
    parsed = JSON.parse(raw) as { data?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.data)) return null;
  const fallback = defaultModel(c, plan);
  const listed = parsed.data.filter((m): m is RawModel => !!m && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string');
  // Ranked among the vendors this plan sees, hidden ones left out.
  const vendors = [...new Set(listed.filter((m) => accessFor(c, plan, m.id).kind !== 'hidden').map((m) => vendorOf(m.id)))].sort(compareVendors);
  const data = listed
    .flatMap((m) => {
      const access = accessFor(c, plan, m.id);
      if (access.kind === 'hidden') return [];
      const s = c.settings.get(m.id);
      const vendor = vendorOf(m.id);
      const baarali: PickerMeta = {
        vendor,
        vendorName: vendorName(vendor),
        vendorRank: vendors.indexOf(vendor),
        strength: STRENGTHS[s?.strength ?? deduceStrength(m.id)],
        recommended: s?.recommended ?? false,
        ...(access.kind === 'locked' ? { unlock: planName(access.unlock) } : {}),
      };
      return [{ ...m, ...(typeof m.name === 'string' ? { name: displayName(m.name) } : {}), baarali }];
    })
    .sort((a, b) => Number(b.id === fallback) - Number(a.id === fallback));
  return JSON.stringify({ ...parsed, data });
}

/**
 * Fits one call to the plan. Découverte keeps its policy (its list, reasoning
 * off). A paid plan calls what it opens; a model it does not is replaced by
 * its default rather than refused, like Découverte's.
 */
export function policyFor(c: Catalog, plan: Plan): ModelPolicy | null {
  if (isFreePlan(plan)) return { models: c.free, settings: plan.models?.settings ?? {} };
  return null;
}

/**
 * One call, fitted to the plan: Découverte by its policy; a paid plan's
 * chat call naming a model it does not open goes to the plan's default.
 * null: the call goes out as it came.
 */
export function fitCall(c: Catalog, plan: Plan, path: string, raw: string): PolicyResult | null {
  const policy = policyFor(c, plan);
  if (policy) return applyPolicy(policy, path, raw);
  if (path !== '/chat/completions') return null;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    body = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const requested = typeof body.model === 'string' ? body.model : null;
  if (!requested || accessFor(c, plan, requested).kind === 'open') return null;
  const served = defaultModel(c, plan);
  if (!served) return { ok: false, status: 403, code: 'not_in_plan', message: 'This plan does not include this model' };
  // OpenRouter's own fallbacks could name the closed model again.
  const { models: _fallbacks, ...rest } = body;
  return { ok: true, body: JSON.stringify({ ...rest, model: served }), requested, served };
}

export interface PickerModel {
  id: string;
  name?: string;
  baarali: PickerMeta;
}

/**
 * The picker's order (03/10/2026), the same in the console's preview and in
 * the apps: one group per vendor, in vendor order; inside, « Conseillé »
 * first, then what the plan opens, then what it does not, each by name.
 */
export function pickerGroups<T extends PickerModel>(models: T[]): Array<{ vendor: string; name: string; models: T[] }> {
  const groups = new Map<string, T[]>();
  for (const m of models) groups.set(m.baarali.vendor, [...(groups.get(m.baarali.vendor) ?? []), m]);
  const rank = (m: T) => (m.baarali.unlock ? 2 : m.baarali.recommended ? 0 : 1);
  return [...groups.entries()]
    .sort(([, a], [, b]) => a[0].baarali.vendorRank - b[0].baarali.vendorRank)
    .map(([vendor, list]) => ({
      vendor,
      name: list[0].baarali.vendorName,
      models: [...list].sort((a, b) => rank(a) - rank(b) || (a.name ?? a.id).localeCompare(b.name ?? b.id)),
    }));
}

/**
 * Pixazo's models (video, speech, music) under the same settings (decided
 * 03/10/2026), keyed `media:<id>`: Pixazo lists no models, so the catalog is
 * media.ts, each model with its own request adapter. Paid from media
 * credits, so every plan may open one, Découverte included. A model never
 * set is open to all, as before the console. No padlock: only the agent
 * reads this list, and it has no use for what it cannot call.
 */
export const mediaKey = (id: string) => `media:${id}`;

export function mediaOpen(c: Catalog, plan: Plan, id: string): boolean {
  const s = c.settings.get(mediaKey(id));
  if (!s) return true;
  if (!s.enabled) return false;
  if (s.minPlan === null) return true;
  const rank = (planId: string) => c.plans.findIndex((p) => p.id === planId);
  // A minimum no plan carries any more opens nothing, rather than everything.
  return rank(s.minPlan) >= 0 && rank(s.minPlan) <= rank(plan.id);
}

export const mediaRecommended = (c: Catalog, id: string) => c.settings.get(mediaKey(id))?.recommended ?? false;
