// TypeSafe's System One API, whose model is Jev (https://docs.typesafe.ai/api),
// for the space graph (spec §8 Space graph, 2026-11-12). One endpoint: POST
// /v1/systemone takes a `state` and a map of typed questions and returns one
// judgment per question, a probability rather than prose. Jev decides; code
// builds the candidates and applies the thresholds, and nothing Jev returns
// is text. Reached the way Ro reached it (2026-10-07, Arjun's call; restored
// 2026-11-12): through OpenRouter only, which serves the same API at its own
// base with its own model id, on the deployment's key
// (HARBOR_JEV_OPENROUTER_KEY), never a person's. Ro itself, the agent that
// tagged people, stays retired (spec §8 Jev); only its client is back. The
// desktop app has its own client for its composer features
// (apps/x/packages/core/src/typesafe); the two are separate on purpose.

import { wellFormed } from './graph/text.js';

export const OPENROUTER_API = 'https://openrouter.ai/api';
/** OpenRouter's id for the latest Jev: https://openrouter.ai/~typesafe/jev-latest */
export const OPENROUTER_JEV_MODEL = '~typesafe/jev-latest';
// A thread's state can run to tens of thousands of tokens, so this is longer than Ro's 15s.
const TIMEOUT_MS = 60_000;
// TypeSafe and OpenRouter ask for backoff on 429 and 529.
const RETRY_DELAYS_MS = [500, 1500, 4000];

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Yes/no: the answer is the probability of yes. */
export interface NoulQuestion {
  type: 'noul';
  instructions: Json;
}
/** One option of a closed set: the answer carries every option's probability. */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: Json;
  /** Option name to its description. */
  criteria: Record<string, string>;
}
/** A position on ordered levels, 0 to levels - 1, possibly between two. */
export interface ScoreQuestion {
  type: 'score';
  instructions: Json;
  criteria: string[];
}
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number> }
  | { type: 'score'; score: number };

export class JevError extends Error {
  /** HTTP status; 0 = no response (network, timeout) or an answer that does not fit its question. */
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface JevApi {
  /** Every question sees the same state and is answered on its own. An answer missing or of the wrong type throws: the caller retries the whole request later. */
  ask(state: Json, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer>>;
}

function readAnswer(question: JevQuestion, raw: unknown): JevAnswer | undefined {
  const a = raw as { type?: string; noul?: unknown; choice?: unknown; probabilities?: unknown; score?: unknown } | undefined;
  if (!a || a.type !== question.type) return undefined;
  if (question.type === 'noul') return typeof a.noul === 'number' ? { type: 'noul', noul: Math.min(1, Math.max(0, a.noul)) } : undefined;
  if (question.type === 'score') return typeof a.score === 'number' ? { type: 'score', score: a.score } : undefined;
  if (typeof a.choice !== 'string' || !(a.choice in question.criteria)) return undefined;
  const probabilities: Record<string, number> = {};
  for (const [key, value] of Object.entries((a.probabilities ?? {}) as Record<string, unknown>)) if (typeof value === 'number') probabilities[key] = value;
  return { type: 'choice', choice: a.choice, probabilities };
}

export function jevApi(apiKey: string, base = OPENROUTER_API, model = OPENROUTER_JEV_MODEL): JevApi {
  return {
    async ask(state, questions) {
      const body = JSON.stringify({ model, state, questions }, (_key, value: unknown) => (typeof value === 'string' ? wellFormed(value) : value));
      let last: JevError | undefined;
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
          throw new JevError(0, `Jev could not be reached: ${(err as Error).message}`);
        }
        if (res.status === 429 || res.status === 529) {
          last = new JevError(res.status, `Jev is busy (${res.status})`);
          continue;
        }
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 200).trim();
          throw new JevError(res.status, `Jev refused the request (${res.status})${detail ? `: ${detail}` : ''}`);
        }
        const json = (await res.json()) as { answers?: Record<string, unknown> };
        const answers: Record<string, JevAnswer> = {};
        for (const [key, question] of Object.entries(questions)) {
          const answer = readAnswer(question, json.answers?.[key]);
          if (!answer) throw new JevError(0, `Jev left "${key}" unanswered`);
          answers[key] = answer;
        }
        return answers;
      }
      throw last ?? new JevError(0, 'Jev request failed');
    },
  };
}

/** The deployment's Jev, when it has the key; without it the space graph is unavailable and nothing is sent anywhere. */
export function jevFromEnv(): JevApi | undefined {
  const key = process.env.HARBOR_JEV_OPENROUTER_KEY?.trim();
  return key ? jevApi(key) : undefined;
}
