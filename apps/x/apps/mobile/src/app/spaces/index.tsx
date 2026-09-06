import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useSpacesAccount, type SpacesOrg } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import type { Member, Space } from '@rowboat/spaces-protocol';
import { useColors } from '@/theme/colors';

// Spaces home: signed out → one sign-in button; signed in → the user's orgs as
// inset-grouped cards (iOS Settings shape): org identity header, hairline-
// separated space rows, account footer.
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

  const who = account.orgs[0]?.displayName;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      {account.orgsError ? (
        <Text style={{ fontSize: 13, color: colors.destructive }}>{account.orgsError}</Text>
      ) : null}
      {account.orgs.map((org) => <OrgCard key={org.id} org={org} />)}
      {account.orgs.length === 0 && !account.orgsError ? (
        <View style={{ alignItems: 'center', marginTop: 64, gap: 8 }}>
          <Image source="sf:person.2" style={{ width: 36, height: 36 }} tintColor={colors.tertiaryLabel} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.secondaryLabel }}>No orgs yet</Text>
          <Text style={{ fontSize: 13, color: colors.tertiaryLabel }}>Open an invite link to join one.</Text>
        </View>
      ) : null}

      {/* Account footer */}
      <View style={{ marginTop: 8 }}>
        {who ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
            <Image source="sf:person.crop.circle" style={{ width: 20, height: 20 }} tintColor={colors.secondaryLabel} />
            <Text style={{ flex: 1, fontSize: 15, color: colors.secondaryLabel }}>{who}</Text>
          </View>
        ) : null}
        {who ? <View style={{ height: 1, marginLeft: 44, backgroundColor: colors.separator }} /> : null}
        <Pressable
          onPress={() => void account.signOut()}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Image source="sf:rectangle.portrait.and.arrow.right" style={{ width: 18, height: 18 }} tintColor={colors.destructive} />
          <Text style={{ fontSize: 15, color: colors.destructive }}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// Deterministic, muted org tile tint (same trick as message avatars).
const ORG_HUES = [211, 262, 174, 32, 340, 90];
function orgTint(id: string, dark: boolean): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${ORG_HUES[h % ORG_HUES.length]}, 50%, ${dark ? 34 : 40}%)`;
}

function OrgCard({ org }: { org: SpacesOrg }) {
  const account = useSpacesAccount();
  const colors = useColors();
  const dark = colors.background === '#000000';
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [members, setMembers] = useState<Map<string, Member[]>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = new SpacesClient({ baseUrl: `https://${org.address}`, token: (opts) => account.getAccessToken(opts) });
    client
      .listSpaces()
      .then(async (list) => {
        setSpaces(list);
        // Member stacks per row — best-effort, rows render without them first.
        const loaded = await Promise.all(
          list.map(async (s) => [s.id, await client.listMembers(s.id).catch(() => [])] as const),
        );
        setMembers(new Map(loaded));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [org.address, account]);

  const orgMembers = useMemo(() => {
    const seen = new Map<string, Member>();
    for (const list of members.values()) for (const m of list) if (!seen.has(m.id)) seen.set(m.id, m);
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members]);

  return (
    <View>
      {/* Org identity header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 }}>
        <View
          style={{
            width: 40, height: 40, borderRadius: 10, borderCurve: 'continuous',
            alignItems: 'center', justifyContent: 'center', backgroundColor: orgTint(org.id, dark),
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#ffffff' }}>
            {(org.name[0] ?? '?').toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: colors.label }}>{org.name}</Text>
          <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>
            {org.role === 'admin' ? 'Admin' : 'Member'}
            {spaces ? ` · ${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'}` : ''}
          </Text>
        </View>
      </View>

      {error ? <Text style={{ fontSize: 13, color: colors.destructive, paddingHorizontal: 14, paddingBottom: 12 }}>{error}</Text> : null}
      {spaces === null && !error ? <ActivityIndicator style={{ alignSelf: 'flex-start', marginLeft: 14, marginBottom: 12 }} /> : null}

      {spaces?.map((space, i) => (
        <Fragment key={space.id}>
          <View style={{ height: 1, marginLeft: i === 0 ? 0 : 46, backgroundColor: colors.separator }} />
          <Pressable
            onPress={() => {
              if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
              router.push({ pathname: '/spaces/chat', params: { org: org.address, space: space.id, title: space.name, me: org.memberId } });
            }}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 10,
              paddingLeft: 16, paddingRight: 12, paddingVertical: 13,
              backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
            })}
          >
            <Image source="sf:number" style={{ width: 16, height: 16 }} tintColor={colors.secondaryLabel} />
            <Text style={{ flex: 1, fontSize: 16, color: colors.label }}>{space.name}</Text>
            <Image source="sf:chevron.right" style={{ width: 12, height: 12 }} tintColor={colors.tertiaryLabel} />
          </Pressable>
        </Fragment>
      ))}
      {spaces?.length === 0 ? (
        <Text style={{ fontSize: 13, color: colors.tertiaryLabel, paddingHorizontal: 14, paddingBottom: 14 }}>
          No spaces in this org yet.
        </Text>
      ) : null}

      {/* Members, as their own section (union across the org's spaces). */}
      {orgMembers.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, color: colors.secondaryLabel, paddingHorizontal: 16, marginBottom: 2 }}>
            Members
          </Text>
          {orgMembers.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
              <View
                style={{
                  width: 28, height: 28, borderRadius: 14,
                  alignItems: 'center', justifyContent: 'center', backgroundColor: orgTint(m.id, dark),
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#ffffff' }}>
                  {(m.displayName[0] ?? '?').toUpperCase()}
                </Text>
              </View>
              <Text style={{ flex: 1, fontSize: 15, color: colors.label }}>{m.displayName}</Text>
              {m.role === 'admin' ? (
                <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>Admin</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
