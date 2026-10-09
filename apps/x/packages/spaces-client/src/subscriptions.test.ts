import { describe, expect, it, vi } from 'vitest';
import type { ServerFrame } from '@rowboat/spaces-protocol';
import { SpaceSubscriptions, type LiveSubscriber } from './subscriptions.js';

// The per-space subscription registry (2026-09-15): a subscription survives
// the org's live client being closed and replaced under it — the failure
// that silenced every space on a session-backed org after each listing sync.

class FakeLive implements LiveSubscriber {
    readonly calls: Array<{ spaceId: string; afterOffset: number | undefined }> = [];
    readonly handlers = new Map<string, (frame: ServerFrame) => void>();
    readonly unsubscribed: string[] = [];
    subscribe(spaceId: string, handler: (frame: ServerFrame) => void, afterOffset?: number): () => void {
        this.calls.push({ spaceId, afterOffset });
        this.handlers.set(spaceId, handler);
        return () => {
            this.unsubscribed.push(spaceId);
            this.handlers.delete(spaceId);
        };
    }
    emit(spaceId: string, frame: ServerFrame): void {
        this.handlers.get(spaceId)?.(frame);
    }
}

const event = (spaceId: string, offset: number): ServerFrame =>
    ({ kind: 'event', spaceId, offset, at: '2026-09-15T00:00:00.000Z', event: { type: 'membership', membership: { spaceId, memberId: 'm', joinedAt: '' }, action: 'joined' } }) as unknown as ServerFrame;
const subscribed = (spaceId: string, fromOffset: number): ServerFrame => ({ kind: 'subscribed', spaceId, fromOffset }) as unknown as ServerFrame;

function harness() {
    const lives = new Map<string, FakeLive>();
    const gone = new Set<string>();
    const resetListeners = new Set<(orgId: string) => void>();
    const deps = {
        getLive: (orgId: string) => {
            if (gone.has(orgId)) throw new Error(`unknown org ${orgId}`);
            let live = lives.get(orgId);
            if (!live) {
                live = new FakeLive();
                lives.set(orgId, live);
            }
            return live;
        },
        onRuntimeReset: (l: (orgId: string) => void) => {
            resetListeners.add(l);
            return () => resetListeners.delete(l);
        },
    };
    /** What orgs.resetRuntime does: the client is gone; the next getLive builds a fresh one. */
    const reset = (orgId: string) => {
        lives.delete(orgId);
        for (const l of resetListeners) l(orgId);
    };
    return { registry: new SpaceSubscriptions(deps), lives, gone, reset };
}

describe('SpaceSubscriptions', () => {
    it('subscribes once per (org, space), relays frames, and a repeat call only swaps the relay', () => {
        const { registry, lives } = harness();
        const first = vi.fn();
        const second = vi.fn();
        registry.subscribe('org', 's1', first, 40);
        registry.subscribe('org', 's1', second);
        const live = lives.get('org')!;
        expect(live.calls).toEqual([{ spaceId: 's1', afterOffset: 40 }]);
        live.emit('s1', event('s1', 41));
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith(event('s1', 41));
    });

    it('re-subscribes on the fresh client after a runtime reset, resuming from the last event relayed', () => {
        const { registry, lives, reset } = harness();
        const relay = vi.fn();
        registry.subscribe('org', 's1', relay);
        registry.subscribe('org', 's2', relay);
        const dead = lives.get('org')!;
        dead.emit('s1', subscribed('s1', 100));
        dead.emit('s1', event('s1', 101));
        dead.emit('s1', event('s1', 102));
        dead.emit('s2', subscribed('s2', 7));

        reset('org');

        const fresh = lives.get('org')!;
        expect(fresh).not.toBe(dead);
        // s1 resumes after the last event it relayed; s2 saw no event and resumes from the head the org acknowledged.
        expect(fresh.calls).toEqual([
            { spaceId: 's1', afterOffset: 102 },
            { spaceId: 's2', afterOffset: 7 },
        ]);
        expect(dead.unsubscribed).toEqual(['s1', 's2']);
        // Frames keep flowing — through the same relay the host installed.
        fresh.emit('s1', event('s1', 103));
        expect(relay).toHaveBeenLastCalledWith(event('s1', 103));
        // And a second reset resumes from the newest again.
        reset('org');
        expect(lives.get('org')!.calls[0]).toEqual({ spaceId: 's1', afterOffset: 103 });
    });

    it('a reset of an org that is gone drops its subscriptions instead of throwing', () => {
        const { registry, gone, reset } = harness();
        registry.subscribe('org', 's1', vi.fn());
        registry.subscribe('other', 's9', vi.fn());
        gone.add('org');
        expect(() => reset('org')).not.toThrow();
        expect(registry.keys()).toEqual(['other/s9']);
    });

    it('unsubscribe and dropOrg stop the relay, and a later reset does not bring them back', () => {
        const { registry, lives, reset } = harness();
        const relay = vi.fn();
        registry.subscribe('org', 's1', relay);
        registry.subscribe('org', 's2', relay);
        registry.subscribe('org2', 's3', relay);
        registry.unsubscribe('org', 's1');
        expect(lives.get('org')!.unsubscribed).toEqual(['s1']);
        registry.dropOrg('org2');
        expect(registry.keys()).toEqual(['org/s2']);
        reset('org');
        expect(lives.get('org')!.calls.map((c) => c.spaceId)).toEqual(['s2']);
        reset('org2');
        expect(lives.has('org2')).toBe(false);
    });
});
