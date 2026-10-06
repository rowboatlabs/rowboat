// Which models a plan may call (architecture §3.5 "Les modèles par forfait",
// decided 30/09/2026). Paid plans call any model, within their quota. A plan
// with a policy calls only its list: the cheap, tool-capable models its free
// budget was sized on.

export interface ModelPolicy {
  /** OpenRouter ids, by preference: the first is the default, the others take over if it fails. */
  models: string[];
  /** Body fields forced on every call, e.g. reasoning off (a reasoning model spends its tokens thinking). */
  settings: Record<string, unknown>;
}

export type PolicyResult =
  | { ok: true; body: string; requested: string | null; served: string }
  | { ok: false; status: number; code: string; message: string };

/** Only chat completions: the call core makes for text (core models/gateway.ts). */
const POLICY_PATHS = new Set(['/chat/completions']);

/**
 * Rewrites one call to fit the policy. A model outside the list is replaced
 * by the default rather than refused: core's background work (notes, titles,
 * knowledge) asks for its own models, and must keep running on a free plan.
 * An image request is refused instead, since no text model can answer it.
 */
export function applyPolicy(policy: ModelPolicy, path: string, raw: string): PolicyResult {
  if (!POLICY_PATHS.has(path)) {
    return { ok: false, status: 403, code: 'not_in_plan', message: 'This plan does not include this kind of call' };
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, code: 'invalid_request', message: 'Expected a JSON body' };
  }
  if (Array.isArray(body.modalities) && body.modalities.includes('image')) {
    return { ok: false, status: 403, code: 'not_in_plan', message: 'This plan does not include image generation' };
  }

  const requested = typeof body.model === 'string' ? body.model : null;
  const served = requested && policy.models.includes(requested) ? requested : policy.models[0];
  // OpenRouter tries `models` in order when one fails (provider down, rate limited).
  // A router is never a fallback: it would be another round of choosing.
  const fallbacks = policy.models.filter((m) => m !== served && m !== 'typesafe/jev-router');
  const rewritten = { ...body, ...policy.settings, model: served, models: [served, ...fallbacks] };
  return { ok: true, body: JSON.stringify(rewritten), requested, served };
}

/**
 * OpenRouter names a model "Vendor: Model" ("DeepSeek: DeepSeek V4.1 Flash");
 * the picker already groups by provider, so the vendor prefix is noise.
 */
export function displayName(name: string): string {
  const short = name.replace(/^[^:]+:\s*/, '').trim();
  return short || name;
}
