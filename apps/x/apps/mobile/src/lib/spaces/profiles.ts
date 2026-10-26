import { useEffect, useMemo, useState } from 'react';
import type { Member } from '@rowboat/spaces-protocol';
import type { SpacesClient } from './client';

// Author names reach past a space's roster to the whole org (2026-10-13):
// someone who left the space, or deleted their account, still wrote what they
// wrote there. The space's own roster wins on identity; the org roster fills
// in everyone else, as the desktop does.

export function useProfiles(client: SpacesClient, members: Map<string, Member>): Map<string, Member> {
  const [orgMembers, setOrgMembers] = useState<Map<string, Member>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    client
      .listOrgMembers()
      .then((list) => {
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
 * `Member.deactivatedAt`); so does someone an admin removed from the org
 * (`Member.removedAt`, 2026-10-19).
 */
export function memberLabel(member: Pick<Member, 'displayName' | 'deactivatedAt' | 'removedAt'>): string {
  if (member.deactivatedAt) return `${member.displayName} (deactivated)`;
  if (member.removedAt) return `${member.displayName} (removed)`;
  return member.displayName;
}

/** No longer in the org — a deleted account, or removed by an admin. Pickers leave them out. */
export function isDeparted(member: Pick<Member, 'deactivatedAt' | 'removedAt'>): boolean {
  return !!member.deactivatedAt || !!member.removedAt;
}
