import { describe, expect, it, vi } from 'vitest';
import { CodeSessionStatusTracker } from './status-tracker.js';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';

// The tracker projects the shared live-status machine (live-status.ts),
// which also fires on activity events (model calls, tool starts) the
// tracker's consumers never cared about. handle()'s no-op-on-equal check is
// what absorbs those — this test pins it, so a future "simplification"
// that drops the check shows up as duplicate transitions here rather than
// as duplicate notifications in production.

function makeTracker() {
    let deliver: ((event: TurnBusEvent) => void) | null = null;
    const turnEventBus = {
        subscribeAll(listener: (event: TurnBusEvent) => void) {
            deliver = listener;
            return () => { deliver = null; };
        },
    };
    const codeSessionsRepo = {
        list: async () => [{ id: 's1' }],
        get: async () => null, // notify() path — no meta needed for these tests
        save: async () => {},
        remove: async () => {},
    };
    const sessionBus = {
        publish() {},
        subscribe() {
            return () => {};
        },
    };
    const tracker = new CodeSessionStatusTracker({
        // Narrow structural stubs; the tracker only uses these members.
        turnEventBus: turnEventBus as never,
        codeSessionsRepo: codeSessionsRepo as never,
        sessionBus: sessionBus as never,
    });
    const transitions: Array<{ sessionId: string; status: string }> = [];
    tracker.onTransition((sessionId, status) => transitions.push({ sessionId, status }));
    const emit = (event: Record<string, unknown>) => {
        deliver?.({ turnId: 't1', sessionId: 's1', event: { turnId: 't1', ts: '2026-08-18T10:00:00.000Z', ...event } } as unknown as TurnBusEvent);
    };
    // handle() runs on a serialized promise chain whose notify() step can
    // stall on a slow first dynamic import — wait for the expected shape,
    // then a settle beat to catch anything spurious behind it.
    const settle = async (expected: number) => {
        await vi.waitFor(() => expect(transitions.length).toBeGreaterThanOrEqual(expected), { timeout: 5000 });
        await new Promise((resolve) => setTimeout(resolve, 30));
    };
    return { tracker, transitions, emit, settle };
}

describe('CodeSessionStatusTracker projection', () => {
    it('absorbs activity events via no-op-on-equal: one working transition, not one per model call', async () => {
        const { tracker, transitions, emit, settle } = makeTracker();
        await tracker.start();
        emit({ type: 'turn_created' });
        emit({ type: 'model_call_requested' });
        emit({ type: 'tool_invocation_requested', toolCallId: 'c1', toolId: 'builtin:x', toolName: 'file-readText', execution: 'sync', input: {} });
        emit({ type: 'model_call_requested' });
        await settle(1);
        expect(transitions).toEqual([{ sessionId: 's1', status: 'working' }]);
        tracker.stop();
    });

    it('projects the shared machine: suspend → needs-you, answered ask-human (tool_result) → working, terminal → idle', async () => {
        const { tracker, transitions, emit, settle } = makeTracker();
        await tracker.start();
        emit({ type: 'turn_created' });
        emit({ type: 'turn_suspended', pendingPermissions: [], pendingAsyncTools: [{ toolCallId: 'c1', toolId: 'builtin:ask-human', toolName: 'ask-human', input: { question: 'x?' } }], usage: {} });
        emit({ type: 'tool_result', toolCallId: 'c1', toolName: 'ask-human', source: 'async', result: { output: 'y', isError: false } });
        emit({ type: 'turn_completed', output: [], usage: {} });
        await settle(4);
        expect(transitions.map((t) => t.status)).toEqual(['working', 'needs-you', 'working', 'idle']);
        tracker.stop();
    });
});
