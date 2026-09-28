import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { WorkDir } from '../config/config.js';

// TypeSafe's System One API, whose flagship model is Jev (2026-09-22). One
// endpoint: POST /v1/systemone takes a `state` plus a map of typed questions
// and returns one typed judgment per question, with probabilities instead of
// prose (https://docs.typesafe.ai/api). Bring-your-own-key like Composio: the
// key sits in ~/.rowboat/config/typesafe.json (or TYPESAFE_API_KEY) and is
// read here only. The renderer learns whether one is set, never the key.

const TYPESAFE_BASE_URL = 'https://api.typesafe.ai';
export const DEFAULT_MODEL = 'jev-latest';
const CONFIG_FILE = path.join(WorkDir, 'config', 'typesafe.json');
const DEFAULT_TIMEOUT_MS = 10_000;
// The API reference asks for backoff on 429/529. Two short retries keep a
// routing decision inside the composer's patience.
const RETRY_DELAYS_MS = [500, 1500];

const ZTypeSafeConfig = z.object({ apiKey: z.string().optional() });
type TypeSafeConfig = z.infer<typeof ZTypeSafeConfig>;

function loadConfig(): TypeSafeConfig {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return ZTypeSafeConfig.parse(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
        }
    } catch (error) {
        console.error('[TypeSafe] Failed to load config:', error);
    }
    return {};
}

function saveConfig(config: TypeSafeConfig): void {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getApiKey(): string | null {
    return loadConfig().apiKey || process.env.TYPESAFE_API_KEY || null;
}

export function setApiKey(apiKey: string): void {
    saveConfig({ ...loadConfig(), apiKey });
}

export function clearApiKey(): void {
    const config = loadConfig();
    delete config.apiKey;
    saveConfig(config);
}

export function isConfigured(): boolean {
    return !!getApiKey();
}

// --- the wire shapes ---------------------------------------------------------

/** State, instructions and criteria are JSON: a string, or structure when it clarifies. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Yes/no: the answer is the probability of yes. */
export interface NoulQuestion {
    type: 'noul';
    instructions: Json;
    criteria?: { true?: Json; false?: Json };
}

/** One option out of a defined set: the answer carries every option's probability. */
export interface ChoiceQuestion {
    type: 'choice';
    instructions: Json;
    /** Option name to its description; null when the name says it all. */
    criteria: Record<string, Json | null>;
}

/** A position on ordered levels: the answer is probability-weighted across them. */
export interface ScoreQuestion {
    type: 'score';
    instructions: Json;
    criteria: Json[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export const ZNoulAnswer = z.object({ type: z.literal('noul'), noul: z.number() });
export const ZChoiceAnswer = z.object({
    type: z.literal('choice'),
    choice: z.string(),
    probabilities: z.record(z.string(), z.number()),
    confidence: z.number(),
});
export const ZScoreAnswer = z.object({
    type: z.literal('score'),
    score: z.number(),
    legend: z.record(z.string(), z.string()),
    probabilities: z.record(z.string(), z.number()),
    confidence: z.number(),
});
export const ZAnswer = z.discriminatedUnion('type', [ZNoulAnswer, ZChoiceAnswer, ZScoreAnswer]);
export const ZSystemOneResponse = z.object({
    model: z.string(),
    answers: z.record(z.string(), ZAnswer),
    usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});
export type NoulAnswer = z.infer<typeof ZNoulAnswer>;
export type ChoiceAnswer = z.infer<typeof ZChoiceAnswer>;
export type ScoreAnswer = z.infer<typeof ZScoreAnswer>;
export type Answer = z.infer<typeof ZAnswer>;
export type SystemOneResponse = z.infer<typeof ZSystemOneResponse>;

export interface SystemOneRequest {
    state: Json;
    questions: Record<string, Question>;
    /** Defaults to jev-latest. */
    model?: string;
}

export class TypeSafeError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = 'TypeSafeError';
    }
}

async function describeFailure(res: Response): Promise<string> {
    if (res.status === 401) return 'Invalid TypeSafe API key';
    const text = await res.text().catch(() => '');
    const detail = text.slice(0, 200).trim();
    return `TypeSafe request failed (${res.status})${detail ? `: ${detail}` : ''}`;
}

/**
 * Evaluate one state against a map of typed questions. Every question sees the
 * same state and is answered independently, so callers ask everything they
 * might need in one request. 429/529 retry with backoff; anything else throws.
 */
export async function systemOne(
    request: SystemOneRequest,
    opts: { apiKey?: string; timeoutMs?: number } = {},
): Promise<SystemOneResponse> {
    const apiKey = opts.apiKey ?? getApiKey();
    if (!apiKey) throw new TypeSafeError('TypeSafe API key not configured', 401);
    const body = JSON.stringify({
        state: request.state,
        model: request.model ?? DEFAULT_MODEL,
        questions: request.questions,
    });
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let retryable: TypeSafeError | null = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1] ?? 0));
        }
        const res = await fetch(`${TYPESAFE_BASE_URL}/v1/systemone`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 429 || res.status === 529) {
            retryable = new TypeSafeError(
                res.status === 429 ? 'TypeSafe rate limit reached' : 'TypeSafe is overloaded',
                res.status,
            );
            continue;
        }
        if (!res.ok) throw new TypeSafeError(await describeFailure(res), res.status);
        return ZSystemOneResponse.parse(await res.json());
    }
    throw retryable ?? new TypeSafeError('TypeSafe request failed');
}

/**
 * One tiny request with the candidate key. A 401/403 means the key is wrong;
 * any other failure is the network's word, not the key's.
 */
export async function verifyApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; rejected: boolean; error: string }> {
    try {
        await systemOne(
            { state: 'ping', questions: { ping: { type: 'noul', instructions: 'Is the text exactly the word "ping"?' } } },
            { apiKey, timeoutMs: 15_000 },
        );
        return { ok: true };
    } catch (err) {
        const rejected = err instanceof TypeSafeError && (err.status === 401 || err.status === 403);
        return { ok: false, rejected, error: err instanceof Error ? err.message : 'Could not reach TypeSafe' };
    }
}

/** The settings save: a rejected key is refused; an unreachable API saves the key and says so. */
export async function saveApiKey(apiKey: string): Promise<{ success: boolean; error?: string; warning?: string }> {
    const trimmed = apiKey.trim();
    if (!trimmed) return { success: false, error: 'Paste an API key first' };
    const check = await verifyApiKey(trimmed);
    if (!check.ok && check.rejected) return { success: false, error: check.error };
    setApiKey(trimmed);
    return check.ok ? { success: true } : { success: true, warning: `Saved, but it could not be verified: ${check.error}` };
}
