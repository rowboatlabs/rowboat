import { describe, expect, it } from 'vitest';
import { parseServerSentEvents } from '../src/connectors/replicas/api.js';
import { attachmentLinks } from '../src/connectors/common/prompt.js';
import { activityOf, answerOf, failureOf, readsAnswers } from '../src/connectors/common/agent-events.js';

// Reading Replicas's streams and its coding agents' events (spec §8
// Connectors, 2026-09-30): the documented shapes, and nothing guessed.

describe('the event stream', () => {
  it('parses data frames split across chunks, skipping pings and junk', async () => {
    const text = ': ping\n\ndata: {"type":"chat.turn.started","payload":{"chatId":"c1"}}\n\ndata: not json\n\ndata: {"type":"chat.turn.completed","payload":{"chatId":"c1"}}\n\n';
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    });
    const types: string[] = [];
    for await (const event of parseServerSentEvents(body, new AbortController().signal)) types.push(event.type);
    expect(types).toEqual(['chat.turn.started', 'chat.turn.completed']);
  });
});

describe('what a turn says', () => {
  it('reads Claude Code: the tool it is using, its last own answer, and a failed result', () => {
    const tool = { type: 'claude-assistant', payload: { message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/login.ts' } }] } } };
    const sub = { type: 'claude-assistant', payload: { parent_tool_use_id: 't9', message: { content: [{ type: 'text', text: 'sub-agent chatter' }] } } };
    const final = { type: 'claude-assistant', payload: { parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'All fixed.' }] } } };
    expect(activityOf('claude-code', tool)).toBe('is editing src/login.ts');
    expect(answerOf('claude-code', [tool, final, sub])).toBe('All fixed.');
    expect(failureOf('claude-code', [final, { type: 'claude-result', payload: { subtype: 'success', is_error: false } }])).toBeUndefined();
    expect(failureOf('claude-code', [{ type: 'claude-result', payload: { subtype: 'error_during_execution', is_error: false } }])).toBe('Claude Code stopped with an error');
  });

  it('reads Codex: a shell command given as argv, a patch, and its answer', () => {
    const shell = { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'pnpm test'] }) } };
    expect(activityOf('codex', shell)).toBe('is running `bash -lc pnpm test`');
    expect(activityOf('codex', { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch' } })).toBe('is editing files');
    expect(answerOf('codex', [{ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Green.' }] } }])).toBe('Green.');
  });

  it('guesses nothing for coding agents whose events are undocumented', () => {
    for (const kind of ['cursor', 'opencode', 'pi', 'muse-code']) {
      expect(readsAnswers(kind)).toBe(false);
      expect(answerOf(kind, [{ type: `${kind}-assistant`, payload: { text: 'hi' } }])).toBeUndefined();
      expect(activityOf(kind, { type: `${kind}-tool_call`, payload: {} })).toBeUndefined();
    }
  });
});

describe('attachments in a message', () => {
  it('finds same-space file and image links once each, by their names', () => {
    const space = '01M3RZS5TR83AZ2N89ABPNNMAK';
    const hash = 'a'.repeat(64);
    const body = `see ![shot](https://acme.test/s/${space}/b/${hash}) and [deploy.log](https://acme.test/s/${space}/b/${'b'.repeat(64)}?name=deploy%20log.txt) again ![x](https://acme.test/s/${space}/b/${hash}) and elsewhere [o](https://acme.test/s/01M3RZS5TR83AZ2N89ABPNNMAX/b/${'c'.repeat(64)})`;
    expect(attachmentLinks(body, space)).toEqual([
      { hash, name: 'shot' },
      { hash: 'b'.repeat(64), name: 'deploy log.txt' },
    ]);
  });
});
