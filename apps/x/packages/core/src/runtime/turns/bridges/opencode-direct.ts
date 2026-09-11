import { randomUUID } from 'node:crypto';
import { ConversationMessage } from '@x/shared/dist/turns.js';
import type { JsonValue } from '@x/shared/dist/turns.js';
import type { ResolvedModel, LlmStreamEvent } from '../model-registry.js';

// Compatibility for already-persisted direct-dispatch turns. New OpenCode
// turns use the same Rowboat-model delegation path as Codex.
// This descriptor is internal: it never resolves a Rowboat AI provider.
export const OPENCODE_DIRECT = { provider: 'rowboat-internal', model: 'opencode-direct' } as const;
export function isOpenCodeDirect(model: { provider: string; model: string } | undefined): boolean {
    return model?.provider === OPENCODE_DIRECT.provider && model.model === OPENCODE_DIRECT.model;
}
export function openCodeDirectModel(): ResolvedModel {
    return {
        descriptor: OPENCODE_DIRECT,
        encodeMessages: messages => JSON.parse(JSON.stringify(messages)) as JsonValue[],
        async *stream(request): AsyncGenerator<LlmStreamEvent> {
            request.signal.throwIfAborted();
            const messages = request.messages.map(m => ConversationMessage.parse(m));
            // Include queued user messages since the last completed coding call.
            // Native OpenCode owns conversation context; never replay old turns.
            let boundary = -1;
            for (let i = 0; i < messages.length; i++) {
                const message = messages[i];
                if (message.role === 'tool' || (message.role === 'assistant' && Array.isArray(message.content) && message.content.some(p => p.type === 'tool-call'))) boundary = i;
            }
            const users = messages.slice(boundary + 1).filter(m => m.role === 'user');
            if (!users.length) {
                yield { type: 'completed', message: { role: 'assistant', content: [] }, finishReason: 'stop', usage: {} };
                return;
            }
            const prompt = users.map(m => {
                if (typeof m.content === 'string') return m.content;
                return m.content.map(p => {
                    if (p.type === 'text') return p.text;
                    if (p.type === 'attachment') return '\nReferenced file: ' + p.path + (p.lineNumber ? ':' + p.lineNumber : '');
                    throw new Error('OpenCode image attachments are not supported yet. Send a text request instead.');
                }).join('\n');
            }).join('\n\n');
            const config = JSON.parse(request.systemPrompt) as { cwd?: string };
            yield {
                type: 'completed', finishReason: 'tool-calls', usage: {},
                message: { role: 'assistant', content: [{
                    type: 'tool-call', toolCallId: randomUUID(), toolName: 'code_agent_run',
                    arguments: { agent: 'opencode', ...(config.cwd ? { cwd: config.cwd } : {}), prompt },
                }] },
            };
        },
    };
}
