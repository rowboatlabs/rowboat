import { describe, expect, it } from 'vitest';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import { MAX_LINKS, SpaceResponseIndexer, linkKey, postedMessageId, type ResponseLinkStore } from './response-index.js';

const origin = (threadRootId: string, orgId = 'org-1', spaceId = 'space-1') => ({
  kind: 'space_mention' as const,
  orgId,
  spaceId,
  threadRootId,
  messageId: `mention-${threadRootId}`,
});

function harness() {
  let file: { version: 1; links: Record<string, { sessionId: string; turnId: string; inputIndex?: number }> } = { version: 1, links: {} };
  let writes = 0;
  const store: ResponseLinkStore = {
    read: () => ({ version: 1, links: { ...file.links } }),
    write: (index) => {
      file = index;
      writes += 1;
    },
  };
  const indexer = new SpaceResponseIndexer(store, (orgId) => (orgId === 'org-1' ? 'spaces-org-1' : null));
  const turn = (turnId: string, event: Record<string, unknown>, sessionId = 'sess-1'): TurnBusEvent =>
    ({ turnId, sessionId, event }) as unknown as TurnBusEvent;
  const mcpOutput = (messageId: string, threadRoot?: string) => ({
    success: true,
    serverName: 'spaces-org-1',
    toolName: 'post_message',
    result: {
      content: [{ type: 'text', text: JSON.stringify({ messageId, ...(threadRoot ? { threadRoot } : {}) }) }],
      structuredContent: { messageId, ...(threadRoot ? { threadRoot } : {}) },
    },
  });
  const post = (turnId: string, toolCallId: string, args: Record<string, unknown>, serverName = 'spaces-org-1') =>
    turn(turnId, {
      type: 'tool_invocation_requested',
      toolCallId,
      toolId: 'executeMcpTool',
      toolName: 'executeMcpTool',
      execution: 'sync',
      input: { serverName, toolName: 'post_message', arguments: args },
    });
  const result = (turnId: string, toolCallId: string, output: unknown, isError = false) =>
    turn(turnId, { type: 'tool_result', toolCallId, toolName: 'executeMcpTool', source: 'sync', result: { output, isError } });
  // The projected builtin form (the spaces skill since 2026-09-09).
  const builtinPost = (turnId: string, toolCallId: string, args: Record<string, unknown>) =>
    turn(turnId, {
      type: 'tool_invocation_requested',
      toolCallId,
      toolId: 'builtin:post_message',
      toolName: 'post_message',
      execution: 'sync',
      input: args,
    });
  const builtinResult = (turnId: string, toolCallId: string, output: unknown, isError = false) =>
    turn(turnId, { type: 'tool_result', toolCallId, toolName: 'post_message', source: 'sync', result: { output, isError } });
  return { indexer, turn, post, result, mcpOutput, builtinPost, builtinResult, links: () => file.links, writes: () => writes };
}

describe('postedMessageId', () => {
  it('reads the projected builtin output directly (the unwrapped structured result)', () => {
    expect(postedMessageId({ messageId: 'm0', threadRoot: 'r' })).toBe('m0');
    expect(postedMessageId({ success: false, error: { code: 'not_found' } })).toBeNull();
  });

  it('prefers structuredContent, falls back to the JSON text block', () => {
    expect(postedMessageId({ success: true, result: { structuredContent: { messageId: 'm1' } } })).toBe('m1');
    expect(postedMessageId({ success: true, result: { content: [{ type: 'text', text: '{"messageId":"m2"}' }] } })).toBe('m2');
  });

  it('yields nothing for failures, error results, or non-JSON text', () => {
    expect(postedMessageId({ success: false, error: 'nope' })).toBeNull();
    expect(postedMessageId({ success: true, result: { isError: true, content: [{ type: 'text', text: '{"messageId":"m"}' }] } })).toBeNull();
    expect(postedMessageId({ success: true, result: { content: [{ type: 'text', text: 'not json' }] } })).toBeNull();
    expect(postedMessageId(null)).toBeNull();
  });
});

