import { randomUUID } from 'node:crypto';
import { CREDITS_PER_DOLLAR } from '@x/shared/dist/billing.js';
import { MEDIA_MODELS, mediaCredits, parseMediaRequest } from './media.js';
import type { Account, ControlStore, MediaJob } from './store.js';

// /v1/media: video, speech and music through Pixazo (architecture §3.5 "Les
// médias"). The Pixazo key never leaves the control plane. A generation is
// paid from the account's media credits (decided 01/10/2026): POST charges
// and submits, GET follows it and refunds it once if Pixazo reports a failure.

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

/**
 * Every plan, Découverte included: credits are paid for before they are
 * spent, so they need no budget from the plan (decided 01/10/2026).
 * `credits` is the price of the model's default request.
 */
export async function listMediaModels(deps: MediaDeps, account: Account): Promise<Response> {
  const data = deps.pixazoKey
    ? MEDIA_MODELS.map((m) => ({
        id: m.id,
        kind: m.kind,
        name: m.displayName,
        ...(m.durations ? { durations: m.durations } : {}),
        credits: mediaCredits(m, { model: m.id, prompt: 'x' }),
      }))
    : [];
  return Response.json({ data, balance: await deps.store.mediaBalance(account.id) });
}

export async function mediaBalance(deps: MediaDeps, account: Account): Promise<Response> {
  return Response.json({ credits: await deps.store.mediaBalance(account.id) });
}

/** What the credits went to (03/10/2026): the latest entries, each with the kind of media it paid for. */
export async function mediaHistory(deps: MediaDeps, account: Account): Promise<Response> {
  const entries = await deps.store.mediaHistory(account.id, 50);
  const kindOf = (model: string | null) => MEDIA_MODELS.find((m) => m.id === model);
  return Response.json({
    data: entries.map((e) => ({
      at: new Date(e.at).toISOString(),
      kind: e.kind,
      credits: e.credits,
      media: kindOf(e.model)?.kind ?? null,
      model: kindOf(e.model)?.displayName ?? null,
    })),
  });
}

export async function createGeneration(deps: MediaDeps, account: Account, req: Request): Promise<Response> {
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
  const at = deps.now();
  const chargeRef = randomUUID();
  // Charged before submitting, in one atomic step: two generations sent
  // together never both spend the same credits.
  const charged = await deps.store.applyMediaEntry({ accountId: account.id, at, kind: 'charge', credits: -credits, reference: chargeRef });
  if (charged !== 'applied') {
    return error(402, 'insufficient_media_credits', 'Not enough media credits for this generation', {
      cost: credits,
      balance: await deps.store.mediaBalance(account.id),
    });
  }

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
    await deps.store.applyMediaEntry({ accountId: account.id, at: deps.now(), kind: 'refund', credits, reference: chargeRef });
    return error(502, 'upstream_failed', 'The media provider refused the request');
  }

  const job: MediaJob = { id, accountId: account.id, model: model.id, credits, chargeRef, status: 'pending', url: null, refunded: false };
  await deps.store.saveMediaJob(job);
  await deps.store.appendUsage({
    accountId: account.id,
    at,
    path: `/media/${model.kind}`,
    model: model.id,
    requestedModel: null,
    status: 202,
    // Usage records count our cost in the quota's unit, for every kind of call.
    credits: Math.round(model.costUsd(media) * CREDITS_PER_DOLLAR),
    estimated: model.kind === 'speech',
    useCase: req.headers.get('x-rowboat-use-case'),
    agentName: req.headers.get('x-rowboat-agent-name'),
  });
  return Response.json(
    { id, status: job.status, model: model.id, kind: model.kind, credits, balance: await deps.store.mediaBalance(account.id) },
    { status: 202 },
  );
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
    // The ledger applies a refund once per charge, even if two polls race here.
    await deps.store.applyMediaEntry({ accountId: account.id, at: deps.now(), kind: 'refund', credits: job.credits, reference: job.chargeRef });
    next.refunded = true;
  }
  await deps.store.saveMediaJob(next);
  return view(next);
}
