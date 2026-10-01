import { applyPolicy, presentCatalog } from './models.js';
import type { Account, ControlStore } from './store.js';
import {
  admit,
  budgetsForWeek,
  charge,
  creditsForCost,
  initialState,
  open,
  type QuotaState,
} from './quota.js';

// /v1/llm: the instance's OpenRouter-compatible gateway (core
// models/gateway.ts sets baseURL `${API_URL}/v1/llm`). The OpenRouter key
// never leaves the control plane (architecture §3.14), and every call goes
// through the usage quota (§3.5, decided 30/09/2026) and the plan's model
// policy (models.ts).

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export interface ProxyDeps {
  store: ControlStore;
  openRouterKey: string;
  /** Sent as HTTP-Referer, OpenRouter's app attribution. */
  publicUrl: string;
  appName: string;
  fetch: typeof fetch;
  now: () => number;
  upstreamBase?: string;
}

async function currentState(store: ControlStore, account: Account): Promise<QuotaState> {
  return (await store.quotaState(account.id)) ?? initialState(account.createdAt);
}

function errorResponse(status: number, error: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Asks OpenRouter for the call's cost, so the quota counts what was spent. */
function withUsageAccounting(raw: string): { body: string; model: string | null } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const usage = obj.usage && typeof obj.usage === 'object' ? obj.usage : {};
      obj.usage = { ...usage, include: true };
      return { body: JSON.stringify(obj), model: typeof obj.model === 'string' ? obj.model : null };
    }
  } catch {
    // Not JSON: forwarded as is, and charged the floor if it succeeds.
  }
  return { body: raw, model: null };
}

/** Finds `usage.cost` in an SSE stream; OpenRouter sends it in the last chunk. */
class SseCostScanner {
  private buffer = '';
  private readonly decoder = new TextDecoder();
  cost: unknown = undefined;

  push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.scan(line);
  }

  finish(): void {
    this.scan(this.buffer);
    this.buffer = '';
  }

  private scan(line: string): void {
    if (!line.startsWith('data:') || !line.includes('"usage"')) return;
    try {
      const data = JSON.parse(line.slice(5).trim()) as { usage?: { cost?: unknown } };
      if (data.usage && 'cost' in data.usage) this.cost = data.usage.cost;
    } catch {
      // A partial or non-JSON data line carries no cost.
    }
  }
}

const HOP_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection'];

function passHeaders(upstream: Response): Headers {
  const headers = new Headers(upstream.headers);
  for (const h of HOP_HEADERS) headers.delete(h);
  return headers;
}

export async function proxyLlm(deps: ProxyDeps, account: Account, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const subpath = url.pathname.replace(/^\/v1\/llm/, '') || '/';
  const target = `${deps.upstreamBase ?? OPENROUTER_BASE}${subpath}${url.search}`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${deps.openRouterKey}`,
    'http-referer': deps.publicUrl,
    'x-title': deps.appName,
  };
  const accept = req.headers.get('accept');
  if (accept) headers.accept = accept;

  const plan = await deps.store.plan(account.planId);
  if (!plan) return errorResponse(403, { code: 'no_plan', message: 'Account has no active plan' });

  // Reads (the model catalog) cost nothing and are not metered.
  if (req.method === 'GET' || req.method === 'HEAD') {
    const upstream = await deps.fetch(target, { method: req.method, headers });
    if (subpath === '/models' && req.method === 'GET' && upstream.ok) {
      const filtered = presentCatalog(plan.models, await upstream.text());
      if (filtered === null) return errorResponse(502, { code: 'upstream_invalid', message: 'Unexpected model catalog' });
      return new Response(filtered, { status: 200, headers: passHeaders(upstream) });
    }
    return new Response(upstream.body, { status: upstream.status, headers: passHeaders(upstream) });
  }

  // Checked before the quota: a refused call must not open a session.
  let raw = await req.text();
  let requestedModel: string | null = null;
  if (plan.models) {
    const fitted = applyPolicy(plan.models, subpath, raw);
    if (!fitted.ok) return errorResponse(fitted.status, { code: fitted.code, message: fitted.message });
    raw = fitted.body;
    requestedModel = fitted.requested !== fitted.served ? fitted.requested : null;
  }
  const budgets = budgetsForWeek(plan.weekCredits);

  const started = deps.now();
  const before = await currentState(deps.store, account);
  const admission = admit(before, budgets, started);
  if (!admission.ok) {
    return errorResponse(429, {
      code: 'quota_reached',
      window: admission.window,
      resets_at: new Date(admission.resetsAt).toISOString(),
      message: `Usage limit reached for this ${admission.window}`,
    });
  }
  await deps.store.saveQuotaState(account.id, open(before, started));

  const { body, model } = withUsageAccounting(raw);
  headers['content-type'] = req.headers.get('content-type') ?? 'application/json';

  let settled = false;
  const settle = async (status: number, cost: unknown, succeeded: boolean) => {
    if (settled) return;
    settled = true;
    const at = deps.now();
    // A failed call is not billed by OpenRouter, so it is not counted either.
    const { credits, estimated } = succeeded ? creditsForCost(cost) : { credits: 0, estimated: false };
    // Re-read: other calls may have been charged while this one ran.
    const state = await currentState(deps.store, account);
    await deps.store.saveQuotaState(account.id, charge(state, credits, at));
    await deps.store.appendUsage({
      accountId: account.id,
      at,
      path: subpath,
      model,
      requestedModel,
      status,
      credits,
      estimated,
      useCase: req.headers.get('x-rowboat-use-case'),
      agentName: req.headers.get('x-rowboat-agent-name'),
    });
  };

  let upstream: Response;
  try {
    upstream = await deps.fetch(target, { method: req.method, headers, body });
  } catch {
    await settle(502, undefined, false);
    return errorResponse(502, { code: 'upstream_unreachable', message: 'Model provider unreachable' });
  }
  const ok = upstream.ok;
  const isStream = (upstream.headers.get('content-type') ?? '').includes('text/event-stream');

  if (!isStream || !upstream.body) {
    const text = await upstream.text();
    let cost: unknown;
    try {
      cost = (JSON.parse(text) as { usage?: { cost?: unknown } }).usage?.cost;
    } catch {
      cost = undefined;
    }
    await settle(upstream.status, cost, ok);
    return new Response(text, { status: upstream.status, headers: passHeaders(upstream) });
  }

  const scanner = new SseCostScanner();
  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          // Count before closing: once closed, the client may already ask
          // for the gauge and must see this call in it.
          scanner.finish();
          await settle(upstream.status, scanner.cost, ok);
          controller.close();
          return;
        }
        scanner.push(value);
        controller.enqueue(value);
      } catch (err) {
        await settle(upstream.status, scanner.cost, ok);
        controller.error(err);
      }
    },
    // The client left mid-stream: the tokens are spent anyway, so count them.
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await settle(upstream.status, scanner.cost, ok);
    },
  });
  return new Response(stream, { status: upstream.status, headers: passHeaders(upstream) });
}
