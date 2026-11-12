import { describe, expect, it } from 'vitest';
import type { Invocation, Member, Membership, Message, Space } from '@rowboat/spaces-protocol';
import { HarborError } from '../src/errors.js';
import {
  AGENT_HOP_LIMIT,
  canReachMember,
  canSignIn,
  canCancelQueuedInvocation,
  canStopInvocation,
  invocationRefusal,
  canAccessSpace,
  isAdmin,
  canArchiveSpace,
  canDeleteSpace,
  canRemoveFromSpace,
  canSetRole,
  canAddAgent,
  canAddToSpace,
  canMessageAgent,
  canSetAgentAccess,
  seatOf,
  canHandSecrets,
  canReadSecret,
  canCreateAgentKey,
  canRenameAgent,
  canRevokeAgentKey,
  canDeleteAgent,
  canSetAgentHook,
  canSetSuperAgent,
  canSuperAgentCreate,
  canSuperAgentDelete,
  canDecideSuperAgentRequest,
  canSetAgentProfile,
  canClearAgentHook,
  canChangeMembership,
  canEditProfile,
  canRenameSpace,
  canWrite,
  canWriteSpace,
  enforce,
  isAuthor,
} from '../src/policy.js';

// The rules, without a store: policy.ts is pure over loaded facts, so every
// "who may do what" answer is pinned here and the service tests only have to
// prove the service ASKS.

const NOW = '2026-09-21T10:00:00.000Z';
const shared: Space = { id: 'S', name: 'Roadboard', createdAt: NOW, kind: 'shared', archived: false };
const direct: Space = { id: 'D', name: 'Direct message', createdAt: NOW, kind: 'direct', participants: ['a', 'b'], archived: false };
const membership: Membership = { spaceId: 'S', memberId: 'a', joinedAt: NOW, role: 'member' };
const adminRow: Membership = { ...membership, role: 'admin' };
const person = (id: string): Member => ({ id, displayName: id, kind: 'human' });
const byA = { author: { memberId: 'a', actingMode: 'direct' } } as Message;

