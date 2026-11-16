import type { PlatformInstance } from '@rowboat/spaces-protocol';
import { MARITIME_API } from './api.js';
import { kindOfAgent } from './runtimes.js';

// Maritime's API, for the Add flow (spec §8 Connectors, Maritime,
// 2026-10-26). A Maritime agent is one VM with a persistent volume, so adding
// one picks that agent with the person's key while they are adding it. Moved
// here from the desktop app on 2026-11-02, so the web app and a super agent's
// setup card can do it too: Harbor uses the key for the call and keeps
// nothing; adding the agent then checks the key and the agent again and seals
// the key. Shapes from https://api.maritime.sh/openapi.json (read 2026-10-24).

type Fetch = typeof fetch;

/** The agents this key reaches, as Maritime lists them, minus ones being deleted. */
export async function listMaritimeAgents(key: string, fetchImpl: Fetch = fetch, base = MARITIME_API): Promise<PlatformInstance[]> {
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
  const body = (await res.json()) as Array<{ id: string; name?: string; framework?: string; templateId?: string | null; imageName?: string | null; status?: string }>;
  return (Array.isArray(body) ? body : [])
    .filter((a) => a.status !== 'deleting')
    .map((a) => {
      const record = { framework: a.framework ?? '', templateId: typeof a.templateId === 'string' ? a.templateId : null, imageName: typeof a.imageName === 'string' ? a.imageName : null };
      const kind = kindOfAgent(record);
      return { id: a.id, name: a.name ?? null, status: a.status ?? '', template: record.templateId ?? record.framework, ...(kind ? { kind } : {}) };
    });
}
