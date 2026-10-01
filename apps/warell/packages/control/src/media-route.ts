import { MEDIA_MODELS, mediaCredits, parseMediaRequest } from './media.js';
import { admitCost, budgetsForWeek, charge, initialState, refund } from './quota.js';
import type { Account, ControlStore, MediaJob } from './store.js';

// /v1/media: video, speech and music through Pixazo (architecture §3.5 "Les
// médias", decided 30/09/2026). The Pixazo key never leaves the control
// plane. A generation is asynchronous: POST charges and submits, GET follows
// it and refunds it once if Pixazo reports a failure.

export const PIXAZO_BASE = 'https://gateway.pixazo.ai';

export interface MediaDeps {
  store: ControlStore;
  /** Unset: media is off and every route answers 503. */
  pixazoKey?: string;
  fetch: typeof fetch;
  now: () => number;
  pixazoBase?: string;
}

function error(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

function pixazoHeaders(key: string): Record<string, string> {
  // Azure API Management: the key goes in its own header, not as a bearer.
  return { 'content-type': 'application/json', 'cache-control': 'no-cache', 'ocp-apim-subscription-key': key };
}

/** The models a plan may generate with. Découverte has none: its budget is sized for text. */
async function mediaAllowed(store: ControlStore, account: Account) {
  const plan = await store.plan(account.planId);
  return plan && plan.category !== 'free' ? plan : null;
}

export async function listMediaModels(deps: MediaDeps, account: Account): Promise<Response> {
  const plan = await mediaAllowed(deps.store, account);
  const data = plan && deps.pixazoKey
    ? MEDIA_MODELS.map((m) => ({ id: m.id, kind: m.kind, name: m.displayName, ...(m.durations ? { durations: m.durations } : {}) }))
    : [];
  return Response.json({ data });
}

export async function createGeneration(deps: MediaDeps, account: Account, req: Request): Promise<Response> {
  const plan = await mediaAllowed(deps.store, account);
  if (!plan) return error(403, 'not_in_plan', 'This plan does not include media generation');
  if (!deps.pixazoKey) return error(503, 'media_unavailable', 'Media generation is not configured');

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, 'invalid_request', 'Expected a JSON body');
  }
  const parsed = parseMediaRequest(raw);
  if (!parsed.ok) return error(400, 'invalid_request', parsed.message);
  const { model, req: media } = parsed;

  const credits = mediaCredits(model, media);
  const budgets = budgetsForWeek(plan.weekCredits);
  const at = deps.now();
  const before = (await deps.store.quotaState(account.id)) ?? initialState(account.createdAt);
  const admission = admitCost(before, budgets, credits, at);
  if (!admission.ok) {
    return admission.reason === 'over_plan'
      ? error(403, 'over_plan', `This generation costs more than the plan's whole ${admission.window}`, { window: admission.window })
      : error(429, 'quota_reached', `Not enough left in this ${admission.window}`, {
          window: admission.window,
          resets_at: new Date(admission.resetsAt).toISOString(),
        });
  }
  // Charged before submitting: two generations sent together must not both
  // pass the check against the same remaining budget.
  await deps.store.saveQuotaState(account.id, charge(before, credits, at));

  const { path, body } = model.submit(media);
  let id: string | null = null;
  try {
    const res = await deps.fetch(`${deps.pixazoBase ?? PIXAZO_BASE}${path}`, {
      method: 'POST',
      headers: pixazoHeaders(deps.pixazoKey),
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const found = data.request_id ?? data.requestId ?? data.task_id ?? data.id;
      id = typeof found === 'string' && found ? found : null;
    }
  } catch {
    id = null;
  }
  if (!id) {
    const state = (await deps.store.quotaState(account.id)) ?? before;
    await deps.store.saveQuotaState(account.id, refund(state, credits, at, deps.now()));
    return error(502, 'upstream_failed', 'The media provider refused the request');
  }

  const job: MediaJob = { id, accountId: account.id, model: model.id, credits, chargedAt: at, status: 'pending', url: null, refunded: false };
  await deps.store.saveMediaJob(job);
  await deps.store.appendUsage({
    accountId: account.id,
    at,
    path: `/media/${model.kind}`,
    model: model.id,
    requestedModel: null,
    status: 202,
    credits,
    estimated: model.kind === 'speech',
    useCase: req.headers.get('x-rowboat-use-case'),
    agentName: req.headers.get('x-rowboat-agent-name'),
  });
  return Response.json({ id, status: job.status, model: model.id, kind: model.kind }, { status: 202 });
}

function normalizeStatus(raw: unknown): MediaJob['status'] {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'COMPLETED' || s === 'SUCCEEDED' || s === 'SUCCESS') return 'completed';
  if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELLED' || s === 'CANCELED') return 'failed';
  if (s === 'PROCESSING' || s === 'RUNNING' || s === 'IN_PROGRESS') return 'processing';
  return 'pending';
}

function mediaUrl(data: Record<string, unknown>): string | null {
  const output = data.output && typeof data.output === 'object' ? (data.output as Record<string, unknown>) : {};
  const media = output.media_url ?? output.url ?? data.media_url;
  const url = Array.isArray(media) ? media[0] : media;
  return typeof url === 'string' && url ? url : null;
}

export async function getGeneration(deps: MediaDeps, account: Account, id: string): Promise<Response> {
  const job = await deps.store.mediaJob(id);
  // Someone else's generation does not exist, as far as this account knows.
  if (!job || job.accountId !== account.id) return error(404, 'not_found', 'No such generation');
  const view = (j: MediaJob) => Response.json({ id: j.id, status: j.status, model: j.model, url: j.url });
  if (job.status === 'completed' || job.status === 'failed' || !deps.pixazoKey) return view(job);

  let data: Record<string, unknown>;
  try {
    const res = await deps.fetch(`${deps.pixazoBase ?? PIXAZO_BASE}/v2/requests/status/${encodeURIComponent(id)}`, {
      headers: pixazoHeaders(deps.pixazoKey),
    });
    if (!res.ok) return view(job);
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // Still running as far as we know: the next poll asks again.
    return view(job);
  }

  let status = normalizeStatus(data.status);
  const url = mediaUrl(data);
  // A completed job without a file is no deliverable: treated as failed.
  if (status === 'completed' && !url) status = 'failed';
  const next: MediaJob = { ...job, status, url: status === 'completed' ? url : null };

  if (status === 'failed' && !job.refunded) {
    const now = deps.now();
    const state = (await deps.store.quotaState(account.id)) ?? initialState(account.createdAt);
    await deps.store.saveQuotaState(account.id, refund(state, job.credits, job.chargedAt, now));
    next.refunded = true;
    await deps.store.appendUsage({
      accountId: account.id,
      at: now,
      path: '/media/refund',
      model: job.model,
      requestedModel: null,
      status: 200,
      credits: -job.credits,
      estimated: false,
      useCase: null,
      agentName: null,
    });
  }
  await deps.store.saveMediaJob(next);
  return view(next);
}
