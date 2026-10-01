import { describe, it, expect } from 'vitest';
import {
    sanitizeGeminiRequest,
    unwrapResponse,
    unwrapStreamingResponse,
} from './antigravity-gateway.js';
import { listAntigravityModels } from './antigravity.js';

describe('sanitizeGeminiRequest', () => {
    it('drops an empty generationConfig', () => {
        const body: Record<string, unknown> = { contents: [], generationConfig: {} };
        sanitizeGeminiRequest(body);
        expect(body).not.toHaveProperty('generationConfig');
    });

    it('keeps a non-empty generationConfig', () => {
        const body: Record<string, unknown> = { contents: [], generationConfig: { temperature: 0.5 } };
        sanitizeGeminiRequest(body);
        expect(body.generationConfig).toEqual({ temperature: 0.5 });
    });

    it('removes messages with empty parts', () => {
        const body: Record<string, unknown> = {
            contents: [
                { role: 'user', parts: [{ text: 'hi' }] },
                { role: 'model', parts: [] },
            ],
        };
        sanitizeGeminiRequest(body);
        expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    });

    it('merges consecutive same-role messages so roles alternate', () => {
        const body: Record<string, unknown> = {
            contents: [
                { role: 'user', parts: [{ text: 'a' }] },
                { role: 'user', parts: [{ text: 'b' }] },
                { role: 'model', parts: [{ text: 'c' }] },
            ],
        };
        sanitizeGeminiRequest(body);
        expect(body.contents).toEqual([
            { role: 'user', parts: [{ text: 'a' }, { text: 'b' }] },
            { role: 'model', parts: [{ text: 'c' }] },
        ]);
    });
});

describe('unwrapResponse', () => {
    it('unwraps the gateway { response: … } envelope to plain Gemini JSON', async () => {
        const inner = { candidates: [{ content: { parts: [{ text: 'hello' }] } }] };
        const gateway = new Response(JSON.stringify({ response: inner, traceId: 'x' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
        const out = await unwrapResponse(gateway);
        expect(await out.json()).toEqual(inner);
    });

    it('passes through a response with no envelope wrapper', async () => {
        const plain = { candidates: [] };
        const gateway = new Response(JSON.stringify(plain), { status: 200 });
        const out = await unwrapResponse(gateway);
        expect(await out.json()).toEqual(plain);
    });
});

describe('unwrapStreamingResponse', () => {
    // Build an SSE Response whose body is delivered as the given pre-split
    // chunks — splitting a `data:` line across two chunks exercises the line
    // buffering the base64 thoughtSignature case depends on.
    function chunkedSse(chunks: string[]): Response {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
                controller.close();
            },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }

    async function readAll(res: Response): Promise<string> {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let out = '';
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            out += decoder.decode(value, { stream: true });
        }
        return out + decoder.decode();
    }

    it('strips the gateway envelope from an SSE data line', async () => {
        const inner = { candidates: [{ content: { parts: [{ text: 'streamed' }] } }] };
        const line = `data: ${JSON.stringify({ response: inner })}\n\n`;
        const out = await readAll(unwrapStreamingResponse(chunkedSse([line])));
        expect(out).toContain(`data: ${JSON.stringify(inner)}`);
        expect(out).not.toContain('"response"');
    });

    it('passes [DONE] and blank separator lines through untouched', async () => {
        const out = await readAll(unwrapStreamingResponse(chunkedSse(['data: [DONE]\n\n'])));
        expect(out).toContain('data: [DONE]');
    });
});

describe('listAntigravityModels', () => {
    it('returns the pinned catalog under a single antigravity provider', async () => {
        const { providers } = await listAntigravityModels();
        expect(providers).toHaveLength(1);
        expect(providers[0]?.id).toBe('antigravity');
        const ids = providers[0]?.models.map((m) => m.id) ?? [];
        expect(ids).toContain('gemini-3-flash');
        expect(ids).toContain('claude-opus-4-6-thinking');
    });

    it('marks thinking models as reasoning and non-thinking models without the flag', async () => {
        const { providers } = await listAntigravityModels();
        const byId = new Map(providers[0]?.models.map((m) => [m.id, m]));
        expect(byId.get('gemini-3-pro-high')?.reasoning).toBe(true);
        expect(byId.get('gemini-3-flash')?.reasoning).toBeUndefined();
    });
});
