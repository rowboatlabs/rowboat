import type { Member } from '@rowboat/spaces-protocol';
import type { Kernel } from './kernel.js';

// Activity is a per-connection lease, independent of notification preferences (2026-11-05).
// One idle tab cannot hide another active device; an abandoned socket expires too.
export class HumanPresence {
  private readonly sessions = new Map<string, Map<object, number>>();
  private readonly closing = new Map<object, ReturnType<typeof setTimeout>>();
  private readonly announced = new Map<string, boolean>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly k: Kernel, private readonly idleMs = 10 * 60_000, private readonly graceMs = 15_000) {
    this.timer = setInterval(() => {
      for (const id of this.sessions.keys()) void this.refresh(id).catch(() => {});
    }, 15_000);
    this.timer.unref?.();
  }
  online(members: readonly Member[]): string[] {
    return members.filter(member => this.isOnline(member)).map(member => member.id);
  }
  private isOnline(member: Member): boolean {
    return member.kind === 'human' && !member.removedAt && !member.deactivatedAt && !member.availability?.manualAway
      && [...(this.sessions.get(member.id)?.values() ?? [])].some(at => Date.now() - at < this.idleMs);
  }
  async activity(id: string, session: object, active: boolean): Promise<void> {
    const sessions = this.sessions.get(id) ?? new Map<object, number>();
    sessions.set(session, active ? Date.now() : 0);
    this.sessions.set(id, sessions);
    await this.refresh(id);
  }
  async closed(id: string, session: object): Promise<void> {
    const timer = setTimeout(() => {
      this.closing.delete(session);
      this.sessions.get(id)?.delete(session);
      if (!this.sessions.get(id)?.size) this.sessions.delete(id);
      void this.refresh(id).catch(() => {});
    }, this.graceMs);
    timer.unref?.();
    this.closing.set(session, timer);
  }
  async refresh(id: string): Promise<void> {
    const member = await this.k.store.getMember(id);
    if (!member || member.kind !== 'human') return;
    const online = this.isOnline(member);
    if ((this.announced.get(id) ?? false) === online) return;
    this.announced.set(id, online);
    for (const recipient of await this.k.store.listAllMembers()) {
      if (!recipient.removedAt && !recipient.deactivatedAt) this.k.hub.publishToMember(recipient.id, {
        kind: 'member_presence', memberId: id, online, at: this.k.now(),
      });
    }
  }
  close(): void { for (const timer of this.closing.values()) clearTimeout(timer); this.closing.clear(); clearInterval(this.timer); this.sessions.clear(); this.announced.clear(); }
}
