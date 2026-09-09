import type { SessionBusEvent } from '@x/shared/dist/sessions.js';
import type { SpaceAgentActivity, SpacesBusEvent } from '@x/shared/dist/spaces.js';
import type { SpaceMentionOrigin } from '@x/shared/dist/origins.js';
import type { TurnBusEvent } from '@x/shared/dist/turns.js';
import type { PresenceState } from '@rowboat/spaces-protocol';
import { getLive } from './orgs.js';

// "Is my Rowboat working on the mention I made?" — answered from bus events
// alone. This is the ONE spaces-side consumer of the general turn and
// session buses. It keeps a small map of live activity keyed by the origin
// stamped on the events (turns created from, or steered with, a space
// mention; mentions still waiting in a session's pending queue), and from
// that map it:
//
// - tells the room: an agent_working presence lease per busy thread, renewed
//   every 10s, released with agent_idle (viewers prune stale chips themselves);
// - emits its OWN feed: the org's WHOLE activity list on every change, on
//   'spaces:events' next to the live frames. The renderer replaces its copy
//   wholesale (queue-changed's posture — small by nature). The list is also
//   re-emitted on every lease renewal while non-empty, so a window that loads
//   mid-turn catches up within 10s with no snapshot channel.
//
// Nothing here reads sessions or turns, and nothing is looked up at render
// time. The runtime knows nothing of this module: it stamps the origin the
// invoker passed and publishes events, as it does for every consumer.
//
// Turns without a space_mention origin — the user chatting in the thread's
// session, which is user-openable — never appear here: no chip, no lease.

const RENEW_MS = 10_000;

type Presence = (orgId: string, spaceId: string, state: PresenceState, threadRootId: string) => void;
type Emit = (event: SpacesBusEvent) => void;

interface RunningTurn {
  sessionId: string;
  /** Every mention origin the turn has accepted (created + steered), keyed by thread. */
  origins: Map<string, SpaceMentionOrigin>;
}

interface QueuedEntry {
  sessionId: string;
  origin: SpaceMentionOrigin;
}

function threadKey(o: { orgId: string; spaceId: string; threadRootId: string }): string {
  return `${o.orgId}/${o.spaceId}/${o.threadRootId}`;
}

function mentionOrigin(event: unknown): SpaceMentionOrigin | null {
  const origin = (event as { origin?: { kind?: string } }).origin;
  return origin?.kind === 'space_mention' ? (origin as SpaceMentionOrigin) : null;
}

/**
 * The map and the two things derived from it. Pure apart from the injected
 * presence/emit/timer seams (tested); the module-level instance below wires
 * the real ones.
 */
