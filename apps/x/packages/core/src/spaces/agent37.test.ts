import { describe, expect, it, vi } from 'vitest';
import { createAgent37Instance, kindOfTemplate, listAgent37Instances } from './agent37.js';

// The app's side of adding an Agent37 agent (2026-10-05): find or create its instance with the person's key.

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Agent37 instances', () => {
  it('lists the workspace’s instances with the kind each runs, minus failed ones', async () => {
    const fetchImpl = vi.fn(async () =>
      reply(200, {
        data: [
          { id: 'a', name: 'main', template: 'agent37-hermes@2026.07.02b', status: 'running' },
          { id: 'b', name: null, template: 'agent37-openclaw', status: 'sleeping' },
          { id: 'c', name: 'coder', template: 'agent37-codex', status: 'running' },
          { id: 'd', name: 'broken', template: 'agent37-hermes', status: 'failed' },
        ],
      }),
    );
    expect(await listAgent37Instances('sk_live_x', fetchImpl as unknown as typeof fetch)).toEqual([
      { id: 'a', name: 'main', template: 'agent37-hermes@2026.07.02b', status: 'running', kind: 'hermes' },
      { id: 'b', name: null, template: 'agent37-openclaw', status: 'sleeping', kind: 'openclaw' },
      { id: 'c', name: 'coder', template: 'agent37-codex', status: 'running' },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.agent37.com/v1/instances', expect.objectContaining({ headers: { authorization: 'Bearer sk_live_x' } }));
  });

  it('says plainly when the key is refused', async () => {
    const fetchImpl = vi.fn(async () => reply(401, { error: { code: 'invalid_api_key', message: 'Missing, malformed, or revoked API key.' } }));
    await expect(listAgent37Instances('bad', fetchImpl as unknown as typeof fetch)).rejects.toThrow('Agent37 did not accept this key: Missing, malformed, or revoked API key.');
  });

  it('creates an instance of the kind, with a model budget and sleep', async () => {
    const fetchImpl = vi.fn(async () => reply(201, { id: 'n1', name: 'rowboat-hermes', template: 'agent37-hermes', status: 'running' }));
    const created = await createAgent37Instance('sk_live_x', { kind: 'hermes', name: 'rowboat-hermes', monthlyBudgetUsd: 5, autoSleep: true }, fetchImpl as unknown as typeof fetch);
    expect(created).toEqual({ id: 'n1', name: 'rowboat-hermes', template: 'agent37-hermes', status: 'running', kind: 'hermes' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      template: 'agent37-hermes',
      name: 'rowboat-hermes',
      budget: { monthly_cap_micros: 5_000_000 },
      auto_sleep: true,
      metadata: { created_by: 'rowboat' },
    });
  });

  it('passes on Agent37’s reason when it will not create one', async () => {
    const fetchImpl = vi.fn(async () => reply(402, { error: { code: 'insufficient_balance', message: 'Add balance to your workspace and try again.' } }));
    await expect(createAgent37Instance('k', { kind: 'openclaw', name: 'x', monthlyBudgetUsd: 1, autoSleep: false }, fetchImpl as unknown as typeof fetch)).rejects.toThrow('Add balance to your workspace and try again.');
  });

  it('reads the kind from the template', () => {
    expect(kindOfTemplate('agent37-hermes-small')).toBe('hermes');
    expect(kindOfTemplate('agent37-openclaw@1')).toBe('openclaw');
    expect(kindOfTemplate('my-image')).toBeUndefined();
  });
});
