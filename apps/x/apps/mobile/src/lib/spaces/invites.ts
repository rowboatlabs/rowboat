import { useMemo } from 'react';
import { Platform, Share } from 'react-native';

import { useSpacesAccount, type SpacesOrg } from './account';
import { SpacesClient } from './client';
import * as analytics from '@/lib/analytics';

// Invites and space management on the phone (2026-11-02), mirroring desktop
// (invite-link.tsx, add-members-dialog.tsx). An invite is to one space, or it
// is your personal link, whose target is a DM with you (harbor spec §4
// Invites, 2026-11-09); anyone in a space invites to it, no policy knob.

/** A client for the server, by host. */
export function useOrgClient(address: string): SpacesClient {
  const account = useSpacesAccount();
  return useMemo(
    () => new SpacesClient({ baseUrl: `https://${address}`, token: (opts) => account.getAccessToken(opts) }),
    [address, account],
  );
}

/** The signed-in server at this host, if the account knows it. */
export function useOrg(address: string): SpacesOrg | undefined {
  return useSpacesAccount().orgs?.find((o) => o.address === address);
}

/**
 * The share sheet for an invite link. iOS takes the link as a URL (a rich
 * preview, and Copy is in the sheet); Android shares text.
 */
export async function shareInviteLink(link: string, what: string): Promise<void> {
  const result = await Share.share(
    Platform.OS === 'ios' ? { url: link } : { message: link, title: `Join ${what} on Rowboat Spaces` },
  );
  if (result.action === Share.sharedAction) analytics.spacesInviteLinkShared();
}

// The Home list loads once per mount; a screen that changes which spaces you
// are in (new space, join, accept) marks the server so Home reloads on focus.
const changedOrgs = new Set<string>();
export function markSpacesChanged(address: string): void {
  changedOrgs.add(address);
}
export function takeSpacesChanged(address: string): boolean {
  return changedOrgs.delete(address);
}