export class SpaceAgentActivityTracker {
  private readonly running = new Map<string, RunningTurn>();
  /** sessionId → the queued mentions in that session (full replace per queue-changed). */
  private readonly queued = new Map<string, QueuedEntry[]>();
  /** Threads currently holding an agent_working lease, by thread key. */
  private readonly leased = new Map<string, { orgId: string; spaceId: string; threadRootId: string }>();
  /** Orgs whose last emitted list was non-empty — so they get one final [] when cleared. */
  private readonly emittedOrgs = new Set<string>();
  private renewTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly presence: Presence,
    private readonly emit: Emit,
    private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setInterval> = (fn, ms) => {
      const t = setInterval(fn, ms);
      t.unref?.();
      return t;
    },
    private readonly clearTimer: (t: ReturnType<typeof setInterval>) => void = clearInterval,
  ) {}

  handleTurnEvent(busEvent: TurnBusEvent): void {
    const event = busEvent.event as { type?: string };
    switch (event.type) {
      case 'turn_created':
      case 'input_added': {
        const origin = mentionOrigin(event);
        if (!origin) return; // the person chatting in the session, or another invoker
        let turn = this.running.get(busEvent.turnId);
        if (!turn) {
          // input_added into a turn we never recorded = a mention steered
          // into the user's own chat turn. It IS now working on the thread.
          turn = { sessionId: busEvent.sessionId ?? '', origins: new Map() };
          this.running.set(busEvent.turnId, turn);
        }
        turn.origins.set(threadKey(origin), origin);
        this.changed();
        return;
      }
      case 'turn_completed':
      case 'turn_failed':
      case 'turn_cancelled': {
        if (this.running.delete(busEvent.turnId)) this.changed();
        return;
      }
      default:
        return;
    }
  }

  handleSessionEvent(event: SessionBusEvent): void {
    if (event.kind !== 'queue-changed') return;
    const entries: QueuedEntry[] = [];
    for (const message of event.queue) {
      const origin = mentionOrigin(message);
      if (origin) entries.push({ sessionId: event.sessionId, origin });
    }
    const had = this.queued.has(event.sessionId);
    if (entries.length === 0) {
      this.queued.delete(event.sessionId);
      if (had) this.changed();
      return;
    }
    this.queued.set(event.sessionId, entries);
    this.changed();
  }

  /** The current list per org — what the feed carries (running wins over queued for a thread). */
  snapshot(): Map<string, SpaceAgentActivity[]> {
    const byThread = new Map<string, { orgId: string; activity: SpaceAgentActivity }>();
    for (const entries of this.queued.values()) {
      for (const { sessionId, origin } of entries) {
        byThread.set(threadKey(origin), {
          orgId: origin.orgId,
          activity: { spaceId: origin.spaceId, threadRootId: origin.threadRootId, state: 'queued', sessionId },
        });
      }
    }
    for (const [turnId, turn] of this.running) {
      for (const origin of turn.origins.values()) {
        byThread.set(threadKey(origin), {
          orgId: origin.orgId,
          activity: {
            spaceId: origin.spaceId,
            threadRootId: origin.threadRootId,
            state: 'running',
            sessionId: turn.sessionId,
            turnId,
          },
        });
      }
    }
    const byOrg = new Map<string, SpaceAgentActivity[]>();
    for (const { orgId, activity } of byThread.values()) {
      byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), activity]);
    }
    return byOrg;
  }

  private changed(): void {
    const byOrg = this.snapshot();
    this.reconcileLeases(byOrg);
    this.emitAll(byOrg);
    this.reconcileTimer(byOrg.size > 0);
  }

  private reconcileLeases(byOrg: Map<string, SpaceAgentActivity[]>): void {
    const live = new Set<string>();
    for (const [orgId, list] of byOrg) {
      for (const a of list) {
        const thread = { orgId, spaceId: a.spaceId, threadRootId: a.threadRootId };
        const key = threadKey(thread);
        live.add(key);
        if (!this.leased.has(key)) {
          this.leased.set(key, thread);
          this.send(orgId, a.spaceId, 'agent_working', a.threadRootId);
        }
      }
    }
    for (const [key, thread] of [...this.leased]) {
      if (live.has(key)) continue;
      this.leased.delete(key);
      // agent_idle, not idle: both frames carry the member's id, and idle
      // would read as the human lease ending.
      this.send(thread.orgId, thread.spaceId, 'agent_idle', thread.threadRootId);
    }
  }

  private emitAll(byOrg: Map<string, SpaceAgentActivity[]>): void {
    for (const [orgId, agentActivity] of byOrg) {
      this.emittedOrgs.add(orgId);
      this.emit({ orgId, agentActivity });
    }
    for (const orgId of [...this.emittedOrgs]) {
      if (byOrg.has(orgId)) continue;
      this.emittedOrgs.delete(orgId);
      this.emit({ orgId, agentActivity: [] });
    }
  }

  private reconcileTimer(active: boolean): void {
    if (active && !this.renewTimer) {
      this.renewTimer = this.setTimer(() => this.renew(), RENEW_MS);
    } else if (!active && this.renewTimer) {
      this.clearTimer(this.renewTimer);
      this.renewTimer = null;
    }
  }

  /** Every 10s while busy: renew each lease and re-emit the lists (late windows catch up). */
  private renew(): void {
    const byOrg = this.snapshot();
    for (const [orgId, list] of byOrg) {
      for (const a of list) this.send(orgId, a.spaceId, 'agent_working', a.threadRootId);
    }
    this.emitAll(byOrg);
  }

  private send(orgId: string, spaceId: string, state: PresenceState, threadRootId: string): void {
    try {
      this.presence(orgId, spaceId, state, threadRootId);
    } catch {
      // org removed mid-run; nothing to signal
    }
  }
}

// --- the process-wide instance ----------------------------------------------

const listeners = new Set<Emit>();

/** The activity feed: hosts relay these onto 'spaces:events' (main → windows, server → WS hub). */
export function onSpaceAgentActivity(listener: Emit): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const tracker = new SpaceAgentActivityTracker(
  (orgId, spaceId, state, threadRootId) => getLive(orgId).presence(spaceId, state, threadRootId),
  (event) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[spaces] agent activity listener failed:', err);
      }
    }
  },
);

let started: Promise<void> | null = null;

/**
 * Subscribe the tracker to the runtime's buses. Idempotent; hosts call it at
 * boot (before any mention can be sent — the first send would otherwise
 * publish its turn_created to nobody). Lazy DI resolution keeps this module
 * off the container's static import graph, like topic-agent.
 */
export function startSpaceAgentActivity(): Promise<void> {
  if (started) return started;
  started = (async () => {
    const { lazyResolve } = await import('../di/lazy-resolve.js');
    const [turnEventBus, sessionBus] = await Promise.all([
      lazyResolve<{ subscribeAll(listener: (event: TurnBusEvent) => void): () => void }>('turnEventBus'),
      lazyResolve<{ subscribe(listener: (event: SessionBusEvent) => void): () => void }>('sessionBus'),
    ]);
    turnEventBus.subscribeAll((event) => tracker.handleTurnEvent(event));
    sessionBus.subscribe((event) => tracker.handleSessionEvent(event));
  })();
  started.catch(() => {
    started = null; // let a later call retry
  });
  return started;
}
