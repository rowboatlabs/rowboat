import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProviderV4, LanguageModelV4Middleware } from '@ai-sdk/provider';
import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel } from 'ai';
import { getChatGPTAccessToken, getChatGPTStatus } from '../auth/chatgpt-auth.js';

// "ChatGPT subscription" model provider (flavor "codex"): runs model calls
// against the Codex backend that powers the Codex CLI, authorized by the
// "Sign in with ChatGPT" OAuth session (auth/chatgpt-auth.ts) instead of an
// API key. Like the "rowboat" gateway flavor, it has no models.json entry —
// resolveProviderConfig returns a bare { flavor: "codex" } and auth is
// injected per request here.
//
// The backend speaks ONLY the OpenAI Responses API, with quirks that every
// third-party client (Codex CLI itself, Zed, others) handles the same way —
// see codexFetch. Wire shape cross-checked against the open-source Codex CLI
// and known-working third-party integrations on 2026-07-17.

export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

// Cloudflare in front of chatgpt.com challenges requests whose `originator`
// isn't a known first-party Codex client, regardless of valid auth — so we
// identify as codex_cli_rs, the same approach other subscription clients
// ship.
const CODEX_ORIGINATOR = 'codex_cli_rs';

// The backend gates the model catalog by client_version — a version that
// predates a model family never sees it (e.g. 0.142.x gets no gpt-5.6-*).
// When the codex CLI is installed locally, mirror the version its own cache
// records so our catalog matches what `codex` shows in the terminal;
// otherwise fall back to a pinned recent release.
const CODEX_DEFAULT_CLIENT_VERSION = '0.144.5';
let clientVersionPromise: Promise<string> | null = null;
function codexClientVersion(): Promise<string> {
    clientVersionPromise ??= (async () => {
        try {
            const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
            const parsed = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as { client_version?: string };
            if (typeof parsed.client_version === 'string' && /^\d+\.\d+\.\d+$/.test(parsed.client_version)) {
                return parsed.client_version;
            }
        } catch { /* no local codex CLI install */ }
        return CODEX_DEFAULT_CLIENT_VERSION;
    })();
    return clientVersionPromise;
}

// Used when live discovery (listCodexModels) is unreachable. Discovery wins
// outright when it returns anything: the backend rejects retired slugs with
// HTTP 400, so appending stale hardcoded ids to a live list only creates
// broken picker rows.
const CODEX_FALLBACK_MODELS = [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
];

/**
 * Wire-level normalization for the Codex backend. Applied via fetch (not
 * providerOptions) so EVERY caller — chat turns, generateText one-shots,
 * generateObject classifiers, connection tests — gets a valid request
 * without knowing codex specifics:
 *
 *   - `store: false` is mandatory (the backend rejects store:true).
 *   - `stream: true` is mandatory (stream:false is rejected outright);
 *     non-streaming callers get their SSE aggregated back into a plain JSON
 *     response below.
 *   - `max_output_tokens` is rejected ("Unsupported parameter") — dropped.
 *   - `instructions` must be non-empty.
 *   - `include: ["reasoning.encrypted_content"]` keeps reasoning usable
 *     across tool-call steps despite store:false (the AI SDK relays the
 *     encrypted blobs back on subsequent requests).
 *   - a reasoning summary is requested by default so the UI has visible
 *     reasoning even when the user picked no explicit effort.
 */
export function normalizeRequestBody(raw: string): { body: string; forcedStream: boolean } {
    let parsed: Record<string, unknown>;
    try {
        const value: unknown = JSON.parse(raw);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return { body: raw, forcedStream: false };
        }
        parsed = value as Record<string, unknown>;
    } catch {
        return { body: raw, forcedStream: false };
    }

    parsed.store = false;
    delete parsed.max_output_tokens;
    if (typeof parsed.instructions !== 'string' || parsed.instructions.length === 0) {
        parsed.instructions = 'You are a helpful assistant.';
    }
    const include = new Set(Array.isArray(parsed.include) ? parsed.include as unknown[] : []);
    include.add('reasoning.encrypted_content');
    parsed.include = [...include];
    const reasoning = (parsed.reasoning !== null && typeof parsed.reasoning === 'object')
        ? parsed.reasoning as Record<string, unknown>
        : {};
    reasoning.summary ??= 'auto';
    parsed.reasoning = reasoning;

    let forcedStream = false;
    if (parsed.stream !== true) {
        parsed.stream = true;
        forcedStream = true;
    }
    return { body: JSON.stringify(parsed), forcedStream };
}

/**
 * Collapse a forced SSE stream back into the plain JSON response the
 * non-streaming caller expects: the terminal `response.completed` event
 * carries the full response object.
 */
export async function aggregateSseResponse(res: Response): Promise<Response> {
    const text = await res.text();
    let completed: unknown;
    let failure: string | undefined;
    for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let event: { type?: string; response?: unknown; message?: string };
        try {
            event = JSON.parse(payload) as typeof event;
        } catch {
            continue;
        }
        if (event.type === 'response.completed') {
            completed = event.response;
        } else if (event.type === 'response.failed') {
            const error = (event.response as { error?: { message?: string } } | undefined)?.error;
            failure = error?.message ?? 'Codex request failed';
        } else if (event.type === 'error') {
            failure = event.message ?? 'Codex request failed';
        }
    }
    const headers = new Headers(res.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    headers.delete('content-encoding');
    if (completed !== undefined) {
        return new Response(JSON.stringify(completed), { status: 200, headers });
    }
    return new Response(
        JSON.stringify({ error: { message: failure ?? 'Codex stream ended without a completed response' } }),
        { status: 502, headers },
    );
}

