import { BUILT_IN_CONNECTION, HARBOR_RUN_CONNECTIONS, type Member } from '@rowboat/spaces-protocol';
import type { Kernel } from './kernel.js';

/**
 * Whether an agent's connector is connected now (local agents, 2026-10-28).
 * An agent whose connector holds its own key (a local agent on its owner's
 * computer, Hermes's plugin, a custom one) is reachable only while that
 * connector holds a live connection, so the roster says which are, and every
 * org member hears when that changes. An agent Harbor runs is always
 * reachable and has no presence, as is Ro. Single-node, in memory, like the hub (spec
 * §12 defers more than one instance).
 */
export class AgentPresence {
  /** Open live connections per agent. */
  private readonly connections = new Map<string, number>();
  /** Offline announcements waiting out the grace, so a reconnect does not flicker. */
  private readonly leaving = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly k: Kernel,
    /** How long an agent may be away before it is announced offline (test knob). */
    private readonly graceMs = 15_000,
  ) {}

  /** Agents (among `members`) whose connector is connected, or reconnecting within the grace. */
  online(members: readonly Member[]): string[] {
    return members.filter((m) => this.hasPresence(m) && this.isOnline(m.id)).map((m) => m.id);
  }

  private isOnline(agentId: string): boolean {
    return (this.connections.get(agentId) ?? 0) > 0 || this.leaving.has(agentId);
  }

  /** A live connection opened for this member. */
  async opened(memberId: string): Promise<void> {
    const count = (this.connections.get(memberId) ?? 0) + 1;
    this.connections.set(memberId, count);
    if (count > 1) return;
    const pending = this.leaving.get(memberId);
    if (pending) {
      // Back within the grace: it was never announced offline.
      clearTimeout(pending);
      this.leaving.delete(memberId);
      return;
    }
    await this.announce(memberId, true);
  }

  /** A live connection for this member closed. */
  closed(memberId: string): void {
    const count = (this.connections.get(memberId) ?? 0) - 1;
    if (count > 0) {
      this.connections.set(memberId, count);
      return;
    }
    this.connections.delete(memberId);
    if (this.leaving.has(memberId)) return;
    const timer = setTimeout(() => {
      this.leaving.delete(memberId);
      if ((this.connections.get(memberId) ?? 0) === 0) void this.announce(memberId, false).catch(() => {});
    }, this.graceMs);
    timer.unref?.();
    this.leaving.set(memberId, timer);
  }

  /** Drop pending announcements (the org is closing). */
  close(): void {
    for (const timer of this.leaving.values()) clearTimeout(timer);
    this.leaving.clear();
  }

  private hasPresence(member: Member | undefined): member is Member {
    const connection = member?.kind === 'agent' ? member.agentConnection : undefined;
    // Ro is Harbor itself, like an agent Harbor runs: always there.
    return connection !== undefined && connection !== BUILT_IN_CONNECTION && !HARBOR_RUN_CONNECTIONS.includes(connection);
  }

  private async announce(memberId: string, online: boolean): Promise<void> {
    // People connect far more than agents: one lookup, and only agents announce.
    const member = await this.k.store.getMember(memberId);
    if (!this.hasPresence(member)) return;
    const frame = { kind: 'agent_presence' as const, agentId: memberId, online, at: this.k.now() };
    for (const recipient of await this.k.store.listAllMembers()) {
      if (!recipient.removedAt && !recipient.deactivatedAt) this.k.hub.publishToMember(recipient.id, frame);
    }
  }
}
