import { describe, expect, it, vi } from 'vitest';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { PermissionBroker } from './permission-broker.js';

const request = (kinds = ['allow_once', 'allow_always', 'reject_once']): RequestPermissionRequest => ({
    sessionId: 's', toolCall: { toolCallId: 't', title: 'Write file', kind: 'edit' },
    options: kinds.map(kind => ({ kind, optionId: kind, name: kind })) as RequestPermissionRequest['options'],
});
describe('permission scope and cancellation', () => {
    it('never widens allow once or picks an unrelated first option', async () => {
        const broker = new PermissionBroker({ policy: 'ask', ask: async () => 'allow_once' });
        expect(await broker.resolve(request(['allow_always']))).toEqual({ outcome: { outcome: 'cancelled' } });
    });
    it('rejects safely when no rejection option exists', async () => {
        const broker = new PermissionBroker({ policy: 'ask', ask: async () => 'reject' });
        expect(await broker.resolve(request(['allow_once']))).toEqual({ outcome: { outcome: 'cancelled' } });
    });
    it('does not remember approvals by broad tool kind', async () => {
        const ask = vi.fn().mockResolvedValueOnce('allow_always').mockResolvedValueOnce('reject');
        const broker = new PermissionBroker({ policy: 'ask', ask });
        await broker.resolve(request());
        expect(await broker.resolve(request())).toMatchObject({ outcome: { optionId: 'reject_once' } });
        expect(ask).toHaveBeenCalledTimes(2);
    });
    it('YOLO grants only the individual request', async () => {
        const broker = new PermissionBroker({ policy: 'yolo', ask: async () => 'reject' });
        expect(await broker.resolve(request())).toMatchObject({ outcome: { optionId: 'allow_once' } });
    });
    it('rejects persistent approval when upstream scope is unavailable', async () => {
        const broker = new PermissionBroker({ policy: 'ask', allowPersistent: false, ask: async ask => {
            expect(ask.allowAlways).toBe(false); return 'allow_always';
        } });
        expect(await broker.resolve(request())).toEqual({ outcome: { outcome: 'cancelled' } });
    });
    it('disconnect rejects a pending approval', async () => {
        const broker = new PermissionBroker({ policy: 'ask', ask: () => new Promise(() => {}) });
        const pending = broker.resolve(request()); broker.cancel();
        expect(await pending).toMatchObject({ outcome: { optionId: 'reject_once' } });
    });
});
