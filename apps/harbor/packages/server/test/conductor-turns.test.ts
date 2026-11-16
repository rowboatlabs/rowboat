import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '../src/connectors/conductor/api.js';
import { asClaudeEvent, endsTurn, isRequest, transcriptActivity, transcriptAnswer, transcriptFailure, turnOf } from '../src/connectors/conductor/turns.js';

// Reading a Conductor transcript (spec §8 Connectors, 2026-10-06): entries are
// brought to the Claude Code event shape, whatever form `content` arrives in.

let n = 0;
const entry = (type: string, content: unknown): TranscriptMessage => ({ id: `m${++n}`, sessionId: 's', sessionIndex: n, type, content, receivedAt: '2026-10-06T00:00:00.000Z' });
const assistant = (blocks: unknown[]) => entry('assistant', { type: 'assistant', message: { content: blocks } });

describe('a Conductor transcript', () => {
  it('reads Claude SDK messages, as objects or as JSON text', () => {
    expect(asClaudeEvent(entry('assistant', { type: 'assistant', message: { content: [] } })).type).toBe('claude-assistant');
    expect(asClaudeEvent(entry('message', JSON.stringify({ type: 'result', subtype: 'success' }))).type).toBe('claude-result');
  });

  it('shows what the agent is doing, and answers with its last word', () => {
    expect(transcriptActivity(assistant([{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts' } }]))).toBe('is editing src/a.ts');
    expect(transcriptAnswer([assistant([{ type: 'text', text: 'First.' }]), assistant([{ type: 'text', text: 'Final.' }])])).toBe('Final.');
  });

  it('reads plain-text content as the text', () => {
    expect(transcriptAnswer([entry('assistant', 'All done.')])).toBe('All done.');
  });

  it('reads a failed result as the failure', () => {
    expect(transcriptFailure([entry('result', { type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['Hit the turn limit'] })])).toBe('Hit the turn limit');
  });

  it('reads a live transcript: the request and its turn by turnId, the activity, the answer, and the end', () => {
    // Trimmed from a real session (2026-10-07): Haiku on rowboatlabs/rowboat, asked to list apps/.
    const turnId = 'a179a0bc-58af-4a71-8faf-78679eff9b18';
    const agent = (rawPayload: unknown) => entry('agent', { type: 'agent', rawPayload, userMessageId: turnId, turnId });
    const live = [
      entry('userMessage', { type: 'userMessage', id: turnId, message: 'Run `ls apps` …\n\n[Spaces request LIVECHECK1]', state: 'sent', turnId }),
      agent({ type: 'system', subtype: 'session_state_changed', state: 'running' }),
      agent({ type: 'command_lifecycle', state: 'started' }),
      agent({ type: 'system', subtype: 'init', cwd: '/home/vercel-sandbox/rowboat' }),
      agent({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Let me run these.' }] } }),
      agent({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls apps && echo $ROWBOAT_URL' } }] } }),
      agent({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'harbor\nx' }] }, parent_tool_use_id: null }),
      agent({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The `apps/` directory contains `harbor` and `x`.' }] } }),
      agent({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn' }),
      agent({ type: 'command_lifecycle', state: 'completed' }),
      agent({ type: 'system', subtype: 'session_state_changed', state: 'idle' }),
    ];
    expect(live.every((e) => turnOf(e) === turnId)).toBe(true);
    expect(live.filter(isRequest)).toHaveLength(1);
    expect(transcriptActivity(live[5]!)).toBe('is running `ls apps && echo $ROWBOAT_URL`');
    expect(transcriptAnswer(live)).toBe('The `apps/` directory contains `harbor` and `x`.');
    expect(transcriptFailure(live)).toBeUndefined();
    expect(live.map(endsTurn)).toEqual([...Array(10).fill(false), true]);
  });
});
