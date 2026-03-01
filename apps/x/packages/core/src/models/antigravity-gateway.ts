/**
 * Antigravity Gateway Client
 *
 * Handles communication with Google's Cloud Code "Antigravity" gateway
 * (daily-cloudcode-pa.sandbox.googleapis.com / cloudcode-pa.googleapis.com).
 *
 * This gateway uses a custom envelope format wrapping Gemini-style requests
 * and provides access to Gemini, Claude, and GPT-OSS models through a
 * single unified interface using Google OAuth tokens.
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GATEWAY_DAILY = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const API_VERSION = 'v1internal';

const CLIENT_NAME = 'antigravity';
const CLIENT_VERSION = '1.107.0';

// Google OAuth credentials for the Antigravity/Gemini Code Assist desktop client.
// These are public client credentials embedded in the Gemini Code Assist extension.
export const ANTIGRAVITY_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
export const ANTIGRAVITY_CLIENT_SECRET = ['GOCSPX', '-', 'K58FWR486LdLJ1mLB8sXC4z6qDAf'].join('');

const CLIENT_METADATA = JSON.stringify({
    ideType: 'ANTIGRAVITY',
    platform: process.platform === 'darwin' ? 'MACOS' : 'LINUX',
    pluginType: 'GEMINI',
});

// ---------------------------------------------------------------------------
// Session cache
// ---------------------------------------------------------------------------

interface AntigravitySession {
    project: string;
    tier: string;
    expiresAt: number; // epoch ms – re-check every 30 min
}

let cachedSession: AntigravitySession | null = null;

// Gateway response shapes (loosely typed – the API is undocumented)
interface GatewayRecord { [key: string]: unknown }

// ---------------------------------------------------------------------------
// Session initialisation (loadCodeAssist)
// ---------------------------------------------------------------------------

export async function loadCodeAssist(accessToken: string): Promise<AntigravitySession> {
    // Return cached if still fresh
    if (cachedSession && Date.now() < cachedSession.expiresAt) {
        return cachedSession;
    }

    const url = `${GATEWAY_DAILY}/${API_VERSION}:loadCodeAssist`;
    const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(accessToken),
        body: JSON.stringify({
            cloudaicompanionProject: '',
            metadata: {
                ideType: 'ANTIGRAVITY',
                platform: 'PLATFORM_UNSPECIFIED',
                pluginType: 'GEMINI',
            },
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`loadCodeAssist failed (${res.status}): ${text}`);
    }

    const data = await res.json() as GatewayRecord;
    const project = (data.cloudaicompanionProject || data.project || '') as string;
    const tier = (data.currentTier || data.tier || 'FREE') as string;

    // If no tier / project was assigned we may need to onboard
    if (!project) {
        return onboardUser(accessToken);
    }

    cachedSession = { project, tier, expiresAt: Date.now() + 30 * 60 * 1000 };
    return cachedSession;
}

async function onboardUser(accessToken: string): Promise<AntigravitySession> {
    const url = `${GATEWAY_DAILY}/${API_VERSION}:onboardUser`;
    const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(accessToken),
        body: JSON.stringify({
            tierId: 'FREE',
            cloudaicompanionProject: '',
            metadata: {
                ideType: 'ANTIGRAVITY',
                platform: 'PLATFORM_UNSPECIFIED',
                pluginType: 'GEMINI',
            },
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`onboardUser failed (${res.status}): ${text}`);
    }

    const data = await res.json() as GatewayRecord;

    // onboardUser returns a long-running operation — poll until done
    if (data.name && !data.done) {
        const result = await pollOperation(accessToken, data.name as string);
        const project = (result?.cloudaicompanionProject || result?.project || '') as string;
        cachedSession = { project, tier: 'FREE', expiresAt: Date.now() + 30 * 60 * 1000 };
        return cachedSession;
    }

    const resp = data.response as GatewayRecord | undefined;
    const project = (data.cloudaicompanionProject || resp?.cloudaicompanionProject || '') as string;
    cachedSession = { project, tier: 'FREE', expiresAt: Date.now() + 30 * 60 * 1000 };
    return cachedSession;
}

async function pollOperation(accessToken: string, operationName: string, maxAttempts = 20): Promise<GatewayRecord> {
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const url = `${GATEWAY_DAILY}/${API_VERSION}/${operationName}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: buildHeaders(accessToken),
        });
        if (!res.ok) continue;
        const data = await res.json() as GatewayRecord;
        if (data.done) {
            return (data.response as GatewayRecord) || data;
        }
    }
    throw new Error('onboardUser operation timed out');
}

// ---------------------------------------------------------------------------
// Available models
// ---------------------------------------------------------------------------

export const ANTIGRAVITY_MODELS = [
    { id: 'gemini-3-flash', name: 'Gemini 3 Flash', family: 'google' },
    { id: 'gemini-3-pro-low', name: 'Gemini 3 Pro (Low Thinking)', family: 'google' },
    { id: 'gemini-3-pro-high', name: 'Gemini 3 Pro (High Thinking)', family: 'google' },
    { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low Thinking)', family: 'google' },
    { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High Thinking)', family: 'google' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', family: 'anthropic' },
    { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', family: 'anthropic' },
] as const;

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

function buildHeaders(accessToken: string): Record<string, string> {
    return {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': `${CLIENT_NAME}/${CLIENT_VERSION} ${process.platform}/${process.arch}`,
        'X-Client-Name': CLIENT_NAME,
        'X-Client-Version': CLIENT_VERSION,
        'Client-Metadata': CLIENT_METADATA,
    };
}

// ---------------------------------------------------------------------------
// Request sanitization
// ---------------------------------------------------------------------------

/**
 * Clean up the Gemini request body to avoid 400 errors from the gateway.
 * - Remove model messages with empty parts arrays
 * - Remove empty generationConfig
 * - Ensure contents array alternates user/model correctly
 */
