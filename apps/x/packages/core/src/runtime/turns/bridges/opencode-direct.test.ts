import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { RealAgentResolver } from './real-agent-resolver.js';
import { RealModelRegistry } from './real-model-registry.js';
import { OPENCODE_DIRECT, openCodeDirectModel } from './opencode-direct.js';
import type { LlmStreamEvent, ModelStreamRequest } from '../model-registry.js';
const request = (messages: ModelStreamRequest['messages']): ModelStreamRequest => ({ systemPrompt: JSON.stringify({ cwd: '/project with spaces' }), messages, tools: [], parameters: {}, signal: new AbortController().signal });
async function collect(req: ModelStreamRequest) { const events: LlmStreamEvent[] = []; for await (const e of openCodeDirectModel().stream(req)) events.push(e); return events; }
it('can still resume a persisted legacy direct-dispatch turn', async () => {
    const forbidden = vi.fn(async () => { throw new Error('Legacy turn should not resolve a provider'); });
    const registry = new RealModelRegistry({ resolveProvider: forbidden, invoke: forbidden as never });
    expect((await registry.resolve(OPENCODE_DIRECT)).descriptor).toEqual(OPENCODE_DIRECT);
    expect(forbidden).not.toHaveBeenCalled();
});
it.each(['codex', 'opencode'] as const)('routes new %s turns through the configured Rowboat model', async codeMode => {
    const resolver = new RealAgentResolver({
        load: async () => ({ name: 'copilot', instructions: '', tools: { code_agent_run: { type: 'builtin', name: 'code_agent_run' } } }),
        defaultModel: async () => ({ provider: 'google', model: 'gemini-test' }),
        builtins: { code_agent_run: { inputSchema: z.object({ prompt: z.string() }), description: 'Coding', permission: 'none', execute: async () => null } },
        loadNotes: () => null, loadWorkDir: () => null,
    });
    const agent = await resolver.resolve({ agentId: 'copilot', overrides: { composition: { codeMode, codeCwd: '/project' } } });
    expect(agent.model).toEqual({ provider: 'google', model: 'gemini-test' });
    expect(agent.tools.map(t => t.name)).toContain('code_agent_run');
    expect(agent.systemPrompt).toContain(codeMode);
    const explicit = await resolver.resolve({ agentId: 'copilot', overrides: { model: { provider: 'custom', model: 'chat-model' }, composition: { codeMode } } });
    expect(explicit.model).toEqual({ provider: 'custom', model: 'chat-model' });
    const migrated = await resolver.resolve({ agentId: 'copilot', overrides: { model: OPENCODE_DIRECT, composition: { codeMode } } });
    expect(migrated.model).toEqual({ provider: 'google', model: 'gemini-test' });
});
it('forwards new text verbatim once, including queued text, without replaying history or adding a second response', async () => {
    const history: ModelStreamRequest['messages'] = [{ role: 'user', content: 'old' }, { role: 'tool', toolName: 'code_agent_run', toolCallId: 'old', content: 'done' }];
    const messages: ModelStreamRequest['messages'] = [...history, { role: 'user', content: 'inspect this' }, { role: 'user', content: 'also test it' }];
    const events = await collect(request(messages));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'completed', finishReason: 'tool-calls', message: { content: [{ toolName: 'code_agent_run', arguments: { agent: 'opencode', cwd: '/project with spaces', prompt: 'inspect this\n\nalso test it' } }] } });
    expect(await collect(request([...messages, { role: 'tool', toolName: 'code_agent_run', toolCallId: 'new', content: 'done' }]))).toEqual([{ type: 'completed', message: { role: 'assistant', content: [] }, finishReason: 'stop', usage: {} }]);
});
it('honors cancellation and explicitly rejects unsupported inline images', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(collect({ ...request([]), signal: controller.signal })).rejects.toThrow();
    await expect(collect(request([{ role: 'user', content: [{ type: 'image', data: 'abc', mediaType: 'image/png' }] }]))).rejects.toThrow('image attachments');
});

it('does not carry the internal dispatcher model into another coding engine', async () => {
    const resolver = new RealAgentResolver({ load: async () => ({ name: 'copilot', instructions: '', tools: {} }), defaultModel: async () => ({ provider: 'configured', model: 'regular' }), loadNotes: () => null, loadWorkDir: () => null });
    const agent = await resolver.resolve({ agentId: 'copilot', overrides: { model: OPENCODE_DIRECT, composition: { codeMode: 'claude' } } });
    expect(agent.model).toEqual({ provider: 'configured', model: 'regular' });
});
