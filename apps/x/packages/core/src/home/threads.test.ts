import { describe, expect, it } from 'vitest';
import { transitionLive, type LiveTurnState } from './threads.js';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';

type SpineEvent = TurnBusEvent['event'];

const TS = '2026-08-13T10:00:00.000Z';

function ev(partial: Record<string, unknown>): SpineEvent {
    return { turnId: 't1', ts: TS, ...partial } as unknown as SpineEvent;
}

const UNDERWAY: LiveTurnState = { status: 'underway', activity: 'thinking', startedAt: TS };

describe('home thread live transitions', () => {
    it('turn_created starts an underway thread with a start time', () => {
        expect(transitionLive(undefined, ev({ type: 'turn_created' }))).toEqual({
            status: 'underway',
            activity: 'starting',
            startedAt: TS,
        });
    });

    it('tool invocations set the activity line without losing the start time', () => {
        const next = transitionLive(UNDERWAY, ev({ type: 'tool_invocation_requested', toolName: 'web-search' }));
        expect(next).toEqual({ status: 'underway', activity: 'web-search', startedAt: TS });
    });

    it('permission required flips to needs-you with the tool named', () => {
        const next = transitionLive(UNDERWAY, ev({ type: 'tool_permission_required', toolName: 'executeCommand' }));
        expect(next).toMatchObject({ status: 'needs-you', attention: 'waiting for your approval: executeCommand' });
    });

    it('a suspended ask-human carries the question as the attention line', () => {
        const next = transitionLive(UNDERWAY, ev({
            type: 'turn_suspended',
            pendingPermissions: [],
            pendingAsyncTools: [{ toolCallId: 'c1', toolId: 'builtin:ask-human', toolName: 'ask-human', input: { question: 'Which repo?' } }],
        }));
        expect(next).toMatchObject({ status: 'needs-you', attention: 'Which repo?' });
    });

    it('resolving a permission returns the thread to underway', () => {
        const needsYou: LiveTurnState = { status: 'needs-you', attention: 'waiting', startedAt: TS };
        const next = transitionLive(needsYou, ev({ type: 'tool_permission_resolved' }));
        expect(next).toMatchObject({ status: 'underway', attention: undefined });
        // ...but a result on an already-underway thread moves nothing.
        expect(transitionLive(UNDERWAY, ev({ type: 'tool_result' }))).toBeNull();
    });

    it('a coding-agent inline approval request needs the user', () => {
        const next = transitionLive(UNDERWAY, ev({ type: 'tool_progress', progress: { kind: 'code-run-permission-request' } }));
        expect(next).toMatchObject({ status: 'needs-you' });
    });

    it('terminal events clear live state; deltas move nothing', () => {
        expect(transitionLive(UNDERWAY, ev({ type: 'turn_completed' }))).toBe('clear');
        expect(transitionLive(UNDERWAY, ev({ type: 'turn_failed' }))).toBe('clear');
        expect(transitionLive(UNDERWAY, ev({ type: 'turn_cancelled' }))).toBe('clear');
        expect(transitionLive(UNDERWAY, ev({ type: 'text_delta', delta: 'x' }))).toBeNull();
    });

    it('needs-you survives model calls and tool starts (a suspension is not erased by parallel work)', () => {
        const needsYou: LiveTurnState = { status: 'needs-you', attention: 'q', startedAt: TS };
        expect(transitionLive(needsYou, ev({ type: 'model_call_requested' }))).toMatchObject({ status: 'needs-you' });
        expect(transitionLive(needsYou, ev({ type: 'tool_invocation_requested', toolName: 'file-readText' }))).toMatchObject({ status: 'needs-you' });
    });
});
