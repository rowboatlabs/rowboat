import { ProviderV4 } from '@ai-sdk/provider';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAntigravityFetch } from './antigravity-gateway.js';

// "Antigravity" model provider (flavor "antigravity"): runs model calls
// against Google's Cloud Code gateway, authorized by the "Sign in with Google"
// OAuth session (auth/antigravity-auth.ts) instead of an API key. Like the
// "rowboat" and "codex" gateway flavors it has no models.json entry —
// resolveProviderConfig returns a bare { flavor: "antigravity" } and auth is
// injected per request by createAntigravityFetch.
//
// The gateway speaks the Gemini generateContent API wrapped in a custom
// envelope; the @ai-sdk/google provider produces the inner Gemini requests and
// createAntigravityFetch rewrites them onto the gateway (see antigravity-gateway.ts).

// Any base URL whose path ends /v1beta works — the Google provider only uses
// it to build `/models/{model}:generateContent`, which the fetch rewrites.
const ANTIGRAVITY_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * AI SDK provider for the antigravity flavor. Auth is injected per request by
 * createAntigravityFetch, so the apiKey here is a placeholder that never
 * reaches the wire.
 */
export function getAntigravityProvider(): ProviderV4 {
    return createGoogleGenerativeAI({
        baseURL: ANTIGRAVITY_BASE_URL,
        apiKey: 'antigravity-oauth',
        fetch: createAntigravityFetch(),
    }) as unknown as ProviderV4;
}

type ProviderSummary = {
    id: string;
    name: string;
    models: Array<{ id: string; name?: string; reasoning?: boolean }>;
};

// The gateway's model catalog is not discoverable via a stable endpoint, so
// it is pinned here (mirrors the codex fallback list). `reasoning: true` marks
// the thinking-capable models so the picker surfaces effort controls.
const ANTIGRAVITY_MODELS: Array<{ id: string; name: string; reasoning?: boolean }> = [
    { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
    { id: 'gemini-3-pro-low', name: 'Gemini 3 Pro (Low Thinking)', reasoning: true },
    { id: 'gemini-3-pro-high', name: 'Gemini 3 Pro (High Thinking)', reasoning: true },
    { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low Thinking)', reasoning: true },
    { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High Thinking)', reasoning: true },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', reasoning: true },
];

/**
 * Models available through the signed-in Antigravity session, shaped like
 * listCodexModels/listGatewayModels for the models:list merge in catalog.ts.
 */
export async function listAntigravityModels(): Promise<{ providers: ProviderSummary[] }> {
    return {
        providers: [{
            id: 'antigravity',
            name: 'Antigravity',
            models: ANTIGRAVITY_MODELS.map((m) => ({
                id: m.id,
                name: m.name,
                ...(m.reasoning ? { reasoning: true } : {}),
            })),
        }],
    };
}
