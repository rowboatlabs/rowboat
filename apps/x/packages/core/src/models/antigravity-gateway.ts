/**
 * Antigravity gateway client.
 *
 * Talks to Google's Cloud Code "Antigravity" gateway
 * (daily-cloudcode-pa.sandbox.googleapis.com), which wraps Gemini-style
 * requests in a custom envelope and serves them to a signed-in Google account
 * without a per-request API key. Auth is the "Sign in with Google" session
 * owned by auth/antigravity-auth.ts.
 *
 * Salvaged and adapted from the original native-OAuth PR: the envelope
 * rewrite, buffered SSE unwrap, and request sanitization are unchanged in
 * spirit; token/session handling now goes through the same seams as the codex
 * flavor (getAntigravityAccessToken + a cached session), so callers never pass
 * credentials in.
 *
 * This is an undocumented, reverse-engineered API — see antigravity-constants.ts.
 */

import { randomUUID } from 'node:crypto';
import {
    ANTIGRAVITY_API_VERSION,
    ANTIGRAVITY_CLIENT_NAME,
    ANTIGRAVITY_CLIENT_VERSION,
    ANTIGRAVITY_GATEWAY_URL,
} from '../auth/antigravity-constants.js';
import { getAntigravityAccessToken } from '../auth/antigravity-auth.js';

const CLIENT_METADATA = JSON.stringify({
    ideType: 'ANTIGRAVITY',
    platform: process.platform === 'darwin' ? 'MACOS' : process.platform === 'win32' ? 'WINDOWS' : 'LINUX',
    pluginType: 'GEMINI',
});

// Loosely typed — the gateway is undocumented.
interface GatewayRecord { [key: string]: unknown }

interface AntigravitySession {
    project: string;
    tier: string;
    expiresAt: number; // epoch ms — re-check every 30 min
}

let cachedSession: AntigravitySession | null = null;
// Single-flight session init: concurrent first requests share one loadCodeAssist.
let sessionInFlight: Promise<AntigravitySession> | null = null;

function buildHeaders(accessToken: string): Record<string, string> {
    return {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': `${ANTIGRAVITY_CLIENT_NAME}/${ANTIGRAVITY_CLIENT_VERSION} ${process.platform}/${process.arch}`,
        'X-Client-Name': ANTIGRAVITY_CLIENT_NAME,
        'X-Client-Version': ANTIGRAVITY_CLIENT_VERSION,
        'Client-Metadata': CLIENT_METADATA,
    };
}

/**
 * Ensure a gateway session (project id + tier) for the current account,
 * caching it for 30 minutes. New accounts are onboarded via onboardUser,
 * which may return a long-running operation to poll.
 */
async function ensureSession(accessToken: string): Promise<AntigravitySession> {
    if (cachedSession && Date.now() < cachedSession.expiresAt) return cachedSession;
    if (sessionInFlight) return sessionInFlight;
    sessionInFlight = loadCodeAssist(accessToken).finally(() => {
        sessionInFlight = null;
    });
    return sessionInFlight;
}

async function loadCodeAssist(accessToken: string): Promise<AntigravitySession> {
    const res = await fetch(`${ANTIGRAVITY_GATEWAY_URL}/${ANTIGRAVITY_API_VERSION}:loadCodeAssist`, {
        method: 'POST',
        headers: buildHeaders(accessToken),
        body: JSON.stringify({
            cloudaicompanionProject: '',
            metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
        }),
    });
    if (!res.ok) {
        throw new Error(`loadCodeAssist failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json() as GatewayRecord;
    const project = (data.cloudaicompanionProject || data.project || '') as string;
    const tier = (data.currentTier || data.tier || 'FREE') as string;
    if (!project) return onboardUser(accessToken);

    cachedSession = { project, tier, expiresAt: Date.now() + 30 * 60 * 1000 };
    return cachedSession;
}

async function onboardUser(accessToken: string): Promise<AntigravitySession> {
    const res = await fetch(`${ANTIGRAVITY_GATEWAY_URL}/${ANTIGRAVITY_API_VERSION}:onboardUser`, {
        method: 'POST',
        headers: buildHeaders(accessToken),
        body: JSON.stringify({
            tierId: 'FREE',
            cloudaicompanionProject: '',
            metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
        }),
    });
    if (!res.ok) {
        throw new Error(`onboardUser failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json() as GatewayRecord;

    // onboardUser may return a long-running operation — poll until done.
    let resp: GatewayRecord | undefined;
    if (data.name && !data.done) {
        resp = await pollOperation(accessToken, data.name as string);
    } else {
        resp = data.response as GatewayRecord | undefined;
    }
    const project = (data.cloudaicompanionProject
        || resp?.cloudaicompanionProject
        || resp?.project
        || '') as string;
    cachedSession = { project, tier: 'FREE', expiresAt: Date.now() + 30 * 60 * 1000 };
    return cachedSession;
}

async function pollOperation(accessToken: string, operationName: string, maxAttempts = 20): Promise<GatewayRecord> {
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`${ANTIGRAVITY_GATEWAY_URL}/${ANTIGRAVITY_API_VERSION}/${operationName}`, {
            method: 'GET',
            headers: buildHeaders(accessToken),
        });
        if (!res.ok) continue;
        const data = await res.json() as GatewayRecord;
        if (data.done) return (data.response as GatewayRecord) || data;
    }
    throw new Error('onboardUser operation timed out');
}

