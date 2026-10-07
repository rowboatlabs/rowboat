// TypeSafe's System One API, whose model is Jev (https://docs.typesafe.ai/api),
// for the Jev connector (spec §8 Jev, 2026-10-07). One endpoint: POST
// /v1/systemone takes a `state` and a map of typed questions and returns one
// judgment per question, a probability rather than prose, so Jev decides and
// Harbor writes what is posted. Only the yes/no question type is used here.
// Reached through OpenRouter only (2026-10-07, Arjun's call in review), which
// serves the same API at its own base with its own model id, billed to
// Rowboat's OpenRouter account (TypeSafe's docs, "Configuring the base URL").
// The key is the deployment's own (HARBOR_JEV_OPENROUTER_KEY), never a person's.
// The desktop app has its own client for its composer features
// (apps/x/packages/core/src/typesafe); the two are separate on purpose.

export const OPENROUTER_API = 'https://openrouter.ai/api';
/** OpenRouter's id for the latest Jev: https://openrouter.ai/~typesafe/jev-latest */
const MODEL = '~typesafe/jev-latest';
const TIMEOUT_MS = 15_000;
// TypeSafe and OpenRouter ask for backoff on 429 and 529.
const RETRY_DELAYS_MS = [500, 1500];

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Yes/no: the answer is the probability of yes. */
export interface NoulQuestion {
  type: 'noul';
  instructions: Json;
  criteria?: { true?: Json; false?: Json };
}

export class TypeSafeError extends Error {
  /** HTTP status; 0 = no response (network, timeout). */
  constructor(readonly status: number, message: string) {
    super(message);
  }
  /** OpenRouter, TypeSafe or the network is having trouble: the message is tried again on the next sweep. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface JevApi {
  /** Every question sees the same state; the result maps each key to its probability of yes. */
  ask(state: Json, questions: Record<string, NoulQuestion>): Promise<Record<string, number>>;
}

export function jevApi(apiKey: string, base = OPENROUTER_API): JevApi {
  return {
    async ask(state, questions) {
      const body = JSON.stringify({ model: MODEL, state, questions });
      let last: TypeSafeError | undefined;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
        let res: Response;
        try {
          res = await fetch(`${base}/v1/systemone`, {
            method: 'POST',
            // OpenRouter's app attribution headers: requests show as Rowboat in its dashboard.
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://rowboatlabs.com', 'X-Title': 'Rowboat' },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (err) {
          throw new TypeSafeError(0, `OpenRouter could not be reached: ${(err as Error).message}`);
        }
        if (res.status === 429 || res.status === 529) {
          last = new TypeSafeError(res.status, `OpenRouter is busy (${res.status})`);
          continue;
        }
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 200).trim();
          throw new TypeSafeError(res.status, `OpenRouter refused the request (${res.status})${detail ? `: ${detail}` : ''}`);
        }
        const json = (await res.json()) as { answers?: Record<string, { type?: string; noul?: unknown }> };
        const answers: Record<string, number> = {};
        for (const [key, answer] of Object.entries(json.answers ?? {})) {
          if (answer?.type === 'noul' && typeof answer.noul === 'number') answers[key] = answer.noul;
        }
        return answers;
      }
      throw last ?? new TypeSafeError(0, 'OpenRouter request failed');
    },
  };
}
