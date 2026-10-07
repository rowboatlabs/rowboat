import { useEffect, useState } from 'react';

import { useSpacesAccount, type SpacesOrg } from '@/lib/spaces/account';
import { loadValue, peekValue, saveValue } from '@/lib/spaces/cache';
import { SpacesClient } from '@/lib/spaces/client';

// Your own avatar URL on an org, shared by every screen that draws "you"
// (Spaces footer, Settings, Account). Cached for an instant paint, refreshed
// from GET /v1/me, and pushed to every mounted screen when you change it.

const key = (orgId: string) => `myAvatar:${orgId}`;
const listeners = new Set<() => void>();

export function setMyAvatar(orgId: string, url: string | undefined): void {
  saveValue<string | null>(key(orgId), url ?? null);
  for (const l of listeners) l();
}

export function useMyAvatar(org: SpacesOrg | undefined): string | undefined {
  const account = useSpacesAccount();
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    void loadValue<string | null>(key(org.id)).then(() => !cancelled && bump((n) => n + 1));
    new SpacesClient({ baseUrl: `https://${org.address}`, token: (opts) => account.getAccessToken(opts) })
      .me()
      .then(({ member }) => !cancelled && setMyAvatar(org.id, member.avatarUrl))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [org, account]);
  return org ? (peekValue<string | null>(key(org.id)) ?? undefined) : undefined;
}
