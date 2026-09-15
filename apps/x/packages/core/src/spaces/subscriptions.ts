import type { ServerFrame } from '@rowboat/spaces-protocol';
import type { SpacesLive } from './live.js';

// The host's per-space live subscriptions, one per (org, space), fanned out
// to every window. Kept here, not in each host, because the one thing that
// makes them fragile lives here too: an org's live client can be closed and
// replaced under them (orgs.ts resetRuntime — a re-auth, a changed record),
// and a subscription left on the dead client swallows frames forever while
// the renderer's ref count never asks again. So the registry listens for
// resets and re-subscribes on the fresh client from the last offset it
// relayed — the gap replays, and the pane never knew.

/** The slice of SpacesLive the registry needs — what a test fakes. */
export type LiveSubscriber = Pick<SpacesLive, 'subscribe'>;

export interface SpaceSubscriptionsDeps {
  /** The org's CURRENT live client (a fresh one after a reset); throws for an org that is gone. */
  getLive(orgId: string): LiveSubscriber;
  /** Fires after an org's live client was closed and discarded. */
  onRuntimeReset(listener: (orgId: string) => void): () => void;
}

interface Entry {
  orgId: string;
  spaceId: string;
  live: LiveSubscriber;
  relay: (frame: ServerFrame) => void;
  unsubscribe: () => void;
  /** The resume point: the last event offset relayed, else the head the org acknowledged. */
  lastOffset: number | undefined;
}

function keyOf(orgId: string, spaceId: string): string {
  return `${orgId}/${spaceId}`;
}

export class SpaceSubscriptions {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly deps: SpaceSubscriptionsDeps) {
    deps.onRuntimeReset((orgId) => this.resubscribeOrg(orgId));
  }

  /**
   * Subscribe (org, space) once; a repeat call on the same live client only
   * updates the relay. `afterOffset` asks for replay on the first subscribe;
   * after that the entry tracks its own resume point.
   */
  subscribe(orgId: string, spaceId: string, relay: (frame: ServerFrame) => void, afterOffset?: number): void {
    const live = this.deps.getLive(orgId);
    const cached = this.entries.get(keyOf(orgId, spaceId));
    if (cached && cached.live === live) {
      cached.relay = relay;
      return;
    }
    cached?.unsubscribe();
    this.attach({ orgId, spaceId, live, relay, lastOffset: afterOffset ?? cached?.lastOffset, unsubscribe: () => {} });
  }

  unsubscribe(orgId: string, spaceId: string): void {
    const key = keyOf(orgId, spaceId);
    this.entries.get(key)?.unsubscribe();
    this.entries.delete(key);
  }

  /** Every subscription of one org — on removal, before the registry forgets it. */
  dropOrg(orgId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.orgId !== orgId) continue;
      entry.unsubscribe();
      this.entries.delete(key);
    }
  }

  /** The (org, space) keys held — diagnostics and tests. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  private attach(entry: Entry): void {
    entry.unsubscribe = entry.live.subscribe(
      entry.spaceId,
      (frame) => {
        if (frame.kind === 'event') entry.lastOffset = frame.offset;
        else if (frame.kind === 'subscribed' && entry.lastOffset === undefined) entry.lastOffset = frame.fromOffset;
        entry.relay(frame);
      },
      entry.lastOffset,
    );
    this.entries.set(keyOf(entry.orgId, entry.spaceId), entry);
  }

  private resubscribeOrg(orgId: string): void {
    const mine = [...this.entries.values()].filter((entry) => entry.orgId === orgId);
    // Asking for the client builds one; an org nobody is watching gets none.
    if (mine.length === 0) return;
    let live: LiveSubscriber;
    try {
      live = this.deps.getLive(orgId);
    } catch {
      // The org is gone (removed, or no longer listed for us): nothing to resume on.
      this.dropOrg(orgId);
      return;
    }
    for (const entry of mine) {
      entry.unsubscribe(); // a no-op on the closed client; keeps its handler set tidy
      this.attach({ ...entry, live });
    }
  }
}
