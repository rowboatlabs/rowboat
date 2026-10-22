import { describe, expect, it } from 'vitest';
import type { Invocation, Member, Membership, Message, Space } from '@rowboat/spaces-protocol';
import { HarborError } from '../src/errors.js';
import {
  AGENT_HOP_LIMIT,
  canReachMember,
  canSignIn,
  agentsManagedBy,
  canCancelQueuedInvocation,
  canStopInvocation,
  invocationRefusal,
  canAccessSpace,
  canArchiveSpace,
  canDeleteSpace,
  canRemoveFromSpace,
  canRemoveFromOrg,
  canSetRole,
  canSetSpaceVisibility,
  canSetOrgSettings,
  canInvite,
  canOpenDirect,
  isGroupChat,
  canAddAgent,
  canCreateAgentKey,
  canRenameAgent,
  canRevokeAgentKey,
  canSetAgentHook,
  canClearAgentHook,
  canReadSpace,
  canJoinSpace,
  canBind,
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
const shared: Space = { id: 'S', name: 'Roadboard', createdAt: NOW, kind: 'shared', visibility: 'private', archived: false, isDefault: false };
const direct: Space = { id: 'D', name: 'Direct message', createdAt: NOW, kind: 'direct', visibility: 'private', participants: ['a', 'b'], archived: false, isDefault: false };
const membership: Membership = { spaceId: 'S', memberId: 'a', joinedAt: NOW };
const byA = { author: { memberId: 'a', actingMode: 'direct' } } as Message;

describe('policy', () => {
  it('a group chat is one shared space and no DMs; DMs are off in it (2026-10-07)', () => {
    expect(isGroupChat({ shared: 1, direct: 0 })).toBe(true);
    expect(isGroupChat({ shared: 2, direct: 0 })).toBe(false);
    // An org already talking in DMs stays a workspace: the rule never hides what exists.
    expect(isGroupChat({ shared: 1, direct: 1 })).toBe(false);
    expect(isGroupChat({ shared: 0, direct: 0 })).toBe(false);
    expect(canOpenDirect(false)).toBeNull();
    expect(canOpenDirect(true)).toMatchObject({ code: 'forbidden' });
  });
  it('enforce throws the refusal as a HarborError and passes null through', () => {
    expect(() => enforce(null)).not.toThrow();
    expect(() => enforce({ code: 'forbidden', message: 'no' })).toThrow(HarborError);
    try {
      enforce({ code: 'read_only_limit', message: 'paused' });
    } catch (err) {
      expect(err).toMatchObject({ code: 'read_only_limit', status: 403, message: 'paused' });
    }
  });

  it('canAccessSpace: a membership row, nothing else — DMs included', () => {
    expect(canAccessSpace(shared, membership)).toBeNull();
    expect(canAccessSpace(direct, { ...membership, spaceId: 'D' })).toBeNull();
    expect(canAccessSpace(shared, undefined)).toMatchObject({ code: 'forbidden' });
    expect(canAccessSpace(direct, undefined)).toMatchObject({ code: 'forbidden' });
  });

  it('open-space reads require org membership; acting still requires space membership', () => {
    const open: Space = { ...shared, visibility: 'open' };
    expect(canReadSpace(open, undefined, true)).toBeNull();
    expect(canReadSpace(open, undefined, false)).toMatchObject({ code: 'forbidden' });
    expect(canReadSpace(shared, undefined, true)).toMatchObject({ code: 'forbidden' });
    expect(canReadSpace({ ...direct, visibility: 'open' }, undefined, true)).toMatchObject({ code: 'forbidden' });
    expect(canReadSpace(shared, membership, true)).toBeNull();
    expect(canAccessSpace(open, undefined)).toEqual({ code: 'forbidden', message: 'join this space to post' });
    expect(canAccessSpace(open, membership)).toBeNull();
    expect(canJoinSpace(open)).toBeNull();
    expect(canJoinSpace(shared)).toMatchObject({ code: 'forbidden' });
    expect(canJoinSpace({ ...direct, visibility: 'open' })).toMatchObject({ code: 'forbidden' });
  });

  it('archive, unarchive and delete: an admin on a shared space; a DM never (2026-10-13/14)', () => {
    const admin = { role: 'admin' } as Member;
    const member = { role: 'member' } as Member;
    expect(canArchiveSpace(admin, shared, 'archive')).toBeNull();
    expect(canArchiveSpace(admin, shared, 'unarchive')).toBeNull();
    expect(canArchiveSpace(member, shared, 'archive')).toMatchObject({ code: 'forbidden' });
    expect(canArchiveSpace(member, shared, 'unarchive')).toMatchObject({ code: 'forbidden' });
    expect(canArchiveSpace(admin, direct, 'archive')).toMatchObject({ code: 'invalid_request' });
    expect(canDeleteSpace(admin, shared)).toBeNull();
    expect(canDeleteSpace(admin, { ...shared, archived: true })).toBeNull();
    expect(canDeleteSpace(member, shared)).toMatchObject({ code: 'forbidden' });
    expect(canDeleteSpace(admin, direct)).toMatchObject({ code: 'invalid_request' });
    expect(canWriteSpace(shared)).toBeNull();
    expect(canWriteSpace({ ...shared, archived: true })).toMatchObject({ code: 'forbidden' });
  });

  it('admin controls: membership and policy acts are an admin’s, never on a DM (2026-10-19)', () => {
    const admin = { id: 'a', role: 'admin', kind: 'human', displayName: 'A' } as Member;
    const member = { id: 'm', role: 'member', kind: 'human', displayName: 'M' } as Member;
    const agent = { id: 'g', role: 'member', kind: 'agent', displayName: 'G' } as Member;
    const jev = { ...agent, agentConnection: 'builtin' } as Member;

    expect(canRemoveFromSpace(admin, shared, 'm')).toBeNull();
    expect(canRemoveFromSpace(member, shared, 'a')).toMatchObject({ code: 'forbidden' });
    expect(canRemoveFromSpace(admin, shared, 'a')).toMatchObject({ code: 'invalid_request' });
    expect(canRemoveFromSpace(admin, direct, 'm')).toMatchObject({ code: 'invalid_request' });

    expect(canSetSpaceVisibility(admin, shared)).toBeNull();
    expect(canSetSpaceVisibility(member, shared)).toMatchObject({ code: 'forbidden' });
    expect(canSetSpaceVisibility(admin, direct)).toMatchObject({ code: 'invalid_request' });

    expect(canRemoveFromOrg(admin, member)).toBeNull();
    expect(canRemoveFromOrg(admin, agent)).toBeNull();
    expect(canRemoveFromOrg(member, agent)).toMatchObject({ code: 'forbidden' });
    expect(canRemoveFromOrg(admin, admin)).toMatchObject({ code: 'invalid_request' });
    expect(canRemoveFromOrg(admin, jev)).toMatchObject({ code: 'invalid_request' });

    expect(canSetRole(admin, member, 'admin')).toBeNull();
    expect(canSetRole(admin, admin, 'member')).toBeNull(); // the last-admin count is the store's
    expect(canSetRole(member, member, 'admin')).toMatchObject({ code: 'forbidden' });
    expect(canSetRole(admin, agent, 'admin')).toMatchObject({ code: 'invalid_request' });
    expect(canSetRole(admin, { ...member, removedAt: 'x' }, 'admin')).toMatchObject({ code: 'invalid_request' });

    expect(canSetOrgSettings(admin)).toBeNull();
    expect(canSetOrgSettings(member)).toMatchObject({ code: 'forbidden' });
    expect(canInvite(member, 'members')).toBeNull();
    expect(canInvite(member, 'admins')).toMatchObject({ code: 'forbidden' });
    expect(canInvite(admin, 'admins')).toBeNull();

    expect(canSignIn({ ...member, removedAt: 'x' })).toMatchObject({ code: 'not_a_member' });
    expect(canReachMember({ ...member, removedAt: 'x' })).toMatchObject({ code: 'invalid_request' });
  });

  it('canWrite: read-only orgs refuse writes with read_only_limit', () => {
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

  it('canBind: no domain rule admits anyone; a rule matches the email domain case-insensitively', () => {
    expect(canBind({ email: 'x@else.com' }, {})).toBeNull();
    expect(canBind({}, { allowedEmailDomains: [] })).toBeNull();
    expect(canBind({ email: 'Harsh@Rowboatlabs.com' }, { allowedEmailDomains: ['rowboatlabs.com'] })).toBeNull();
    expect(canBind({ email: 'x@else.com' }, { allowedEmailDomains: ['rowboatlabs.com', 'acme.io'] })).toEqual({
      code: 'policy_refused',
      message: 'this org admits only @rowboatlabs.com, @acme.io accounts',
    });
    expect(canBind({}, { allowedEmailDomains: ['rowboatlabs.com'] })).toMatchObject({ code: 'policy_refused' });
  });

  it('agents: any person adds one; the owner alone creates keys; the owner or an admin revokes', () => {
    const person = (id: string, role: Member['role'] = 'member'): Member => ({ id, displayName: id, role, kind: 'human' });
    const owner = person('harsh');
    const admin = person('ramnique', 'admin');
    const other = person('gagan');
    const hermes: Member = { id: 'hermes', displayName: 'Hermes', role: 'member', kind: 'agent', ownerId: 'harsh' };
    const replicas: Member = { id: 'replicas', displayName: 'Replicas', role: 'member', kind: 'agent' };
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
    expect(canRevokeAgentKey(owner, hermes)).toBeNull();
    expect(canRevokeAgentKey(admin, hermes)).toBeNull();
    expect(canRevokeAgentKey(other, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canSetAgentHook(owner, hermes)).toBeNull();
    expect(canSetAgentHook(admin, hermes)).toMatchObject({ code: 'forbidden' });
    expect(canClearAgentHook(admin, hermes)).toBeNull();
    expect(canClearAgentHook(other, hermes)).toMatchObject({ code: 'forbidden' });
    expect(agentsManagedBy(admin)).toBe('all');
    expect(agentsManagedBy(owner)).toBe('owned');
  });

  it('invocations: a shared space to invoke, three hops, the invoker cancels, invoker or admin stops when the connector can', () => {
    expect(invocationRefusal(true, 0)).toBeNull();
    expect(invocationRefusal(true, AGENT_HOP_LIMIT)).toBeNull();
    expect(invocationRefusal(true, AGENT_HOP_LIMIT + 1)).toMatchObject({ reason: 'hop_limit' });
    expect(invocationRefusal(false, 0)).toMatchObject({ reason: 'not_permitted' });
    const inv = { trigger: { authorId: 'harsh' } } as Invocation;
    const person = (id: string, role: Member['role'] = 'member'): Member => ({ id, displayName: id, role, kind: 'human' });
    expect(canCancelQueuedInvocation({ memberId: 'harsh' }, inv)).toBeNull();
    expect(canCancelQueuedInvocation({ memberId: 'gagan' }, inv)).toMatchObject({ code: 'forbidden' });
    expect(canStopInvocation(person('harsh'), inv, true)).toBeNull();
    expect(canStopInvocation(person('ramnique', 'admin'), inv, true)).toBeNull();
    expect(canStopInvocation(person('gagan'), inv, true)).toMatchObject({ code: 'forbidden' });
    expect(canStopInvocation(person('harsh'), inv, false)).toMatchObject({ code: 'invalid_request' });
  });
});

describe('deleted accounts (2026-10-13)', () => {
  const active: Member = { id: 'm1', displayName: 'Ada', role: 'member', kind: 'human' };
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
    expect(canEditProfile({ id: 'm1', displayName: 'Ada', role: 'member', kind: 'human' })).toBeNull();
    expect(canEditProfile({ id: 'm1', displayName: 'Ada', role: 'admin', kind: 'human' })).toBeNull();
    expect(canEditProfile({ id: 'a1', displayName: 'Bot', role: 'member', kind: 'agent', ownerId: 'm1' })).toMatchObject({ code: 'forbidden' });
  });
});
