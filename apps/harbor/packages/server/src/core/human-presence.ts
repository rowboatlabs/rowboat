import type { Member } from '@rowboat/spaces-protocol';
import type { Kernel } from './kernel.js';

type Lease = { expiresAt: number; timer: ReturnType<typeof setTimeout> };
type Connection = { memberId: string; sessions: Map<string, Lease> };

// Focused Spaces windows, not background sockets (2026-11-04, correction to #1309).
// Leases bound stale status when a renderer crashes or a device sleeps without sending blur.
export class HumanPresence {
  private readonly connections = new Map<object, Connection>();
  private readonly announced = new Set<string>();

  constructor(private readonly k: Kernel, private readonly leaseMs = 45_000) {}

  opened(connection: object, memberId: string): void {
    this.connections.set(connection, { memberId, sessions: new Map() });
  }

  online(members: readonly Member[]): string[] {
    return members.filter(m => m.kind === 'human' && !m.removedAt && !m.deactivatedAt && this.isOnline(m.id)).map(m => m.id);
  }

  activity(connection: object, sessionId: string, active: boolean): void {
    const state = this.connections.get(connection);
    if (!state) return;
    const old = state.sessions.get(sessionId);
    if (old) clearTimeout(old.timer);
    state.sessions.delete(sessionId);
    if (active) {
      // Bound per-socket state even if a peer invents session ids (2026-11-04).
      if (state.sessions.size >= 32) return;
      const timer = setTimeout(() => {
        state.sessions.delete(sessionId);
        void this.announce(state.memberId).catch(() => {});
      }, this.leaseMs);
      timer.unref?.();
      state.sessions.set(sessionId, { expiresAt: Date.now() + this.leaseMs, timer });
    }
    void this.announce(state.memberId).catch(() => {});
  }

  closed(connection: object): void {
    const state = this.connections.get(connection);
    if (!state) return;
    for (const lease of state.sessions.values()) clearTimeout(lease.timer);
    this.connections.delete(connection);
    void this.announce(state.memberId).catch(() => {});
  }

  close(): void {
    for (const state of this.connections.values()) {
      for (const lease of state.sessions.values()) clearTimeout(lease.timer);
    }
    this.connections.clear();
    this.announced.clear();
  }

  private isOnline(memberId: string): boolean {
    const now = Date.now();
    return [...this.connections.values()].some(c => c.memberId === memberId && [...c.sessions.values()].some(l => l.expiresAt > now));
  }

  private async announce(memberId: string): Promise<void> {
    if (this.announced.has(memberId) === this.isOnline(memberId)) return;
    const members = await this.k.store.listAllMembers();
    const member = members.find(m => m.id === memberId);
    if (!member || member.kind !== 'human' || member.removedAt || member.deactivatedAt) return;
    // Read after the await: rapid focus/blur and overlapping windows must publish the latest state.
    const online = this.isOnline(memberId);
    if (this.announced.has(memberId) === online) return;
    if (online) this.announced.add(memberId);
    else this.announced.delete(memberId);
    const frame = { kind: 'member_presence' as const, memberId, online, at: this.k.now() };
    for (const recipient of members) {
      if (!recipient.removedAt && !recipient.deactivatedAt) this.k.hub.publishToMember(recipient.id, frame);
    }
  }
}
