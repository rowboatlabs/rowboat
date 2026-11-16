import { useEffect, useMemo, useState } from 'react';
import type { Member } from '@rowboat/spaces-protocol';
import type { SpacesClient } from './client';

// Author names reach past a space's roster to your contacts (2026-10-13;
// contacts since 2026-11-09): someone who left the space, or deleted their
// account, still wrote what they wrote there. The space's own roster wins on
// identity; the contacts fill in everyone else, as the desktop does.

export function useProfiles(client: SpacesClient, members: Map<string, Member>): Map<string, Member> {
  const [orgMembers, setOrgMembers] = useState<Map<string, Member>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    client
      .listContacts()
      .then(({ members: list }) => {
        if (!cancelled) setOrgMembers(new Map(list.map((m) => [m.id, m])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);
  return useMemo(() => new Map([...orgMembers, ...members]), [orgMembers, members]);
}

/**
 * A deleted account keeps its name on what it wrote, marked (Harbor's
 * `Member.deactivatedAt`); so does a row that departed (`Member.removedAt`:
 * an org admin's removal until 2026-11-09, a folded duplicate since).
 */
export function memberLabel(member: Pick<Member, 'displayName' | 'deactivatedAt' | 'removedAt'>): string {
  if (member.deactivatedAt) return `${member.displayName} (deactivated)`;
  if (member.removedAt) return `${member.displayName} (removed)`;
  return member.displayName;
}

/** No longer on the server — a deleted account, or a departed row. Pickers leave them out. */
export function isDeparted(member: Pick<Member, 'deactivatedAt' | 'removedAt'>): boolean {
  return !!member.deactivatedAt || !!member.removedAt;
}

/** May this person open a DM with the member (the reach rule, 2026-11-09)? A person: yes; an agent: its owner only. */
export function canMessageDirect(member: Pick<Member, 'kind' | 'ownerId'>, selfMemberId: string | undefined): boolean {
  return member.kind !== 'agent' || (member.ownerId !== undefined && member.ownerId === selfMemberId);
}

/**
 * An agent whose seat in this space is its owner's alone (Harbor spec §4
 * Agent members, 2026-11-09: `Membership.invocableBy`), seen by someone else:
 * a mention of it is refused, so pickers leave it out. Its messages still
 * show, under its name.
 */
export function answersOwnerOnly(member: Pick<Member, 'kind' | 'ownerId'> & { invocableBy?: 'owner' | 'members' }, selfMemberId: string | undefined): boolean {
  return member.kind === 'agent' && member.invocableBy === 'owner' && member.ownerId !== selfMemberId;
}
