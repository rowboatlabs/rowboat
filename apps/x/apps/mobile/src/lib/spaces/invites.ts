import { useEffect, useMemo, useState } from 'react';
import { Platform, Share } from 'react-native';
import type { OrgSettings } from '@rowboat/spaces-protocol';

import { useSpacesAccount, type SpacesOrg } from './account';
import { SpacesClient } from './client';
import { loadValue, peekValue, saveValue } from './cache';
import * as analytics from '@/lib/analytics';

// Invites and space management on the phone (2026-11-02), mirroring desktop
// (invite-dialog.tsx, add-members-dialog.tsx). An invite is to the org and
// may list spaces the inviter is in (harbor, 2026-10-19); everyone it admits
// also joins the org's default spaces.

/** A client for one org, by host. */
export function useOrgClient(address: string): SpacesClient {
  const account = useSpacesAccount();
  return useMemo(
    () => new SpacesClient({ baseUrl: `https://${address}`, token: (opts) => account.getAccessToken(opts) }),
    [address, account],
  );
}

/** The signed-in org at this host, if the account knows it. */
export function useOrg(address: string): SpacesOrg | undefined {
  return useSpacesAccount().orgs?.find((o) => o.address === address);
}

/** "a", "a and b", "a, b and c". */
export function listNames(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const DEFAULT_SETTINGS: OrgSettings = { invitePolicy: 'members', jevEnabled: false };

/**
 * The org's settings, last-known first. An org that predates the route has
 * no policy: members may invite (as desktop's use-org-settings.ts).
 */
export function useOrgSettings(client: SpacesClient, address: string): OrgSettings {
  const key = `orgSettings:${address}`;
  const [settings, setSettings] = useState<OrgSettings>(() => peekValue<OrgSettings>(key) ?? DEFAULT_SETTINGS);
  useEffect(() => {
    let cancelled = false;
    void loadValue<OrgSettings>(key).then((v) => !cancelled && v && setSettings(v));
    client
      .getOrgSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        saveValue(key, s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, key]);
  return settings;
}

/** Under an admins-only invite policy a member's invite is refused, so Invite hides. */
export function canInvite(settings: OrgSettings, role: string | undefined): boolean {
  return settings.invitePolicy === 'members' || role === 'admin';
}

/**
 * The share sheet for an invite link. iOS takes the link as a URL (a rich
 * preview, and Copy is in the sheet); Android shares text.
 */
export async function shareInviteLink(link: string, orgName: string): Promise<void> {
  const result = await Share.share(
    Platform.OS === 'ios' ? { url: link } : { message: link, title: `Join ${orgName} on Rowboat Spaces` },
  );
  if (result.action === Share.sharedAction) analytics.spacesInviteLinkShared();
}

// The Home list loads once per mount; a screen that changes which spaces you
// are in (new space, join, accept) marks the org so Home reloads on focus.
const changedOrgs = new Set<string>();
export function markSpacesChanged(address: string): void {
  changedOrgs.add(address);
}
export function takeSpacesChanged(address: string): boolean {
  return changedOrgs.delete(address);
}
