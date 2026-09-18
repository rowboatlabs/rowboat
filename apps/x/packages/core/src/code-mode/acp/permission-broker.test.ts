import { describe, expect, it, vi } from 'vitest';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { PermissionBroker } from './permission-broker.js';

function request(kind: string): RequestPermissionRequest {
    return {
        toolCall: { toolCallId: 'tc1', title: `${kind} something`, kind },
        options: [
            { optionId: 'allow-always', name: 'Always', kind: 'allow_always' },
            { optionId: 'allow-once', name: 'Once', kind: 'allow_once' },
            { optionId: 'reject', name: 'No', kind: 'reject_once' },
        ],
    } as unknown as RequestPermissionRequest;
}

function selectedId(res: { outcome: { outcome: string; optionId?: string } }): string | undefined {
    return res.outcome.outcome === 'selected' ? res.outcome.optionId : undefined;
}

// Permission classification is agent-agnostic: the broker keys on the ACP tool
// kind, never on which coding agent is running, so OpenCode gets the same
// auto-approve/ask behavior as Claude Code and Codex.
describe('PermissionBroker', () => {
    it('auto-approves everything under yolo', async () => {
        const ask = vi.fn();
        const broker = new PermissionBroker({ policy: 'yolo', ask });
        const res = await broker.resolve(request('edit'));
        expect(selectedId(res as never)).toBe('allow-always');
        expect(ask).not.toHaveBeenCalled();
    });

    it('auto-approves reads but asks for writes under auto-approve-reads', async () => {
        const ask = vi.fn().mockResolvedValue('reject');
        const broker = new PermissionBroker({ policy: 'auto-approve-reads', ask });

        const readRes = await broker.resolve(request('read'));
        expect(selectedId(readRes as never)).toBe('allow-once');
        expect(ask).not.toHaveBeenCalled();

        const writeRes = await broker.resolve(request('edit'));
        expect(ask).toHaveBeenCalledTimes(1);
        expect(selectedId(writeRes as never)).toBe('reject');
    });

    it('remembers an always-allow for the rest of the run', async () => {
        const ask = vi.fn().mockResolvedValue('allow_always');
        const broker = new PermissionBroker({ policy: 'ask', ask });
        await broker.resolve(request('edit'));
        await broker.resolve(request('edit'));
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('degrades allow_always to an offered option instead of deadlocking', async () => {
        const broker = new PermissionBroker({ policy: 'yolo', ask: vi.fn() });
        const req = {
            toolCall: { toolCallId: 'tc2', title: 'run', kind: 'execute' },
            options: [{ optionId: 'once', name: 'Once', kind: 'allow_once' }],
        } as unknown as RequestPermissionRequest;
        const res = await broker.resolve(req);
        expect(selectedId(res as never)).toBe('once');
    });
});
