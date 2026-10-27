// Maritime's API, for the app's Add flow (Harbor spec §8 Connectors, Maritime,
// 2026-10-26). A Maritime agent is one VM with a persistent volume, so adding
// one picks that agent with the person's key while they are adding it: setup
// is the app's, and Harbor creates nothing on a platform here. Harbor then
// checks the key and the agent itself and keeps the key sealed; the app keeps
// nothing. Shapes from https://api.maritime.sh/openapi.json (read 2026-10-24).

export const MARITIME_API = 'https://api.maritime.sh';

export interface MaritimeAgent {
  id: string;
  name: string;
  framework: string;
  templateId: string | null;
  status: string;
  /** The Rowboat kind the agent runs (`hermes`, `claude-code`, `codex`), or undefined when its record does not say (an agent made from an image). */
  kind?: string;
}

/** The kind a Maritime agent runs, from its record: by template, then by framework. */
export function kindOfMaritimeAgent(agent: { framework: string; templateId: string | null }): string | undefined {
  if (agent.templateId === 'claude_code') return 'claude-code';
  if (agent.templateId === 'codex') return 'codex';
  if (agent.templateId === 'hermes' || agent.framework === 'hermes') return 'hermes';
  return undefined;
}

type Fetch = typeof fetch;

/** The agents this key reaches, as Maritime lists them, minus ones being deleted. */
export async function listMaritimeAgents(key: string, fetchImpl: Fetch = fetch, base = MARITIME_API): Promise<MaritimeAgent[]> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/agents`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new Error(`Maritime could not be reached: ${(err as Error).message}`);
  }
  if (!res.ok) {
    let reason = `Maritime answered ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') reason = body.detail;
      else if (body.detail && typeof body.detail === 'object') reason = String((body.detail as { message?: string; code?: string }).message ?? (body.detail as { code?: string }).code ?? reason);
    } catch {
      // keep the status
    }
    throw new Error(res.status === 401 || res.status === 403 ? `Maritime did not accept this key: ${reason}` : reason);
  }
  const body = (await res.json()) as Array<{ id: string; name?: string; framework?: string; templateId?: string | null; status?: string }>;
  return (Array.isArray(body) ? body : [])
    .map((a) => {
      const agent = { id: a.id, name: a.name ?? '', framework: a.framework ?? '', templateId: typeof a.templateId === 'string' ? a.templateId : null, status: a.status ?? '' };
      const kind = kindOfMaritimeAgent(agent);
      return { ...agent, ...(kind ? { kind } : {}) };
    })
    .filter((a) => a.status !== 'deleting');
}
