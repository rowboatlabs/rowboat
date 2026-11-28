// The model that words a connection's post (spec §8 Space connections,
// 2026-11-28): Rowboat's LLM gateway, OpenAI-format, on a gateway key minted
// for the connection, so each call settles to whoever connected the app, like
// a managed Hermes's (billing.ts). What it is asked is write.ts.

export interface UpdateWriter {
  /** The model's answer; throws when the gateway refuses (no credits, a revoked key) or cannot be reached. */
  write(key: string, prompt: { system: string; user: string }): Promise<string>;
}

/** The gateway's cheap alias for work nobody waits on; which model serves it is the control plane's choice. */
export const WRITER_MODEL = 'Auto-background';
const TIMEOUT_MS = 30_000;

export function gatewayWriter(gatewayUrl: string, doFetch: typeof fetch = fetch): UpdateWriter {
  return {
    async write(key, prompt) {
      const res = await doFetch(`${gatewayUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: WRITER_MODEL,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          max_tokens: 400,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`the gateway answered ${res.status}`);
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('the gateway answered nothing');
      return content;
    },
  };
}