describe('SpaceResponseIndexer', () => {
  it('links the receipt of a mention-created turn to the turn (creating input)', () => {
    const h = harness();
    h.indexer.handleTurnEvent(h.turn('t1', { type: 'turn_created', origin: origin('root-1') }));
    h.indexer.handleTurnEvent(h.post('t1', 'call-1', { spaceId: 'space-1', threadRoot: 'root-1', body: 'Done.' }));
    h.indexer.handleTurnEvent(h.result('t1', 'call-1', h.mcpOutput('reply-1', 'root-1')));
    expect(h.links()).toEqual({ [linkKey('org-1', 'space-1', 'reply-1')]: { sessionId: 'sess-1', turnId: 't1' } });
    expect(h.indexer.link('org-1', 'space-1', 'reply-1')).toEqual({ sessionId: 'sess-1', turnId: 't1' });
    expect(h.indexer.link('org-1', 'space-1', 'other')).toBeNull();
  });

  it('attributes a post to the steered input whose thread it answers', () => {
    const h = harness();
    h.indexer.handleTurnEvent(h.turn('t1', { type: 'turn_created', origin: origin('root-1') }));
    h.indexer.handleTurnEvent(h.turn('t1', { type: 'input_added', inputIndex: 2, origin: origin('root-2') }));
    h.indexer.handleTurnEvent(h.post('t1', 'call-a', { spaceId: 'space-1', threadRoot: 'root-2', body: 'second' }));
    h.indexer.handleTurnEvent(h.result('t1', 'call-a', h.mcpOutput('reply-b', 'root-2')));
    h.indexer.handleTurnEvent(h.post('t1', 'call-b', { spaceId: 'space-1', threadRoot: 'root-1', body: 'first' }));
    h.indexer.handleTurnEvent(h.result('t1', 'call-b', h.mcpOutput('reply-a', 'root-1')));
    expect(h.links()).toEqual({
      [linkKey('org-1', 'space-1', 'reply-b')]: { sessionId: 'sess-1', turnId: 't1', inputIndex: 2 },
      [linkKey('org-1', 'space-1', 'reply-a')]: { sessionId: 'sess-1', turnId: 't1' },
    });
  });

  it('falls back to the first mention for a post outside any mentioned thread (a new root)', () => {
    const h = harness();
    h.indexer.handleTurnEvent(h.turn('t1', { type: 'input_added', inputIndex: 1, origin: origin('root-1') }));
    h.indexer.handleTurnEvent(h.post('t1', 'call-1', { spaceId: 'space-1', body: 'announcement' }));
    h.indexer.handleTurnEvent(h.result('t1', 'call-1', h.mcpOutput('root-new')));
    expect(h.links()).toEqual({ [linkKey('org-1', 'space-1', 'root-new')]: { sessionId: 'sess-1', turnId: 't1', inputIndex: 1 } });
  });

  it('ignores turns without a mention origin, other MCP servers, other tools, and failed posts', () => {
    const h = harness();
    // no origin → the person chatting in the thread's session
    h.indexer.handleTurnEvent(h.turn('t0', { type: 'turn_created' }));
    h.indexer.handleTurnEvent(h.post('t0', 'c0', { spaceId: 'space-1', body: 'x' }));
    h.indexer.handleTurnEvent(h.result('t0', 'c0', h.mcpOutput('m0')));

    h.indexer.handleTurnEvent(h.turn('t1', { type: 'turn_created', origin: origin('root-1') }));
    // another server
    h.indexer.handleTurnEvent(h.post('t1', 'c1', { spaceId: 'space-1', body: 'x' }, 'some-other-mcp'));
    h.indexer.handleTurnEvent(h.result('t1', 'c1', h.mcpOutput('m1')));
    // another tool on the org server
    h.indexer.handleTurnEvent(
      h.turn('t1', {
        type: 'tool_invocation_requested',
        toolCallId: 'c2',
        toolId: 'executeMcpTool',
        toolName: 'executeMcpTool',
        execution: 'sync',
        input: { serverName: 'spaces-org-1', toolName: 'read_thread', arguments: { spaceId: 'space-1', rootMessageId: 'root-1' } },
      }),
    );
    h.indexer.handleTurnEvent(h.result('t1', 'c2', { success: true, result: { structuredContent: { messageId: 'm2' } } }));
    // a post the org refused
    h.indexer.handleTurnEvent(h.post('t1', 'c3', { spaceId: 'space-1', threadRoot: 'root-1', body: 'x' }));
    h.indexer.handleTurnEvent(h.result('t1', 'c3', { success: false, error: 'Failed to execute MCP tool: forbidden' }));
    // a runtime error result
    h.indexer.handleTurnEvent(h.post('t1', 'c4', { spaceId: 'space-1', threadRoot: 'root-1', body: 'x' }));
    h.indexer.handleTurnEvent(h.result('t1', 'c4', 'permission denied', true));

    expect(h.links()).toEqual({});
    expect(h.writes()).toBe(0);
  });

  it('forgets a settled turn: a late result for it records nothing', () => {
    const h = harness();
    h.indexer.handleTurnEvent(h.turn('t1', { type: 'turn_created', origin: origin('root-1') }));
    h.indexer.handleTurnEvent(h.post('t1', 'c1', { spaceId: 'space-1', threadRoot: 'root-1', body: 'x' }));
    h.indexer.handleTurnEvent(h.turn('t1', { type: 'turn_cancelled' }));
    h.indexer.handleTurnEvent(h.result('t1', 'c1', h.mcpOutput('m1')));
    expect(h.links()).toEqual({});
  });

  it('caps the file at MAX_LINKS, dropping the oldest', () => {
    const h = harness();
    h.indexer.handleTurnEvent(h.turn('t1', { type: 'turn_created', origin: origin('root-1') }));
    for (let i = 0; i < MAX_LINKS + 3; i++) {
      h.indexer.handleTurnEvent(h.post('t1', `c${i}`, { spaceId: 'space-1', threadRoot: 'root-1', body: 'x' }));
      h.indexer.handleTurnEvent(h.result('t1', `c${i}`, h.mcpOutput(`m${i}`)));
    }
    const keys = Object.keys(h.links());
    expect(keys).toHaveLength(MAX_LINKS);
    expect(keys[0]).toBe(linkKey('org-1', 'space-1', 'm3'));
    expect(keys[keys.length - 1]).toBe(linkKey('org-1', 'space-1', `m${MAX_LINKS + 2}`));
  });
});