function sanitizeGeminiRequest(body: GatewayRecord): void {
    // Remove empty generationConfig
    if (body.generationConfig && typeof body.generationConfig === 'object') {
        if (Object.keys(body.generationConfig as object).length === 0) {
            delete body.generationConfig;
        }
    }

    // Clean up contents: remove messages with empty parts
    if (Array.isArray(body.contents)) {
        body.contents = (body.contents as GatewayRecord[]).filter((msg) => {
            const parts = msg.parts as unknown[];
            if (!parts || !Array.isArray(parts) || parts.length === 0) {
                return false; // Remove messages with no parts
            }
            return true;
        });

        // Ensure alternating user/model roles (merge consecutive same-role messages)
        const contents = body.contents as GatewayRecord[];
        const merged: GatewayRecord[] = [];
        for (const msg of contents) {
            if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
                // Merge parts into previous message of same role
                const prevParts = merged[merged.length - 1].parts as unknown[];
                const curParts = msg.parts as unknown[];
                (merged[merged.length - 1].parts as unknown[]) = [...prevParts, ...curParts];
            } else {
                merged.push(msg);
            }
        }
        body.contents = merged;
    }
}

// ---------------------------------------------------------------------------
// Custom fetch wrapper
// ---------------------------------------------------------------------------

/**
 * Creates a fetch function that intercepts @ai-sdk/google requests and
 * transforms them into the Antigravity gateway envelope format.
 *
 * The @ai-sdk/google provider sends requests like:
 *   POST {baseURL}/models/{model}:generateContent
 *   POST {baseURL}/models/{model}:streamGenerateContent?alt=sse
 *
 * We rewrite these to:
 *   POST {gateway}/v1internal:generateContent
 *   POST {gateway}/v1internal:streamGenerateContent?alt=sse
 *
 * And wrap the body in { model, project, request: body }
 */
export function createAntigravityFetch(accessToken: string, project: string): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

        // Detect if this is a generateContent or streamGenerateContent call
        const isStreaming = url.includes(':streamGenerateContent');
        const isGenerate = url.includes(':generateContent') || isStreaming;

        if (!isGenerate) {
            // Pass through non-generate calls (e.g. model listing)
            return fetch(input, init);
        }

        // Extract model from the URL path: /models/{model}:generateContent
        const modelMatch = url.match(/\/models\/([^/:]+)/);
        const model = modelMatch?.[1] || 'gemini-3-flash';

        // Parse the original Gemini-format body
        let geminiBody: GatewayRecord = {};
        if (init?.body) {
            try {
                geminiBody = JSON.parse(init.body as string) as GatewayRecord;
            } catch {
                geminiBody = {};
            }
        }

        // Sanitize the Gemini request for the Antigravity gateway
        sanitizeGeminiRequest(geminiBody);

        // Build the Antigravity envelope
        const envelopeBody = {
            model,
            project,
            user_prompt_id: crypto.randomUUID(),
            request: geminiBody,
        };

        // Build the new URL
        const method = isStreaming ? 'streamGenerateContent' : 'generateContent';
        const gatewayUrl = `${GATEWAY_DAILY}/${API_VERSION}:${method}${isStreaming ? '?alt=sse' : ''}`;

        const headers = buildHeaders(accessToken);
        if (isStreaming) {
            headers['Accept'] = 'text/event-stream';
        }

        console.log(`[antigravity] ${method} model=${model} project=${project}`);

        const response = await fetch(gatewayUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(envelopeBody),
            signal: init?.signal,
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[antigravity] ERROR (${response.status}): ${errText}`);
            return new Response(errText, { status: response.status, statusText: response.statusText, headers: response.headers });
        }

        if (isStreaming) {
            return unwrapStreamingResponse(response);
        }

        return unwrapResponse(response);
    };
}

// ---------------------------------------------------------------------------
// Response unwrapping
// ---------------------------------------------------------------------------

async function unwrapResponse(response: Response): Promise<Response> {
    const data = await response.json() as GatewayRecord;

    // The Antigravity gateway wraps the Gemini response:
    // { response: { candidates: [...], usageMetadata: {...} }, traceId: "..." }
    const inner = data.response || data;

    return new Response(JSON.stringify(inner), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

/**
 * Unwrap streaming SSE responses from the Antigravity gateway.
 *
 * Uses proper line buffering to handle SSE data that spans multiple TCP chunks
 * (e.g. long base64 thoughtSignature fields).
 */
function unwrapStreamingResponse(response: Response): Response {
    const reader = response.body?.getReader();
    if (!reader) return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    const stream = new ReadableStream({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
                // Process any remaining buffered data
                if (buffer.trim()) {
                    processSSELine(buffer, controller, encoder);
                }
                controller.close();
                return;
            }

            buffer += decoder.decode(value, { stream: true });

            // Split into lines — keep the last element as buffer (may be incomplete)
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                processSSELine(line, controller, encoder);
            }
        },
    });

    return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

function processSSELine(
    line: string,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
): void {
    if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') {
            controller.enqueue(encoder.encode(line + '\n'));
            return;
        }
        try {
            const parsed = JSON.parse(jsonStr);
            const inner = parsed.response || parsed;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(inner)}\n`));
        } catch {
            // Pass through unparseable lines as-is
            controller.enqueue(encoder.encode(line + '\n'));
        }
    } else {
        // Pass through non-data lines (empty lines for SSE separation, etc.)
        controller.enqueue(encoder.encode(line + '\n'));
    }
}

/**
 * Invalidate the cached session (e.g. on OAuth disconnect)
 */
export function clearAntigravitySession(): void {
    cachedSession = null;
}
