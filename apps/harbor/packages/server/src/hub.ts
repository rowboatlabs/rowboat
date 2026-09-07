import type { ServerFrame } from '@rowboat/spaces-protocol';

/**
 * In-process fan-out for live frames (durable events after they are stored,
 * plus ephemeral presence). Single-node v1 on purpose — when Harbor scales
 * horizontally this becomes a Redis/LISTEN-NOTIFY adapter behind the same two
 * methods (spec §12 defers that).
 */
export class SpaceHub {
  private listeners = new Map<string, Set<(frame: ServerFrame) => void>>();
  /**
   * The second channel (direct messages, 2026-09-07): frames addressed to a
   * MEMBER rather than a space — `space_added`, for the one case where
   * someone else puts you into a space you cannot yet be subscribed to.
   * Every live connection registers under its member id at connect.
   */
  private memberListeners = new Map<string, Set<(frame: ServerFrame) => void>>();

  subscribe(spaceId: string, fn: (frame: ServerFrame) => void): () => void {
    let set = this.listeners.get(spaceId);
    if (!set) {
      set = new Set();
      this.listeners.set(spaceId, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(spaceId);
    };
  }

  publish(spaceId: string, frame: ServerFrame): void {
    for (const fn of this.listeners.get(spaceId) ?? []) {
      try {
        fn(frame);
      } catch {
        // one bad listener never blocks the others
      }
    }
  }

  subscribeMember(memberId: string, fn: (frame: ServerFrame) => void): () => void {
    let set = this.memberListeners.get(memberId);
    if (!set) {
      set = new Set();
      this.memberListeners.set(memberId, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.memberListeners.delete(memberId);
    };
  }

  publishToMember(memberId: string, frame: ServerFrame): void {
    for (const fn of this.memberListeners.get(memberId) ?? []) {
      try {
        fn(frame);
      } catch {
        // one bad listener never blocks the others
      }
    }
  }
}
