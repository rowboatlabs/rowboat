import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSpacesAccount } from '@/lib/spaces/account';

// https://<server>/s/<spaceId> opened in the app (a universal link, 2026-11-09):
// the space's chat. The chat screen names it from the cached list. Signed
// out, Home takes over and offers the sign-in.
export default function SpaceLink() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const account = useSpacesAccount();
  const org = account.orgs?.[0];
  if (account.status !== 'signedIn' || !org) return <Redirect href="/spaces" />;
  return <Redirect href={{ pathname: '/spaces/chat', params: { org: org.address, space: spaceId, me: org.memberId } }} />;
}