describe('policy', () => {
  it('enforce throws the refusal as a HarborError and passes null through', () => {
    expect(() => enforce(null)).not.toThrow();
    expect(() => enforce({ code: 'forbidden', message: 'no' })).toThrow(HarborError);
    try {
      enforce({ code: 'read_only_limit', message: 'paused' });
    } catch (err) {
      expect(err).toMatchObject({ code: 'read_only_limit', status: 403, message: 'paused' });
    }
  });

  it('canAccessSpace: a membership row, nothing else — DMs included; the admin bit is on the row (2026-11-09)', () => {
    expect(canAccessSpace(shared, membership)).toBeNull();
    expect(canAccessSpace(direct, { ...membership, spaceId: 'D' })).toBeNull();
    expect(canAccessSpace(shared, undefined)).toMatchObject({ code: 'forbidden' });
    expect(canAccessSpace(direct, undefined)).toMatchObject({ code: 'forbidden' });
    expect(isAdmin(adminRow)).toBe(true);
    expect(isAdmin(membership)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it('archive, unarchive and delete: an admin of the space; a DM never (2026-10-13/14; the row’s bit since 2026-11-09)', () => {
    expect(canArchiveSpace(adminRow, shared, 'archive')).toBeNull();
    expect(canArchiveSpace(adminRow, shared, 'unarchive')).toBeNull();
    expect(canArchiveSpace(membership, shared, 'archive')).toMatchObject({ code: 'forbidden' });
    expect(canArchiveSpace(membership, shared, 'unarchive')).toMatchObject({ code: 'forbidden' });
    expect(canArchiveSpace(adminRow, direct, 'archive')).toMatchObject({ code: 'invalid_request' });
    expect(canDeleteSpace(adminRow, shared)).toBeNull();
    expect(canDeleteSpace(adminRow, { ...shared, archived: true })).toBeNull();
    expect(canDeleteSpace(membership, shared)).toMatchObject({ code: 'forbidden' });
    expect(canDeleteSpace(adminRow, direct)).toMatchObject({ code: 'invalid_request' });
    expect(canWriteSpace(shared)).toBeNull();
    expect(canWriteSpace({ ...shared, archived: true })).toMatchObject({ code: 'forbidden' });
    const deleted: Member = { id: 'agent', displayName: 'Deleted', kind: 'agent', ownerId: 'a', deactivatedAt: NOW };
    expect(canWriteSpace(direct, [person('a'), deleted])).toMatchObject({ code: 'forbidden' });
    expect(canWriteSpace(shared, [deleted])).toBeNull();
    expect(canWriteSpace(direct, [{ ...deleted, deactivatedAt: undefined }])).toBeNull();
    expect(canCreateAgentKey(person('a'), deleted)).toMatchObject({ code: 'invalid_request' });
  });

  it('membership acts are a space admin’s, never on a DM (2026-10-19; per space since 2026-11-09)', () => {
    const member = person('m');
    const agent: Member = { id: 'g', displayName: 'G', kind: 'agent', ownerId: 'm' };
    const row = (memberId: string, role: Membership['role'] = 'member'): Membership => ({ spaceId: 'S', memberId, joinedAt: NOW, role });

    expect(canRemoveFromSpace(adminRow, shared, 'm')).toBeNull();
    expect(canRemoveFromSpace(membership, shared, 'a')).toMatchObject({ code: 'forbidden' });
    expect(canRemoveFromSpace(adminRow, shared, 'a')).toMatchObject({ code: 'invalid_request' });
    expect(canRemoveFromSpace(adminRow, direct, 'm')).toMatchObject({ code: 'invalid_request' });
    expect(canRemoveFromSpace(undefined, shared, 'm')).toMatchObject({ code: 'forbidden' });

    expect(canSetRole(adminRow, shared, member, row('m'), 'admin')).toBeNull();
    expect(canSetRole(adminRow, shared, person('a'), adminRow, 'member')).toBeNull(); // the only-admin count is the store's
    expect(canSetRole(membership, shared, member, row('m'), 'admin')).toMatchObject({ code: 'forbidden' });
    expect(canSetRole(adminRow, shared, agent, row('g'), 'admin')).toMatchObject({ code: 'invalid_request' });
    expect(canSetRole(adminRow, shared, member, undefined, 'admin')).toMatchObject({ code: 'invalid_request' });
    expect(canSetRole(adminRow, shared, { ...member, removedAt: 'x' }, row('m'), 'admin')).toMatchObject({ code: 'invalid_request' });
    expect(canSetRole(adminRow, direct, member, row('m'), 'admin')).toMatchObject({ code: 'invalid_request' });

    expect(canSignIn({ ...member, removedAt: 'x' })).toMatchObject({ code: 'not_a_member' });
    expect(canReachMember({ ...member, removedAt: 'x' })).toMatchObject({ code: 'invalid_request' });
  });

  it('canWrite: a read-only server refuses writes with read_only_limit', () => {
    expect(canWrite({ readOnly: false })).toBeNull();
    expect(canWrite({ readOnly: true })).toMatchObject({ code: 'read_only_limit' });
  });

  it('canChangeMembership / canRenameSpace: shared spaces allow, direct spaces refuse with a reason', () => {
    expect(canChangeMembership(shared, 'invite')).toBeNull();
    expect(canChangeMembership(shared, 'add')).toBeNull();
    expect(canChangeMembership(shared, 'leave')).toBeNull();
    expect(canRenameSpace(shared)).toBeNull();
    expect(canChangeMembership(direct, 'invite')).toMatchObject({ code: 'invalid_request', message: /nobody can be invited/ });
    expect(canChangeMembership(direct, 'add')).toMatchObject({ code: 'invalid_request', message: /nobody can be added/ });
    expect(canChangeMembership(direct, 'leave')).toMatchObject({ code: 'invalid_request', message: /cannot be left/ });
    expect(canRenameSpace(direct)).toMatchObject({ code: 'invalid_request', message: /cannot be renamed/ });
  });

  it('isAuthor: the member id decides, never the acting mode', () => {
    expect(isAuthor({ memberId: 'a' }, byA, 'edit a message')).toBeNull();
    expect(isAuthor({ memberId: 'a' }, { author: { memberId: 'a', actingMode: 'agent', agentName: 'Claude' } } as Message, 'end a poll')).toBeNull();
    expect(isAuthor({ memberId: 'b' }, byA, 'delete a message')).toEqual({
      code: 'forbidden',
      message: 'only the author can delete a message',
    });
  });

  it('agents: any person adds one; the owner alone creates, revokes and configures — nothing stands above the owner (2026-11-09)', () => {
    const owner = person('harsh');
    const admin = person('ramnique');
    const other = person('gagan');
    const hermes: Member = { id: 'hermes', displayName: 'Hermes', kind: 'agent', ownerId: 'harsh' };
    const replicas: Member = { id: 'replicas', displayName: 'Replicas', kind: 'agent' };
    expect(canAddAgent(other)).toBeNull();
    expect(canAddAgent(hermes)).toMatchObject({ code: 'forbidden' });
    expect(canCreateAgentKey(owner, hermes)).toBeNull();
    expect(canCreateAgentKey(admin, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canCreateAgentKey(other, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canCreateAgentKey(admin, replicas)).toMatchObject({ code: 'forbidden' });
    expect(canRenameAgent(owner, hermes)).toBeNull();
    expect(canRenameAgent(admin, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canRenameAgent(other, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canRenameAgent(owner, owner)).toMatchObject({ code: 'forbidden' });
    // Its description and personality (2026-10-29): the owner's, as its name is.
    expect(canSetAgentProfile(owner, hermes)).toBeNull();
    expect(canSetAgentProfile(admin, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canSetAgentProfile(other, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canRevokeAgentKey(owner, hermes)).toBeNull();
    expect(canRevokeAgentKey(admin, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canRevokeAgentKey(other, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canDeleteAgent(owner, hermes)).toBeNull();
    expect(canDeleteAgent(admin, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canDeleteAgent(other, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canSetAgentHook(owner, hermes)).toBeNull();
    expect(canSetAgentHook(admin, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canClearAgentHook(admin, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canClearAgentHook(other, hermes)).toMatchObject({ code: 'forbidden' });
  });

  it('super agents (2026-11-02; the owner’s switch since 2026-11-09): the owner grants it; it creates for its owner, deletes only its own, and its owner decides', () => {
    const owner = person('harsh');
    const other = person('ramnique');
    const hermes: Member = { id: 'hermes', displayName: 'Hermes', kind: 'agent', ownerId: 'harsh' };
    const ro: Member = { id: 'ro', displayName: 'Ro', kind: 'agent' };
    const boss: Member = { ...hermes, superAgent: { askBeforeCreate: true, askBeforeDelete: true } };
    const deleter: Member = { ...hermes, superAgent: { askBeforeCreate: false, askBeforeDelete: false } };
    expect(canSetSuperAgent(owner, hermes)).toBeNull();
    expect(canSetSuperAgent(other, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canSetSuperAgent(owner, ro)).toMatchObject({ code: 'invalid_request' });
    expect(canSetSuperAgent(owner, owner)).toMatchObject({ code: 'invalid_request' });
    expect(canSuperAgentCreate(hermes)).toMatchObject({ code: 'forbidden' });
    expect(canSuperAgentCreate(boss)).toBeNull();
    expect(canSuperAgentCreate({ ...ro, superAgent: { askBeforeCreate: false, askBeforeDelete: false } })).toMatchObject({ code: 'forbidden' });
    expect(canSuperAgentDelete(hermes, 'hermes')).toMatchObject({ code: 'forbidden' });
    expect(canSuperAgentDelete(deleter, 'hermes')).toBeNull();
    expect(canSuperAgentDelete(deleter, 'someone-else')).toMatchObject({ code: 'forbidden' });
    expect(canSuperAgentDelete(deleter, undefined)).toMatchObject({ code: 'forbidden' });
    expect(canDecideSuperAgentRequest(owner, boss)).toBeNull();
    expect(canDecideSuperAgentRequest(other, boss)).toMatchObject({ code: 'forbidden' });
  });

  it('invocations: a shared space to invoke, the hop limit, the invoker cancels, invoker or admin stops when the connector can', () => {
    const helper: Member = { id: 'helper', displayName: 'Helper', kind: 'agent', ownerId: 'harsh' };
    const byHarsh = { agent: helper, authorId: 'harsh', seat: 'members' as const };
    expect(invocationRefusal(true, 0, byHarsh)).toBeNull();
    expect(invocationRefusal(true, AGENT_HOP_LIMIT, byHarsh)).toBeNull();
    expect(invocationRefusal(true, AGENT_HOP_LIMIT + 1, byHarsh)).toMatchObject({ reason: 'hop_limit' });
    expect(invocationRefusal(false, 0, byHarsh)).toMatchObject({ reason: 'not_permitted' });
    // A seat for everyone answers anyone; an owner-only seat its owner alone (2026-11-09).
    expect(invocationRefusal(true, 0, { agent: helper, authorId: 'gagan', seat: 'members' })).toBeNull();
    expect(invocationRefusal(true, 0, { agent: helper, authorId: 'harsh', seat: 'owner' })).toBeNull();
    expect(invocationRefusal(true, 0, { agent: helper, authorId: 'gagan', seat: 'owner' })).toMatchObject({ reason: 'not_permitted', message: expect.stringContaining('only its owner here') });
    expect(invocationRefusal(true, 1, { agent: helper, authorId: 'other-agent', seat: 'owner' })).toMatchObject({ reason: 'not_permitted' });
    const inv = { trigger: { authorId: 'harsh' } } as Invocation;
    expect(canCancelQueuedInvocation({ memberId: 'harsh' }, inv)).toBeNull();
    expect(canCancelQueuedInvocation({ memberId: 'gagan' }, inv)).toMatchObject({ code: 'forbidden' });
    const row = (memberId: string, role: Membership['role'] = 'member'): Membership => ({ spaceId: 'S', memberId, joinedAt: NOW, role });
    expect(canStopInvocation(row('harsh'), inv, true)).toBeNull();
    expect(canStopInvocation(row('ramnique', 'admin'), inv, true)).toBeNull();
    expect(canStopInvocation(row('gagan'), inv, true)).toMatchObject({ code: 'forbidden' });
    expect(canStopInvocation(undefined, inv, true)).toMatchObject({ code: 'forbidden' });
    expect(canStopInvocation(row('harsh'), inv, false)).toMatchObject({ code: 'invalid_request' });
  });
});

describe('deleted accounts (2026-10-13)', () => {
  const active: Member = { id: 'm1', displayName: 'Ada', kind: 'human' };
  const deleted: Member = { ...active, deactivatedAt: '2026-10-13T00:00:00.000Z' };

  it('refuses a deactivated member as a sign-in', () => {
    expect(canSignIn(active)).toBeNull();
    expect(canSignIn(deleted)?.code).toBe('not_a_member');
  });

  it('refuses adding, or opening a DM with, a deactivated member', () => {
    expect(canReachMember(active)).toBeNull();
    expect(canReachMember(deleted)).toEqual({ code: 'invalid_request', message: 'Ada has deleted their account' });
  });
});

describe('profiles (2026-10-19)', () => {
  it('a person edits their own profile; an agent member may not rename itself', () => {
    expect(canEditProfile({ id: 'm1', displayName: 'Ada', kind: 'human' })).toBeNull();
    expect(canEditProfile({ id: 'a1', displayName: 'Bot', kind: 'agent', ownerId: 'm1' })).toMatchObject({ code: 'forbidden' });
  });
});

describe('an agent’s seat (2026-11-09)', () => {
  const gagan: Member = { id: 'gagan', displayName: 'Gagan', kind: 'human' };
  const harsh: Member = { id: 'harsh', displayName: 'Harsh', kind: 'human' };
  const scout: Member = { id: 'scout', displayName: 'Scout', kind: 'agent', ownerId: 'harsh' };
  const local: Member = { ...scout, id: 'laptop', agentKind: 'claude-code', agentConnection: 'local' };
  const boss: Member = { ...scout, id: 'boss', superAgent: { askBeforeCreate: true, askBeforeDelete: true } };
  const row = (memberId: string, invocableBy?: 'owner' | 'members'): Membership => ({ spaceId: 'S', memberId, joinedAt: NOW, role: 'member', ...(invocableBy ? { invocableBy } : {}) });
  it('only the owner adds an agent to a space, or a super agent of the same owner; people are anyone’s to add', () => {
    expect(canAddToSpace(harsh, scout)).toBeNull();
    expect(canAddToSpace(gagan, scout)).toMatchObject({ code: 'forbidden', message: expect.stringContaining('only its owner can add') });
    expect(canAddToSpace(boss, scout)).toBeNull();
    expect(canAddToSpace(gagan, harsh)).toBeNull();
  });
  it('only the owner messages their agent', () => {
    expect(canMessageAgent('harsh', scout)).toBeNull();
    expect(canMessageAgent('gagan', scout)).toMatchObject({ code: 'forbidden', message: expect.stringContaining('only its owner can message it') });
    expect(canMessageAgent('gagan', harsh)).toBeNull();
  });
  it('the seat: the owner sets it for an agent in the space; a local agent stays owner-only; absent reads as everyone', () => {
    expect(seatOf(row('scout'))).toBe('members');
    expect(seatOf(row('scout', 'owner'))).toBe('owner');
    expect(seatOf(undefined)).toBe('members');
    expect(canSetAgentAccess(harsh, scout, row('scout'), 'owner')).toBeNull();
    expect(canSetAgentAccess(gagan, scout, row('scout'), 'owner')).toMatchObject({ code: 'forbidden' });
    expect(canSetAgentAccess(harsh, scout, undefined, 'owner')).toMatchObject({ code: 'invalid_request' });
    expect(canSetAgentAccess(harsh, local, row('laptop', 'owner'), 'members')).toMatchObject({ code: 'invalid_request', message: expect.stringContaining('owner’s computer') });
    expect(canSetAgentAccess(harsh, harsh, row('harsh'), 'owner')).toMatchObject({ code: 'invalid_request' });
  });
});

describe('secrets in a message (2026-11-04)', () => {
  const harsh: Member = { id: 'harsh', displayName: 'Harsh', kind: 'human' };
  const scout: Member = { id: 'scout', displayName: 'Scout', kind: 'agent', ownerId: 'harsh' };
  const everyone = (member: Member) => ({ member, seat: 'members' as const });
  const ownerOnly = (member: Member) => ({ member, seat: 'owner' as const });
  it('goes to the members the message mentions, people and agents; an owner-only agent only from its owner', () => {
    expect(canHandSecrets('gagan', [everyone(harsh), everyone(scout)])).toBeNull();
    expect(canHandSecrets('gagan', [])).toMatchObject({ code: 'invalid_request', message: expect.stringContaining('mention who should read') });
    expect(canHandSecrets('gagan', [everyone(scout), ownerOnly({ ...scout, id: 'mine' })])).toMatchObject({ code: 'forbidden' });
    expect(canHandSecrets('harsh', [ownerOnly({ ...scout, id: 'mine' })])).toBeNull();
  });
  it('is read by its readers alone, an admin and its author included', () => {
    const secrets = { names: ['KEY'], readers: ['scout', 'harsh'] };
    expect(canReadSecret('scout', secrets, 'KEY')).toBeNull();
    expect(canReadSecret('harsh', secrets, 'KEY')).toBeNull();
    expect(canReadSecret('gagan', secrets, 'KEY')).toMatchObject({ code: 'not_found' });
    expect(canReadSecret('scout', secrets, 'OTHER')).toMatchObject({ code: 'not_found' });
    expect(canReadSecret('scout', undefined, 'KEY')).toMatchObject({ code: 'not_found' });
  });
});
