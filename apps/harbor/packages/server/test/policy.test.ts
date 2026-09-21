import { describe, expect, it } from 'vitest';
import type { Membership, Message, Space } from '@rowboat/spaces-protocol';
import { HarborError } from '../src/errors.js';
import {
  canAccessSpace,
  canBind,
  canChangeMembership,
  canRenameSpace,
  canWrite,
  enforce,
  isAuthor,
} from '../src/policy.js';

// The rules, without a store: policy.ts is pure over loaded facts, so every
// "who may do what" answer is pinned here and the service tests only have to
// prove the service ASKS.

const NOW = '2026-09-21T10:00:00.000Z';
const shared: Space = { id: 'S', name: 'Roadboard', createdAt: NOW, kind: 'shared' };
const direct: Space = { id: 'D', name: 'Direct message', createdAt: NOW, kind: 'direct', participants: ['a', 'b'] };
const membership: Membership = { spaceId: 'S', memberId: 'a', joinedAt: NOW };
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

  it('canAccessSpace: a membership row, nothing else — DMs included', () => {
    expect(canAccessSpace(shared, membership)).toBeNull();
    expect(canAccessSpace(direct, { ...membership, spaceId: 'D' })).toBeNull();
    expect(canAccessSpace(shared, undefined)).toMatchObject({ code: 'forbidden' });
    expect(canAccessSpace(direct, undefined)).toMatchObject({ code: 'forbidden' });
  });

  it('canWrite: read-only orgs refuse writes with read_only_limit', () => {
    expect(canWrite({ readOnly: false })).toBeNull();
    expect(canWrite({ readOnly: true })).toMatchObject({ code: 'read_only_limit' });
  });

  it('canChangeMembership / canRenameSpace: shared spaces allow, direct spaces refuse with a reason', () => {
    expect(canChangeMembership(shared, 'invite')).toBeNull();
    expect(canChangeMembership(shared, 'leave')).toBeNull();
    expect(canRenameSpace(shared)).toBeNull();
    expect(canChangeMembership(direct, 'invite')).toMatchObject({ code: 'invalid_request', message: /nobody can be invited/ });
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
});
