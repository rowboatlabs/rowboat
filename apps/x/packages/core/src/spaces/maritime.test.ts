import { describe, expect, it, vi } from 'vitest';
import { kindOfMaritimeAgent, listMaritimeAgents } from './maritime.js';

// The app's side of adding a Maritime agent (2026-10-26): list the agents the person's key reaches.

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Maritime agents', () => {
  it('lists the account’s agents with the kind each runs, where its record says', async () => {
    const fetchImpl = vi.fn(async () =>
      reply(200, [
        { id: 'a', name: 'scout', framework: 'hermes', templateId: 'hermes', status: 'sleeping' },
        { id: 'b', name: 'coder', framework: 'custom', templateId: 'codex', status: 'active' },
        { id: 'c', name: 'claude', framework: 'custom', templateId: 'claude_code', status: 'sleeping' },
        { id: 'd', name: 'mine', framework: 'custom', templateId: null, status: 'sleeping' },
        { id: 'e', name: 'going', framework: 'hermes', templateId: 'hermes', status: 'deleting' },
      ]),
    );
    expect(await listMaritimeAgents('mk_x', fetchImpl as unknown as typeof fetch)).toEqual([
      { id: 'a', name: 'scout', framework: 'hermes', templateId: 'hermes', status: 'sleeping', kind: 'hermes' },
      { id: 'b', name: 'coder', framework: 'custom', templateId: 'codex', status: 'active', kind: 'codex' },
      { id: 'c', name: 'claude', framework: 'custom', templateId: 'claude_code', status: 'sleeping', kind: 'claude-code' },
      { id: 'd', name: 'mine', framework: 'custom', templateId: null, status: 'sleeping' },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.maritime.sh/api/agents', expect.objectContaining({ headers: { authorization: 'Bearer mk_x' } }));
  });

  it('says plainly when the key is refused', async () => {
    const fetchImpl = vi.fn(async () => reply(401, { detail: 'Invalid or expired API key' }));
    await expect(listMaritimeAgents('bad', fetchImpl as unknown as typeof fetch)).rejects.toThrow('Maritime did not accept this key: Invalid or expired API key');
  });

  it('reads the kind by template first, then by framework', () => {
    expect(kindOfMaritimeAgent({ framework: 'custom', templateId: 'claude_code' })).toBe('claude-code');
    expect(kindOfMaritimeAgent({ framework: 'hermes', templateId: null })).toBe('hermes');
    expect(kindOfMaritimeAgent({ framework: 'custom', templateId: null })).toBeUndefined();
  });
});
