// Agent37's hosting API, for the app's Add flow (Harbor spec §8 Connectors,
// Agent37, 2026-10-05). An Agent37 agent is one instance, so adding one finds
// or creates that instance with the person's key while they are adding it:
// setup is the app's, and Harbor creates nothing on a platform. Harbor then
// checks the key and the instance itself and keeps the key sealed; the app
// keeps nothing. Shapes from https://www.agent37.com/docs/agents-api/instances.

export const AGENT37_API = 'https://api.agent37.com';

export interface Agent37Instance {
  id: string;
  name: string | null;
  template: string;
  status: string;
  /** The Rowboat kind its template runs (`hermes`, `openclaw`), or undefined for one Rowboat does not drive. */
  kind?: string;
}

/** The kind an Agent37 system template runs (https://www.agent37.com/docs/agents-api/templates); a pinned `@tag` is the same template. */
export function kindOfTemplate(template: string): string | undefined {
  const name = template.split('@')[0];
  if (name === 'agent37-hermes' || name === 'agent37-hermes-small') return 'hermes';
  if (name === 'agent37-openclaw') return 'openclaw';
  return undefined;
}

/** The system template a new instance of a kind runs. */
const TEMPLATE_FOR: Record<string, string> = { hermes: 'agent37-hermes', openclaw: 'agent37-openclaw' };

type Fetch = typeof fetch;

async function call<T>(key: string, path: string, init: { method?: string; body?: unknown; timeoutMs?: number }, fetchImpl: Fetch, base: string): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${key}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  } catch (err) {
    throw new Error(`Agent37 could not be reached: ${(err as Error).message}`);
  }
  if (!res.ok) {
    let reason = `Agent37 answered ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } | string };
      reason = typeof body.error === 'string' ? body.error : body.error?.message ?? body.error?.code ?? reason;
    } catch {
      // keep the status
    }
    throw new Error(res.status === 401 ? `Agent37 did not accept this key: ${reason}` : reason);
  }
  return (await res.json()) as T;
}

const shape = (i: { id: string; name?: string | null; template?: string; status?: string }): Agent37Instance => {
  const template = i.template ?? '';
  const kind = kindOfTemplate(template);
  return { id: i.id, name: i.name ?? null, template, status: i.status ?? '', ...(kind ? { kind } : {}) };
};

/** The instances this key's workspace holds, newest first, minus failed ones. */
export async function listAgent37Instances(key: string, fetchImpl: Fetch = fetch, base = AGENT37_API): Promise<Agent37Instance[]> {
  const body = await call<{ data?: Array<{ id: string; name?: string | null; template?: string; status?: string }> }>(key, '/v1/instances', {}, fetchImpl, base);
  return (body.data ?? []).map(shape).filter((i) => !['failed', 'deleted', 'deleting'].includes(i.status));
}

/**
 * Create an instance running `kind`, with a monthly cap on its managed model
 * spend (Agent37's defaults to $0, which refuses every turn) and auto-sleep.
 * Agent37 answers once the computer is running, which can take minutes.
 */
export async function createAgent37Instance(
  key: string,
  input: { kind: string; name: string; monthlyBudgetUsd: number; autoSleep: boolean },
  fetchImpl: Fetch = fetch,
  base = AGENT37_API,
): Promise<Agent37Instance> {
  const template = TEMPLATE_FOR[input.kind];
  if (!template) throw new Error(`Agent37 has no instance for ${input.kind}`);
  const body = await call<{ id: string; name?: string | null; template?: string; status?: string }>(
    key,
    '/v1/instances',
    {
      method: 'POST',
      body: {
        template,
        name: input.name,
        budget: { monthly_cap_micros: Math.round(input.monthlyBudgetUsd * 1_000_000) },
        auto_sleep: input.autoSleep,
        metadata: { created_by: 'rowboat' },
      },
      timeoutMs: 10 * 60_000,
    },
    fetchImpl,
    base,
  );
  return shape({ template, ...body });
}
