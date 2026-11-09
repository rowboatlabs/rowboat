import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { useSpacesAccount } from '@/lib/spaces/account';
import { useOrgClient } from '@/lib/spaces/invites';
import { friendlyError } from '@/lib/spaces/errors';

// https://<server>/u/<memberId> opened in the app (a universal link, 2026-11-09):
// the direct message with that person, created on first use (openDirect is
// get-or-create, under the reach rule). Signed out, Home offers the sign-in.
export default function PersonLink() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const account = useSpacesAccount();
  const org = account.orgs?.[0];
  const client = useOrgClient(org?.address ?? '');
  const opened = useRef(false);
  useEffect(() => {
    if (!org || !memberId || opened.current) return;
    opened.current = true;
    client
      .openDirect(memberId)
      .then(({ space }) => router.replace({ pathname: '/spaces/chat', params: { org: org.address, space: space.id, me: org.memberId, kind: 'direct' } }))
      .catch((err) => {
        Alert.alert("Couldn't open the conversation", friendlyError(err, "You can only message people you share a space with."));
        router.replace('/spaces');
      });
  }, [client, memberId, org]);
  if (account.status !== 'signedIn' || !org) return <Redirect href="/spaces" />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
