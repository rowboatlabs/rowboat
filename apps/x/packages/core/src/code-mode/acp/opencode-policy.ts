import z from 'zod';
import type { OpenCodeProcess } from './opencode-process.js';

const Rule = z.object({ permission: z.string(), pattern: z.string(), action: z.enum(['allow', 'ask', 'deny']) });
const Rules = z.array(Rule);

/** Session rules run after agent rules. Preserve every explicit denial, including
 * custom agents, while bringing configured auto-allows through Rowboat's broker.
 * ACP 1.18.30 does not forward child-session approvals or persistent scope. */
export function rowboatOpenCodeRules(agents: unknown, session: unknown, mode: string) {
    const catalog = z.array(z.object({ name: z.string(), permission: Rules })).parse(agents);
    const active = catalog.find(a => a.name === mode);
    if (!active) throw new Error('OpenCode selected mode was not found in its permission catalog.');
    const previous = z.object({ permission: Rules.optional() }).parse(session);
    const rules = [
        { permission: '*', pattern: '*', action: 'ask' as const },
        ...[...active.permission, ...(previous.permission ?? [])].filter(r => r.action === 'deny'),
        { permission: 'task', pattern: '*', action: 'deny' as const },
        { permission: 'question', pattern: '*', action: 'deny' as const },
    ];
    return rules.filter((rule, index) => !rules.slice(index + 1).some(r => r.permission === rule.permission && r.pattern === rule.pattern && r.action === rule.action));
}

export async function openCodeRequest(handle: OpenCodeProcess, cwd: string, route: string, method = 'GET', body?: unknown): Promise<unknown> {
    const url = new URL(route, handle.url);
    url.searchParams.set('directory', cwd);
    const response = await fetch(url, {
        method, headers: { Authorization: handle.authorization, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`OpenCode ${method} ${route.split('/')[1]} failed (HTTP ${response.status}).`);
    return response.json();
}

export async function enforceOpenCodePolicy(handle: OpenCodeProcess, cwd: string, sessionId: string, mode: string): Promise<void> {
    const route = `/session/${encodeURIComponent(sessionId)}`;
    const [agents, session] = await Promise.all([
        openCodeRequest(handle, cwd, '/agent'), openCodeRequest(handle, cwd, route),
    ]);
    const current = z.object({ permission: Rules.optional(), metadata: z.record(z.string(), z.unknown()).optional() }).parse(session);
    const prior = current.metadata?.rowboatApprovalPolicy;
    const snapshot = prior === undefined ? undefined : z.object({ baseline: Rules, installed: Rules }).parse(prior);
    const existing = current.permission ?? [];
    if (snapshot && JSON.stringify(existing.slice(0, snapshot.installed.length)) !== JSON.stringify(snapshot.installed)) {
        throw new Error('OpenCode session permissions changed outside Rowboat. Create a new Code session to apply the current policy safely.');
    }
    const baseline = snapshot ? [...snapshot.baseline, ...existing.slice(snapshot.installed.length)] : existing;
    const permission = rowboatOpenCodeRules(agents, { permission: baseline }, mode);
    if (snapshot && JSON.stringify(existing.slice(-permission.length)) === JSON.stringify(permission)) return;
    const metadata = { ...current.metadata, rowboatApprovalPolicy: { baseline, installed: [...existing, ...permission] } };
    const updated = await openCodeRequest(handle, cwd, route, 'PATCH', { permission, metadata });
    const accepted = z.object({ permission: Rules }).parse(updated).permission;
    if (JSON.stringify(accepted.slice(-permission.length)) !== JSON.stringify(permission)) throw new Error('OpenCode did not accept Rowboat approval rules. Coding was not started.');
}