/**
 * Rewrite subscription-limit errors into something a user can act on. The
 * backend's 429 carries `plan_type` / `resets_at` (unix seconds) on the
 * error object; the raw message is unhelpful. Everything else passes
 * through untouched (body re-wrapped since reading consumed it).
 */
async function normalizeErrorResponse(res: Response): Promise<Response> {
    const raw = await res.text();
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    let body = raw;
    if (res.status === 429) {
        try {
            const parsed = JSON.parse(raw) as {
                error?: { message?: string; plan_type?: string; resets_at?: number };
            };
            if (parsed.error) {
                const plan = parsed.error.plan_type ? ` (${parsed.error.plan_type} plan)` : '';
                let when = '';
                if (typeof parsed.error.resets_at === 'number') {
                    const minutes = Math.max(1, Math.ceil((parsed.error.resets_at * 1000 - Date.now()) / 60_000));
                    when = minutes >= 120 ? ` Try again in ~${Math.round(minutes / 60)}h.` : ` Try again in ~${minutes} min.`;
                }
                parsed.error.message = `You have hit your ChatGPT subscription usage limit${plan}.${when}`;
                body = JSON.stringify(parsed);
            }
        } catch { /* keep the original body */ }
    }
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

// Auth + identity + Cloudflare headers on every request; body normalization
// on Responses calls. Throws ChatGPTAuthRequiredError when signed out —
// callers surface "Sign in with ChatGPT".
const codexFetch: typeof fetch = async (input, init) => {
    const token = await getChatGPTAccessToken();
    const { accountId } = await getChatGPTStatus();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (accountId) headers.set('chatgpt-account-id', accountId);
    headers.set('originator', CODEX_ORIGINATOR);
    headers.set('User-Agent', `${CODEX_ORIGINATOR}/${await codexClientVersion()} (Rowboat)`);

    let body = init?.body;
    let forcedStream = false;
    if (typeof body === 'string') {
        ({ body, forcedStream } = normalizeRequestBody(body));
    }

    const res = await fetch(input, { ...init, headers, ...(body === undefined ? {} : { body }) });
    if (!res.ok) return normalizeErrorResponse(res);
    if (forcedStream) return aggregateSseResponse(res);
    return res;
};

/**
 * The SDK must BELIEVE store is false — forcing it only on the wire is not
 * enough. When the SDK thinks store is on (its default), it echoes prior
 * assistant text/reasoning parts as `item_reference` entries, and the
 * stateless Codex backend 404s them ("Items are not persisted when `store`
 * is set to false"). With providerOptions.openai.store=false its message
 * converter emits full items instead — text with content, reasoning with
 * the round-tripped encrypted_content — so every request is
 * self-contained. Injected via middleware so no caller has to know.
 */
export const codexStoreMiddleware: LanguageModelV4Middleware = {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
            ...params.providerOptions,
            openai: {
                ...params.providerOptions?.openai,
                store: false,
            },
        },
    }),
};

/**
 * AI SDK provider for the codex flavor. `languageModel()` on the OpenAI
 * provider resolves to the Responses API model (the only API the Codex
 * backend speaks); auth is injected per request by codexFetch, so the
 * apiKey here is a placeholder that never reaches the wire.
 */
export function getCodexProvider(): ProviderV4 {
    const provider = createOpenAI({
        baseURL: CODEX_BASE_URL,
        apiKey: 'chatgpt-subscription',
        fetch: codexFetch,
    });
    return {
        ...provider,
        languageModel: (modelId: string) => wrapLanguageModel({
            model: provider.languageModel(modelId),
            middleware: codexStoreMiddleware,
        }),
    };
}

type ProviderSummary = {
    id: string;
    name: string;
    models: Array<{
        id: string;
        name?: string;
        reasoning?: boolean;
    }>;
};

/**
 * Models available to the signed-in ChatGPT subscription, shaped like
 * listGatewayModels for the models:list merge. Live discovery against the
 * backend's own catalog; the hardcoded fallback covers offline/errors.
 * Every codex model is a reasoning model, so the flag is set directly
 * (models.dev doesn't know this flavor).
 */
export async function listCodexModels(): Promise<{ providers: ProviderSummary[] }> {
    let discovered: Array<{ id: string; name?: string }> = [];
    try {
        const res = await codexFetch(`${CODEX_BASE_URL}/models?client_version=${await codexClientVersion()}`);
        if (res.ok) {
            const body = await res.json() as {
                models?: Array<{ slug?: string; display_name?: string; visibility?: string; priority?: number }>;
            };
            discovered = (body.models ?? [])
                // Utility models (e.g. codex-auto-review) carry visibility
                // "hide"; picker-visible ones carry "list".
                .filter((m): m is { slug: string; display_name?: string; priority?: number } =>
                    typeof m.slug === 'string' && m.slug.length > 0
                    && m.visibility !== 'hide' && m.visibility !== 'hidden')
                .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER))
                .map((m) => ({ id: m.slug, ...(m.display_name ? { name: m.display_name } : {}) }));
        }
    } catch (error) {
        console.warn('[Codex] Model discovery failed; using fallback list:', error instanceof Error ? error.message : error);
    }
    const models = (discovered.length > 0 ? discovered : CODEX_FALLBACK_MODELS.map((id) => ({ id })))
        .map((m) => ({ ...m, reasoning: true }));
    return {
        providers: [{
            id: 'codex',
            name: 'OpenAI Codex',
            models,
        }],
    };
}
