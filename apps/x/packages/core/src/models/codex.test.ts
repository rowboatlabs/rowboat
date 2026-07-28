import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    normalizeRequestBody,
    aggregateSseResponse,
    listCodexModels,
    codexStoreMiddleware,
    CODEX_BASE_URL,
} from './codex.js';
import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider';

vi.mock('../auth/chatgpt-auth.js', () => ({
    getChatGPTAccessToken: vi.fn(async () => 'test-access-token'),
    getChatGPTStatus: vi.fn(async () => ({ signedIn: true, accountId: 'acct-123' })),
}));

describe('normalizeRequestBody', () => {
    it('enforces the Codex wire contract on a bare request', () => {
        const { body, forcedStream } = normalizeRequestBody(JSON.stringify({
            model: 'gpt-5.5',
            input: [],
            store: true,
            max_output_tokens: 4096,
        }));
        const parsed = JSON.parse(body);
        expect(parsed.store).toBe(false);
        expect(parsed).not.toHaveProperty('max_output_tokens');
        expect(parsed.instructions).toBe('You are a helpful assistant.');
        expect(parsed.include).toContain('reasoning.encrypted_content');
        expect(parsed.reasoning).toEqual({ summary: 'auto' });
        expect(parsed.stream).toBe(true);
        expect(forcedStream).toBe(true);
    });

    it('preserves caller instructions, reasoning fields, and existing includes', () => {
        const { body, forcedStream } = normalizeRequestBody(JSON.stringify({
            instructions: 'Be terse.',
            include: ['message.output_text.logprobs'],
            reasoning: { effort: 'high', summary: 'detailed' },
            stream: true,
        }));
        const parsed = JSON.parse(body);
        expect(parsed.instructions).toBe('Be terse.');
        expect(parsed.include).toEqual(
            expect.arrayContaining(['message.output_text.logprobs', 'reasoning.encrypted_content']),
        );
        expect(parsed.reasoning).toEqual({ effort: 'high', summary: 'detailed' });
        expect(forcedStream).toBe(false);
    });

    it('passes non-JSON bodies through untouched', () => {
        expect(normalizeRequestBody('not json')).toEqual({ body: 'not json', forcedStream: false });
    });
});

function sseResponse(events: string[]): Response {
    const body = events.map((e) => `data: ${e}`).join('\n\n') + '\n\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('aggregateSseResponse', () => {
    it('returns the response.completed payload as plain JSON', async () => {
        const res = await aggregateSseResponse(sseResponse([
            JSON.stringify({ type: 'response.created' }),
            JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', output: [] } }),
        ]));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/json');
        expect(await res.json()).toEqual({ id: 'resp_1', output: [] });
    });

    it('surfaces response.failed as an error response', async () => {
        const res = await aggregateSseResponse(sseResponse([
            JSON.stringify({ type: 'response.failed', response: { error: { message: 'quota exceeded' } } }),
        ]));
        expect(res.status).toBe(502);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toBe('quota exceeded');
    });

    it('errors when the stream ends without a terminal event', async () => {
        const res = await aggregateSseResponse(sseResponse([
            JSON.stringify({ type: 'response.created' }),
        ]));
        expect(res.status).toBe(502);
    });
});

describe('codexStoreMiddleware', () => {
    it('injects providerOptions.openai.store=false so the SDK never emits item references', async () => {
        const params = {
            prompt: [],
            providerOptions: { openai: { reasoningEffort: 'high' } },
        } as unknown as LanguageModelV4CallOptions;
        const out = await codexStoreMiddleware.transformParams!({
            type: 'stream',
            params,
            model: {} as LanguageModelV4,
        });
        expect(out.providerOptions).toEqual({
            openai: { reasoningEffort: 'high', store: false },
        });
    });

    it('overrides a caller-supplied store=true', async () => {
        const params = {
            prompt: [],
            providerOptions: { openai: { store: true } },
        } as unknown as LanguageModelV4CallOptions;
        const out = await codexStoreMiddleware.transformParams!({
            type: 'generate',
            params,
            model: {} as LanguageModelV4,
        });
        expect(out.providerOptions?.openai?.store).toBe(false);
    });
});

describe('listCodexModels', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
        vi.restoreAllMocks();
    });
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('discovers models with auth + originator headers, filtering hidden and sorting by priority', async () => {
        let seenHeaders: Headers | undefined;
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(String(input)).toContain(`${CODEX_BASE_URL}/models?client_version=`);
            seenHeaders = new Headers(init?.headers);
            return new Response(JSON.stringify({
                models: [
                    { slug: 'gpt-5.4', priority: 2, visibility: 'list' },
                    { slug: 'codex-auto-review', priority: 0, visibility: 'hide' },
                    { slug: 'gpt-5.5', priority: 1, visibility: 'list', display_name: 'GPT-5.5' },
                ],
            }), { status: 200 });
        }) as typeof fetch;

        const result = await listCodexModels();
        expect(result.providers).toHaveLength(1);
        expect(result.providers[0]?.id).toBe('codex');
        expect(result.providers[0]?.name).toBe('OpenAI Codex');
        expect(result.providers[0]?.models).toEqual([
            { id: 'gpt-5.5', name: 'GPT-5.5', reasoning: true },
            { id: 'gpt-5.4', reasoning: true },
        ]);
        expect(seenHeaders?.get('Authorization')).toBe('Bearer test-access-token');
        expect(seenHeaders?.get('chatgpt-account-id')).toBe('acct-123');
        expect(seenHeaders?.get('originator')).toBe('codex_cli_rs');
    });

    it('falls back to the hardcoded list when discovery fails', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new Error('offline');
        }) as typeof fetch;

        const result = await listCodexModels();
        const ids = result.providers[0]?.models.map((m) => m.id);
        expect(ids).toContain('gpt-5.6-sol');
        expect(result.providers[0]?.models.every((m) => m.reasoning === true)).toBe(true);
    });
});
