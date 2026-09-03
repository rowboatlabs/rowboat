import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useSpacesAccount, type SpacesOrg } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import type { Space } from '@rowboat/spaces-protocol';
import { useColors } from '@/theme/colors';

// Spaces home: signed out → one sign-in button; signed in → the user's orgs,
// each with its spaces. Tapping a space will open its chat (S2).
export default function SpacesScreen() {
  const account = useSpacesAccount();
  const colors = useColors();

  if (account.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (account.status === 'signedOut') return <SignIn />;
  return <OrgList />;
}

function SignIn() {
  const account = useSpacesAccount();
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setBusy(true);
    setError(null);
    try {
      await account.signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32, backgroundColor: colors.background }}>
      <Image source="sf:sailboat" style={{ width: 44, height: 44 }} tintColor={colors.secondaryLabel} />
      <Text style={{ fontSize: 20, fontWeight: '600', color: colors.label }}>Rowboat Spaces</Text>
      <Text style={{ fontSize: 14, textAlign: 'center', color: colors.secondaryLabel }}>
        Talk and files, for your team and everyone's agents.
      </Text>
      <Pressable
        disabled={busy}
        onPress={() => void go()}
        style={({ pressed }) => ({
          marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderCurve: 'continuous',
          backgroundColor: colors.label, opacity: pressed || busy ? 0.7 : 1,
        })}
      >
        {busy
          ? <ActivityIndicator color={colors.background} />
          : <Text style={{ fontSize: 15, fontWeight: '600', color: colors.background }}>Sign in with Rowboat</Text>}
      </Pressable>
      {error ? <Text style={{ fontSize: 13, textAlign: 'center', color: colors.destructive }}>{error}</Text> : null}
    </View>
  );
}

function OrgList() {
  const account = useSpacesAccount();
  const colors = useColors();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await account.refreshOrgs();
    setRefreshing(false);
  }, [account]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      {account.orgsError ? (
        <Text style={{ fontSize: 13, color: colors.destructive }}>{account.orgsError}</Text>
      ) : null}
      {account.orgs.map((org) => <OrgSection key={org.id} org={org} />)}
      {account.orgs.length === 0 && !account.orgsError ? (
        <Text style={{ textAlign: 'center', marginTop: 48, fontSize: 14, color: colors.tertiaryLabel }}>
          No orgs yet — open an invite link to join one.
        </Text>
      ) : null}
      <Pressable onPress={() => void account.signOut()} style={{ alignSelf: 'center', marginTop: 24, padding: 8 }}>
        <Text style={{ fontSize: 13, color: colors.destructive }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function OrgSection({ org }: { org: SpacesOrg }) {
  const account = useSpacesAccount();
  const colors = useColors();
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = new SpacesClient({ baseUrl: `https://${org.address}`, token: (opts) => account.getAccessToken(opts) });
    client.listSpaces().then(setSpaces).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [org.address, account]);

  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, color: colors.secondaryLabel, marginBottom: 4 }}>
        {org.name}
      </Text>
      {error ? <Text style={{ fontSize: 13, color: colors.destructive }}>{error}</Text> : null}
      {spaces === null && !error ? <ActivityIndicator style={{ alignSelf: 'flex-start', margin: 8 }} /> : null}
      {spaces?.map((space) => (
        <Pressable
          key={space.id}
          onPress={() => {
            if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
            router.push({ pathname: '/spaces/chat', params: { org: org.address, space: space.id, title: space.name, me: org.memberId } });
          }}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 10,
            paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, borderCurve: 'continuous',
            backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
          })}
        >
          <Image source="sf:number" style={{ width: 16, height: 16 }} tintColor={colors.secondaryLabel} />
          <Text style={{ flex: 1, fontSize: 16, color: colors.label }}>{space.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
