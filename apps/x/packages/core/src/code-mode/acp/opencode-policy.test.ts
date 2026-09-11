import { afterEach, expect, it, vi } from 'vitest';
import { enforceOpenCodePolicy, rowboatOpenCodeRules } from './opencode-policy.js';
import type { OpenCodeProcess } from './opencode-process.js';
afterEach(() => vi.unstubAllGlobals());

it('overrides configured allows while retaining project, custom-agent and session denials', () => {
    const deny = { permission: 'bash', pattern: 'rm *', action: 'deny' };
    const rules = rowboatOpenCodeRules([{ name: 'custom', permission: [{ permission: '*', pattern: '*', action: 'allow' }, deny] }], { permission: [{ ...deny, pattern: 'git push*' }] }, 'custom');
    expect(rules[0]).toEqual({ permission: '*', pattern: '*', action: 'ask' });
    expect(rules).toContainEqual(deny);
    expect(rules).toContainEqual({ ...deny, pattern: 'git push*' });
    expect(rules).toContainEqual({ permission: 'task', pattern: '*', action: 'deny' });
    expect(rules.some(r => r.action === 'allow')).toBe(false);
});
it('fails closed on malformed permission discovery', () => {
    expect(() => rowboatOpenCodeRules([{}], {}, 'build')).toThrow();
});

it('tightens and relaxes mode rules without losing explicit session denials or growing unchanged rules', async () => {
    type Rule = { permission: string; pattern: string; action: string };
    let session: { permission: Rule[]; metadata?: unknown } = { permission: [{ permission: 'read', pattern: '*.secret', action: 'deny' }] };
    const agents = [{ name: 'build', permission: [] }, { name: 'plan', permission: [{ permission: 'edit', pattern: '*', action: 'deny' }] }];
    const request = vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname === '/agent') return Response.json(agents);
        if (init.method === 'PATCH') {
            const body = JSON.parse(init.body as string);
            session = { permission: [...session.permission, ...body.permission], metadata: body.metadata };
        }
        return Response.json(session);
    });
    vi.stubGlobal('fetch', request);
    const handle = { url: 'http://127.0.0.1:1234', authorization: 'private' } as OpenCodeProcess;
    await enforceOpenCodePolicy(handle, '/project', 's', 'plan');
    const length = session.permission.length;
    await enforceOpenCodePolicy(handle, '/project', 's', 'plan');
    expect(session.permission).toHaveLength(length);
    await enforceOpenCodePolicy(handle, '/project', 's', 'build');
    const reversed = [...session.permission].reverse();
    expect(reversed.find(r => r.permission === 'edit' || r.permission === '*')?.action).toBe('ask');
    expect(reversed.find(r => r.permission === 'read' || r.permission === '*')?.action).toBe('deny');
    session.permission.push({ permission: 'bash', pattern: '*', action: 'deny' });
    await enforceOpenCodePolicy(handle, '/project', 's', 'build');
    expect([...session.permission].reverse().find(r => r.permission === 'bash' || r.permission === '*')?.action).toBe('deny');
    session.permission = [];
    await expect(enforceOpenCodePolicy(handle, '/project', 's', 'build')).rejects.toThrow('changed outside Rowboat');
});
