import { describe, expect, it } from 'vitest';
import type { SpacesBusEvent } from '@x/shared/dist/spaces.js';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import { SpaceAgentActivityTracker } from './agent-activity.js';

const origin = (threadRootId: string, messageId = 'msg-1') => ({
  kind: 'space_mention' as const,
  orgId: 'org-1',
  spaceId: 'space-1',
  threadRootId,
  messageId,
});

function harness() {
  const presence: string[] = [];
  const emitted: SpacesBusEvent[] = [];
  let tick: (() => void) | null = null;
  const tracker = new SpaceAgentActivityTracker(
    (orgId, spaceId, state, threadRootId) => presence.push(`${state}:${orgId}/${spaceId}/${threadRootId}`),
    (event) => emitted.push(event),
    (fn) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    () => {
      tick = null;
    },
  );
  const turn = (turnId: string, event: Record<string, unknown>, sessionId = 'sess-1'): TurnBusEvent =>
    ({ turnId, sessionId, event }) as unknown as TurnBusEvent;
  const lastList = () => {
    const last = emitted[emitted.length - 1];
    return last && 'agentActivity' in last ? last.agentActivity : undefined;
  };
  return { tracker, presence, emitted, turn, lastList, tick: () => tick?.(), hasTimer: () => tick !== null };
}

describe('SpaceAgentActivityTracker', () => {
  it('tracks a turn created from a mention: running, lease, feed; released on settle', () => {
    const h = harness();
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'turn_created', origin: origin('root-1') }));
    expect(h.lastList()).toEqual([
      { spaceId: 'space-1', threadRootId: 'root-1', state: 'running', sessionId: 'sess-1', turnId: 't1' },
    ]);
    expect(h.presence).toEqual(['agent_working:org-1/space-1/root-1']);
    expect(h.hasTimer()).toBe(true);

    h.tracker.handleTurnEvent(h.turn('t1', { type: 'turn_completed' }));
    expect(h.lastList()).toEqual([]);
    expect(h.presence).toEqual(['agent_working:org-1/space-1/root-1', 'agent_idle:org-1/space-1/root-1']);
    expect(h.hasTimer()).toBe(false);
  });

  it('ignores turns without a mention origin (the person chatting in the session)', () => {
    const h = harness();
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'turn_created', analytics: { useCase: 'copilot_chat' } }));
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'input_added', message: { role: 'user', content: 'hi' } }));
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'turn_completed' }));
    expect(h.emitted).toEqual([]);
    expect(h.presence).toEqual([]);
  });

  it('a mention steered into an untracked turn makes that turn running for the thread', () => {
    const h = harness();
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'turn_created' }));
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'input_added', origin: origin('root-2') }));
    expect(h.lastList()).toEqual([
      { spaceId: 'space-1', threadRootId: 'root-2', state: 'running', sessionId: 'sess-1', turnId: 't1' },
    ]);
    // A second mention in another thread steered into the same turn: both threads busy.
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'input_added', origin: origin('root-3') }));
    expect(h.lastList()?.map((a) => a.threadRootId).sort()).toEqual(['root-2', 'root-3']);
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'turn_failed', error: 'x' }));
    expect(h.lastList()).toEqual([]);
    expect(h.presence.filter((p) => p.startsWith('agent_idle')).sort()).toEqual([
      'agent_idle:org-1/space-1/root-2',
      'agent_idle:org-1/space-1/root-3',
    ]);
  });

  it('shows queued mentions from queue-changed, and running wins over queued for a thread', () => {
    const h = harness();
    h.tracker.handleSessionEvent({
      kind: 'queue-changed',
      sessionId: 'sess-1',
      queue: [
        { queueId: 'q1', message: { role: 'user', content: 'a' }, ts: 't', origin: origin('root-1') },
        { queueId: 'q2', message: { role: 'user', content: 'plain chat' }, ts: 't' },
      ],
    });
    expect(h.lastList()).toEqual([{ spaceId: 'space-1', threadRootId: 'root-1', state: 'queued', sessionId: 'sess-1' }]);
    expect(h.presence).toEqual(['agent_working:org-1/space-1/root-1']);

    // The live turn accepts it (steer): running, and the queue empties.
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'input_added', origin: origin('root-1') }));
    expect(h.lastList()).toEqual([
      { spaceId: 'space-1', threadRootId: 'root-1', state: 'running', sessionId: 'sess-1', turnId: 't1' },
    ]);
    h.tracker.handleSessionEvent({ kind: 'queue-changed', sessionId: 'sess-1', queue: [] });
    expect(h.lastList()?.[0]?.state).toBe('running');
    // No duplicate lease for a thread that stayed busy throughout.
    expect(h.presence).toEqual(['agent_working:org-1/space-1/root-1']);
  });

  it('renews every lease and re-emits the lists on the timer while busy', () => {
    const h = harness();
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'turn_created', origin: origin('root-1') }));
    const before = h.emitted.length;
    h.tick();
    expect(h.presence).toEqual(['agent_working:org-1/space-1/root-1', 'agent_working:org-1/space-1/root-1']);
    expect(h.emitted.length).toBe(before + 1);
    expect(h.lastList()?.[0]?.state).toBe('running');
  });

  it('emits per org, and one final empty list for an org that went quiet', () => {
    const h = harness();
    const other = { ...origin('root-9'), orgId: 'org-2', spaceId: 'space-9' };
    h.tracker.handleTurnEvent(h.turn('t1', { type: 'turn_created', origin: origin('root-1') }));
    h.tracker.handleTurnEvent(h.turn('t2', { type: 'turn_created', origin: other }, 'sess-2'));
    const orgsEmitted = h.emitted.map((e) => e.orgId);
    expect(orgsEmitted).toContain('org-1');
    expect(orgsEmitted).toContain('org-2');
    h.tracker.handleTurnEvent(h.turn('t2', { type: 'turn_cancelled' }));
    const last = h.emitted[h.emitted.length - 1];
    expect(last).toEqual({ orgId: 'org-2', agentActivity: [] });
    // org-1 is still busy and was re-emitted unchanged on that change.
    const org1 = h.emitted.filter((e) => e.orgId === 'org-1');
    const lastOrg1 = org1[org1.length - 1]!;
    expect('agentActivity' in lastOrg1 ? lastOrg1.agentActivity : []).toHaveLength(1);
  });
});
