import type { ActingMode, Attribution, Membership, ServerFrame, Space, SpaceEvent } from '@rowboat/spaces-protocol';
import { AsyncLocalStorage } from 'node:async_hooks';
import { monotonicFactory } from 'ulid';
import { HarborError } from '../errors.js';
import type { SpaceHub } from '../hub.js';
import { canAccessSpace, canWrite, enforce } from '../policy.js';
import type { Store, StoredEvent } from '../store.js';

// The transactional core every aggregate is built on: the store and the hub,
// the org, the space lock with its publish-after-commit outbox, the log append
// and offset allocation, the access gate and the write guard, attribution.
// One instance per org; the aggregates (spaces, assets, feed, read-state) hold
// it as `k` and never reach around it — the invariant that every
// read-decide-write runs inside `locked` lives here and nowhere else.

export interface ActorCtx {
  memberId: string;
}

/** What bindInvite needs from an authenticated identity (auth.ts AuthIdentity satisfies this). */
export interface BindIdentity {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
}

export interface OrgInfo {
  name: string;
  /** host[:port] — the org address links are minted on. Set once the listener knows its port. */
  address: string;
  /**
   * Org policy, v1 (spec §4, amended 2026-08-19): restrict membership to
   * these IdP-verified email domains, checked ONLY at invite bind. Empty or
   * absent = no restriction. Org-side by design — never on the wire.
   */
  allowedEmailDomains?: string[];
}

export class Kernel {

  readonly org: OrgInfo;

  /** Over-limit means read-only, never lockout (spec §4). Flip via the control plane; here a knob for tests. */
  readOnly = false;

  readonly ulid = monotonicFactory();

  constructor(
    readonly store: Store,
    readonly hub: SpaceHub,
    org: OrgInfo,
  ) {
    this.org = org;
  }

  now(): string {
    return new Date().toISOString();
  }

  guardWrite(): void {
    enforce(canWrite(this));
  }

  async requireSpace(spaceId: string): Promise<Space> {
    const space = await this.store.getSpace(spaceId);
    if (!space) throw new HarborError('not_found', `no such space`);
    return space;
  }

  /** The access gate: load the facts, let policy decide — THE rule is policy.ts canAccessSpace. */
  async requireMember(ctx: ActorCtx, spaceId: string): Promise<Space> {
    const space = await this.requireSpace(spaceId);
    const membership = await this.store.getMembership(spaceId, ctx.memberId);
    enforce(canAccessSpace(space, membership));
    return space;
  }

  /**
   * Publish after commit (2026-09-11). Inside the space lock — which on
   * Postgres IS the transaction — a frame must not reach the hub yet: a
   * subscriber arriving in that window would miss the event live (nobody
   * was listening) AND on replay (its catch-up read cannot see the
   * uncommitted row), and a rollback would leave phantoms on every socket.
   * So `append` parks frames in the lock's outbox and `locked` flushes them
   * once the lock — and the commit — has returned. Outside a lock the
   * outbox is empty and frames go straight out.
   */
  private readonly outbox = new AsyncLocalStorage<Array<{ spaceId: string; frame: ServerFrame }>>();

  /** The space lock, with the hub held back until the commit is durable; a thrown lock publishes nothing. */
  async locked<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
    const pending: Array<{ spaceId: string; frame: ServerFrame }> = [];
    const result = await this.store.withSpaceLock(spaceId, () => this.outbox.run(pending, fn));
    for (const { spaceId: target, frame } of pending) this.hub.publish(target, frame);
    return result;
  }

  /**
   * The space lock for a MEMBER'S act (2026-09-22): the access decision the
   * gate ran outside runs again inside the transaction, against the
   * membership as it stands now — so a write that passed the gate and then
   * waited behind a removal is refused instead of landing after the `left`
   * event. Same rule as the gate (policy.ts canAccessSpace), never a second
   * one. Acts that create the membership themselves (createSpace, openDirect,
   * acceptInvite) and operator passes use `locked`.
   */
  async lockedAs<T>(ctx: ActorCtx, spaceId: string, fn: (membership: Membership) => Promise<T>): Promise<T> {
    return this.locked(spaceId, async () => {
      const space = await this.requireSpace(spaceId);
      const membership = await this.store.getMembership(spaceId, ctx.memberId);
      enforce(canAccessSpace(space, membership));
      return fn(membership!);
    });
  }

  /** Append a durable event at `offset` (allocated by the caller inside the space lock) and fan it out after commit. */
  async append(spaceId: string, offset: number, at: string, event: SpaceEvent): Promise<void> {
    const stored: StoredEvent = { offset, at, event };
    await this.store.appendEvent(spaceId, stored);
    const frame: ServerFrame = { kind: 'event', spaceId, offset, at, event };
    const pending = this.outbox.getStore();
    if (pending) pending.push({ spaceId, frame });
    else this.hub.publish(spaceId, frame);
  }

  /** The next offset on the space's log — for a write that needs it before its event exists (message and change-set rows carry it). Inside the space lock only. */
  async nextOffset(spaceId: string): Promise<number> {
    return (await this.store.head(spaceId)) + 1;
  }

  /** Allocate and append in one step, for events nothing else needs the offset of first. Inside the space lock only. */
  async appendNext(spaceId: string, at: string, event: SpaceEvent): Promise<number> {
    const offset = await this.nextOffset(spaceId);
    await this.append(spaceId, offset, at, event);
    return offset;
  }

  /** Who did it and how (core.ts Attribution): the caller, in the mode the request declares, under its display label. */
  attributionOf(ctx: ActorCtx, input: { actingMode: ActingMode; agentName?: string }): Attribution {
    return { memberId: ctx.memberId, actingMode: input.actingMode, ...(input.agentName ? { agentName: input.agentName } : {}) };
  }
}