/**
 * Clean up the Gemini request body to avoid 400s from the gateway: drop empty
 * generationConfig, drop empty-parts messages, and merge consecutive same-role
 * messages so contents alternate.
 */
export function sanitizeGeminiRequest(body: GatewayRecord): void {
    if (body.generationConfig && typeof body.generationConfig === 'object'
        && Object.keys(body.generationConfig as object).length === 0) {
        delete body.generationConfig;
    }
    if (!Array.isArray(body.contents)) return;

    const nonEmpty = (body.contents as GatewayRecord[]).filter((msg) => {
        const parts = msg.parts as unknown[];
        return Array.isArray(parts) && parts.length > 0;
    });
    const merged: GatewayRecord[] = [];
    for (const msg of nonEmpty) {
        const prev = merged[merged.length - 1];
        if (prev && prev.role === msg.role) {
            prev.parts = [...(prev.parts as unknown[]), ...(msg.parts as unknown[])];
        } else {
            merged.push(msg);
        }
    }
    body.contents = merged;
}

/**
 * A fetch that intercepts @ai-sdk/google requests and rewrites them into the
 * Antigravity gateway envelope. The Google provider issues:
 *   POST {baseURL}/models/{model}:generateContent
 *   POST {baseURL}/models/{model}:streamGenerateContent?alt=sse
 * which we rewrite to:
 *   POST {gateway}/v1internal:generateContent
 *   POST {gateway}/v1internal:streamGenerateContent?alt=sse
 * wrapping the body as { model, project, user_prompt_id, request: <gemini body> }
 * and unwrapping the gateway's { response: … } envelope on the way back.
 *
 * Token + session are resolved per request (transparent refresh), so callers
 * — chat turns, one-shots, classifiers, connection tests — need nothing.
 */
export function createAntigravityFetch(): typeof fetch {
    return async (input, init) => {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL ? input.toString() : (input as Request).url;

        const isStreaming = url.includes(':streamGenerateContent');
        const isGenerate = url.includes(':generateContent') || isStreaming;

        const accessToken = await getAntigravityAccessToken();
        if (!isGenerate) {
            // Non-generate calls (e.g. model listing) still need auth headers.
            const headers = new Headers(init?.headers);
            headers.set('Authorization', `Bearer ${accessToken}`);
            return fetch(input, { ...init, headers });
        }

        const { project } = await ensureSession(accessToken);

        const modelMatch = url.match(/\/models\/([^/:]+)/);
        const model = modelMatch?.[1] || 'gemini-3-flash';

        let geminiBody: GatewayRecord = {};
        if (typeof init?.body === 'string') {
            try {
                geminiBody = JSON.parse(init.body) as GatewayRecord;
            } catch {
                geminiBody = {};
            }
        }
        sanitizeGeminiRequest(geminiBody);

        const method = isStreaming ? 'streamGenerateContent' : 'generateContent';
        const gatewayUrl = `${ANTIGRAVITY_GATEWAY_URL}/${ANTIGRAVITY_API_VERSION}:${method}${isStreaming ? '?alt=sse' : ''}`;
        const headers = buildHeaders(accessToken);
        if (isStreaming) headers.Accept = 'text/event-stream';

        const response = await fetch(gatewayUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model, project, user_prompt_id: randomUUID(), request: geminiBody }),
            ...(init?.signal ? { signal: init.signal } : {}),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[antigravity] ${method} model=${model} failed (${response.status})`);
            const headersOut = new Headers(response.headers);
            headersOut.delete('content-length');
            headersOut.delete('content-encoding');
            return new Response(errText, { status: response.status, statusText: response.statusText, headers: headersOut });
        }

        return isStreaming ? unwrapStreamingResponse(response) : unwrapResponse(response);
    };
}

export async function unwrapResponse(response: Response): Promise<Response> {
    const data = await response.json() as GatewayRecord;
    const inner = data.response || data;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(inner), { status: response.status, statusText: response.statusText, headers });
}

/**
 * Unwrap streaming SSE from the gateway. Line-buffers across reads so SSE
 * `data:` lines split over TCP chunks (long base64 thoughtSignature fields)
 * are reassembled before JSON parsing.
 */
export function unwrapStreamingResponse(response: Response): Response {
    const reader = response.body?.getReader();
    if (!reader) return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    const stream = new ReadableStream({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
                if (buffer.trim()) processSSELine(buffer, controller, encoder);
                controller.close();
                return;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) processSSELine(line, controller, encoder);
        },
    });

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}

function processSSELine(
    line: string,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
): void {
    if (!line.startsWith('data: ')) {
        controller.enqueue(encoder.encode(line + '\n'));
        return;
    }
    const jsonStr = line.slice(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') {
        controller.enqueue(encoder.encode(line + '\n'));
        return;
    }
    try {
        const parsed = JSON.parse(jsonStr) as GatewayRecord;
        const inner = parsed.response || parsed;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(inner)}\n`));
    } catch {
        controller.enqueue(encoder.encode(line + '\n'));
    }
}

/** Invalidate the cached session (e.g. on OAuth disconnect). */
export function clearAntigravitySession(): void {
    cachedSession = null;
    sessionInFlight = null;
}