describe('the projected builtin post_message', () => {
  const mentionTurn = (h: ReturnType<typeof harness>, turnId: string, orgId = 'org-1') =>
    h.indexer.handleTurnEvent(h.turn(turnId, { type: 'turn_created', origin: origin('root-1', orgId) }));

  it('links a builtin post with no org argument to the turn\'s one mention org', () => {
    const h = harness();
    mentionTurn(h, 't1');
    h.indexer.handleTurnEvent(h.builtinPost('t1', 'c1', { spaceId: 'space-1', threadRoot: 'root-1', body: 'done' }));
    h.indexer.handleTurnEvent(h.builtinResult('t1', 'c1', { messageId: 'm-builtin', threadRoot: 'root-1' }));
    expect(h.links()[linkKey('org-1', 'space-1', 'm-builtin')]).toMatchObject({ sessionId: 'sess-1', turnId: 't1' });
  });

  it('matches an explicit org argument by id or by server name', () => {
    for (const org of ['org-1', 'spaces-org-1', 'Org 1']) {
      const h = harness();
      mentionTurn(h, 't1');
      h.indexer.handleTurnEvent(h.builtinPost('t1', 'c1', { org, spaceId: 'space-1', body: 'x' }));
      h.indexer.handleTurnEvent(h.builtinResult('t1', 'c1', { messageId: 'm1' }));
      expect(h.links()[linkKey('org-1', 'space-1', 'm1')], org).toBeDefined();
    }
  });

  it('ignores a builtin post naming an org no mention in the turn came from, and error results', () => {
    const h = harness();
    mentionTurn(h, 't1');
    h.indexer.handleTurnEvent(h.builtinPost('t1', 'c1', { org: 'elsewhere', spaceId: 'space-1', body: 'x' }));
    h.indexer.handleTurnEvent(h.builtinResult('t1', 'c1', { messageId: 'm1' }));
    h.indexer.handleTurnEvent(h.builtinPost('t1', 'c2', { spaceId: 'space-1', body: 'x' }));
    h.indexer.handleTurnEvent(h.builtinResult('t1', 'c2', { success: false, error: 'boom' }, true));
    expect(Object.keys(h.links())).toHaveLength(0);
  });
});
