import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useSpacesAccount, type SpacesOrg } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import type { Member, Space, UnreadSnapshot } from '@rowboat/spaces-protocol';
import { StatusBanner } from '@/components/status-banner';
import { loadValue, peekValue, saveValue } from '@/lib/spaces/cache';
import { isNetworkError } from '@/lib/spaces/errors';
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
    <View style={{ flex: 1, paddingHorizontal: 28, backgroundColor: colors.background }}>
      {/* Welcome (the one-screen onboarding, Apple's pattern): identity,
          three feature rows, one primary action. */}
      <View style={{ flex: 1, justifyContent: 'center', gap: 28 }}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Image source="sf:sailboat" style={{ width: 48, height: 48 }} tintColor={colors.label} />
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 26, fontWeight: '700', color: colors.label }}>Welcome to Spaces</Text>
            <Text style={{ fontSize: 14, color: colors.tertiaryLabel }}>by Rowboat</Text>
          </View>
        </View>

        <View style={{ gap: 20, marginTop: 8 }}>
          <FeatureRow
            icon="sf:bubble.left.and.bubble.right.fill"
            title="Talk with your team"
            detail="Every space has one stream — messages, threads, reactions."
          />
          <FeatureRow
            icon="sf:folder.fill"
            title="Files everyone can see"
            detail="Plans, notes, and decisions live next to the conversation."
          />
          <FeatureRow
            icon="sf:sparkles"
            title="Agents included"
            detail="Mention @rowboat and your agent picks it up — as you, for you."
          />
        </View>
      </View>

      <View style={{ paddingBottom: 40, gap: 14 }}>
        <Pressable
          disabled={busy}
          onPress={() => void go()}
          style={({ pressed }) => ({
            paddingVertical: 14, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center',
            backgroundColor: colors.label, opacity: pressed || busy ? 0.7 : 1,
          })}
        >
          {busy
            ? <ActivityIndicator color={colors.background} />
            : <Text style={{ fontSize: 16, fontWeight: '600', color: colors.background }}>Sign in with Rowboat</Text>}
        </Pressable>
        <Pressable onPress={() => router.push('/spaces/join')} style={{ alignItems: 'center', padding: 4 }}>
          <Text style={{ fontSize: 14, color: colors.secondaryLabel }}>
            Have an invite link? <Text style={{ fontWeight: '600', color: colors.label }}>Join a space</Text>
          </Text>
        </Pressable>
        <Pressable onPress={() => router.push('/pairing')} style={{ alignItems: 'center', padding: 4 }}>
          <Text style={{ fontSize: 14, color: colors.secondaryLabel }}>
            Use Rowboat on your Mac? <Text style={{ fontWeight: '600', color: colors.label }}>Connect your Mac</Text>
          </Text>
        </Pressable>
        {error ? <Text style={{ fontSize: 13, textAlign: 'center', color: colors.destructive }}>{error}</Text> : null}
      </View>
    </View>
  );
}

function FeatureRow({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
      <Image source={icon} style={{ width: 30, height: 30 }} tintColor={colors.label} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.label }}>{title}</Text>
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.secondaryLabel }}>{detail}</Text>
      </View>
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

  const who = account.orgs?.[0]?.displayName;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingVertical: 8, gap: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <StatusBanner error={account.orgsError} onRetry={() => void refresh()} />
      {account.orgs === null && !account.orgsError ? <ActivityIndicator style={{ marginTop: 48 }} /> : null}
      {account.orgs?.map((org) => <OrgCard key={org.id} org={org} />)}
      {account.orgs?.length === 0 && !account.orgsError ? (
        <View style={{ alignItems: 'center', marginTop: 64, gap: 8 }}>
          <Image source="sf:person.2" style={{ width: 36, height: 36 }} tintColor={colors.tertiaryLabel} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.secondaryLabel }}>No orgs yet</Text>
          <Text style={{ fontSize: 13, color: colors.tertiaryLabel }}>Ask a teammate for an invite link.</Text>
          <Pressable
            onPress={() => router.push('/spaces/join')}
            style={({ pressed }) => ({ marginTop: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.label, opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.background }}>Join with a link</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Account footer */}
      <View style={{ borderTopWidth: 0.5, borderTopColor: colors.separator, paddingTop: 6 }}>
        {who ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
            <Image source="sf:person.crop.circle" style={{ width: 20, height: 20 }} tintColor={colors.secondaryLabel} />
            <Text style={{ flex: 1, fontSize: 15, color: colors.secondaryLabel }}>{who}</Text>
          </View>
        ) : null}
        {who ? <View style={{ height: 1, marginLeft: 44, backgroundColor: colors.separator }} /> : null}
        <Pressable
          onPress={() => router.push('/spaces/join')}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Image source="sf:link" style={{ width: 18, height: 18 }} tintColor={colors.secondaryLabel} />
          <Text style={{ fontSize: 15, color: colors.label }}>Join with an invite link</Text>
        </Pressable>
        <View style={{ height: 1, marginLeft: 44, backgroundColor: colors.separator }} />
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
  // Last-known space list: instant paint, and still there offline.
  const spacesKey = `spaces:${org.address}`;
  const cachedAll = peekValue<Space[]>(spacesKey);
  const [spaces, setSpaces] = useState<Space[] | null>(cachedAll?.filter((s) => s.kind !== 'direct') ?? null);
  const [directs, setDirects] = useState<Space[]>(cachedAll?.filter((s) => s.kind === 'direct') ?? []);
  const [members, setMembers] = useState<Map<string, Member[]>>(() => new Map(peekValue<[string, Member[]][]>(`orgMembers:${org.address}`) ?? []));
  const [unread, setUnread] = useState<UnreadSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(
    () => new SpacesClient({ baseUrl: `https://${org.address}`, token: (opts) => account.getAccessToken(opts) }),
    [org.address, account],
  );

  const load = useCallback(async () => {
    const apply = (all: Space[]) => {
      setSpaces(all.filter((s) => s.kind !== 'direct'));
      setDirects(all.filter((s) => s.kind === 'direct'));
    };
    const membersKey = `orgMembers:${org.address}`;
    if (spaces === null) {
      const [cached, cachedMembers] = await Promise.all([loadValue<Space[]>(spacesKey), loadValue<[string, Member[]][]>(membersKey)]);
      if (cached) apply(cached);
      if (cachedMembers) setMembers((prev) => (prev.size ? prev : new Map(cachedMembers)));
    }
    try {
      const all = await client.listSpaces({ includeDirect: true });
      apply(all);
      saveValue(spacesKey, all);
      // Badges: the org's unread snapshot (read state is org-owned).
      client.unread().then(setUnread).catch(() => {});
      // Rosters per space — best-effort, rows render without them first.
      const loaded = await Promise.all(all.map(async (s) => [s.id, await client.listMembers(s.id).catch(() => [])] as const));
      setMembers(new Map(loaded));
      saveValue(membersKey, loaded);
      setError(null);
    } catch (err) {
      // Offline is already said once at the top of the screen (the org list
      // refresh fails the same way) — cards keep their saved rows quietly.
      if (!isNetworkError(err)) setError(err instanceof Error ? err.message : String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- first-load check only
  }, [client, org.address]);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from a chat: the marks moved, so the badges must too.
  useFocusEffect(
    useCallback(() => {
      if (spaces !== null) client.unread().then(setUnread).catch(() => {});
    }, [client, spaces !== null]),
  );

  // The dot-and-count rule (desktop unread-badge.tsx): grey dot + unread count
  // when nothing is for you; red dot + for-you count when something is —
  // mentions, or every message in a DM.
  const badgeFor = useCallback(
    (spaceId: string, direct: boolean): { unread: number; forYou: number } => {
      const u = unread?.spaces.find((x) => x.spaceId === spaceId);
      if (!u) return { unread: 0, forYou: 0 };
      const total = u.unreadRoots + u.threads.reduce((n, t) => n + t.unreadReplies, 0);
      const mentions = u.unreadMentions + u.threads.reduce((n, t) => n + t.unreadMentions, 0);
      return { unread: total, forYou: direct ? total : mentions };
    },
    [unread],
  );
  /** The DM space with this member, if one exists yet. Your own id is the
      self-DM — one participant, so match on that instead of a pair. */
  const dmWith = useCallback(
    (memberId: string) =>
      memberId === org.memberId
        ? directs.find((d) => d.participants?.length === 1 && d.participants[0] === org.memberId)
        : directs.find((d) => d.participants?.length === 2 && d.participants.includes(memberId) && d.participants.includes(org.memberId)),
    [directs, org.memberId],
  );

  const [openingDm, setOpeningDm] = useState<string | null>(null);

  const openDm = async (m: Member) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setOpeningDm(m.id);
    try {
      const { space } = await client.openDirect(m.id);
      const title = m.id === org.memberId ? `${m.displayName} (you)` : m.displayName;
      router.push({ pathname: '/spaces/chat', params: { org: org.address, space: space.id, title, me: org.memberId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningDm(null);
    }
  };

  const orgMembers = useMemo(() => {
    const seen = new Map<string, Member>();
    for (const list of members.values()) for (const m of list) if (!seen.has(m.id)) seen.set(m.id, m);
    // You first (the self-DM is your notes-to-self), then everyone by name.
    return [...seen.values()].sort((a, b) =>
      a.id === org.memberId ? -1 : b.id === org.memberId ? 1 : a.displayName.localeCompare(b.displayName),
    );
  }, [members, org.memberId]);

  return (
    <View style={{ gap: 4 }}>
      {/* Org identity */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 }}>
        <View
          style={{
            width: 44, height: 44, borderRadius: 11, borderCurve: 'continuous',
            alignItems: 'center', justifyContent: 'center', backgroundColor: orgTint(org.id, dark),
          }}
        >
          <Text style={{ fontSize: 19, fontWeight: '700', color: '#ffffff' }}>
            {(org.name[0] ?? '?').toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', letterSpacing: -0.3, color: colors.label }}>{org.name}</Text>
          <Text style={{ fontSize: 13, color: colors.tertiaryLabel }}>
            {org.role === 'admin' ? 'Admin' : 'Member'}
            {spaces ? ` · ${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'}` : ''}
          </Text>
        </View>
      </View>

      <StatusBanner error={error} />
      {spaces === null && !error ? <ActivityIndicator style={{ alignSelf: 'center', marginVertical: 16 }} /> : null}

      {/* Spaces */}
      {spaces !== null ? <SectionLabel text="Spaces" /> : null}
      {spaces?.map((space) => (
        <Row
          key={space.id}
          onPress={() => {
            if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
            router.push({ pathname: '/spaces/chat', params: { org: org.address, space: space.id, title: space.name, me: org.memberId } });
          }}
        >
          <View style={{ width: 28, alignItems: 'center' }}>
            <Image source="sf:number" style={{ width: 17, height: 17 }} tintColor={colors.secondaryLabel} />
          </View>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: badgeFor(space.id, false).unread > 0 ? '600' : '400', color: colors.label }}>{space.name}</Text>
          <UnreadBadge badge={badgeFor(space.id, false)} />
        </Row>
      ))}
      {spaces?.length === 0 ? (
        <Text style={{ fontSize: 14, color: colors.tertiaryLabel, paddingHorizontal: 16, paddingVertical: 4 }}>
          No spaces in this org yet.
        </Text>
      ) : null}

      {/* Direct messages: every member is one tap from a DM (a DM is a
          `direct` space — openDirect is get-or-create, idempotent). Your own
          row opens the self-DM: notes to self, on the org, for every device
          and your agent. */}
      {orgMembers.length > 0 ? (
        <>
          <View style={{ height: 16 }} />
          <SectionLabel text="Direct messages" />
          {orgMembers.map((m) => (
            <Row key={m.id} disabled={openingDm !== null} dimmed={openingDm !== null && openingDm !== m.id} onPress={() => void openDm(m)}>
              <View style={{ width: 28, alignItems: 'center' }}>
                <View
                  style={{
                    width: 26, height: 26, borderRadius: 13,
                    alignItems: 'center', justifyContent: 'center', backgroundColor: orgTint(m.id, dark),
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#ffffff' }}>
                    {(m.displayName[0] ?? '?').toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: (dmWith(m.id) && badgeFor(dmWith(m.id)!.id, true).unread > 0) ? '600' : '400', color: colors.label }}>
                {m.displayName}
                {m.id === org.memberId ? <Text style={{ color: colors.tertiaryLabel }}> (you)</Text> : null}
              </Text>
              {openingDm === m.id ? <ActivityIndicator size="small" /> : dmWith(m.id) ? <UnreadBadge badge={badgeFor(dmWith(m.id)!.id, true)} /> : null}
            </Row>
          ))}
        </>
      ) : null}
    </View>
  );
}

/** Slack's quiet section label: small, weighty, inset with the row text. */
function SectionLabel({ text }: { text: string }) {
  const colors = useColors();
  return (
    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.secondaryLabel, paddingHorizontal: 16, paddingBottom: 4 }}>
      {text}
    </Text>
  );
}

/** 44pt list row with an inset rounded pressed state — no chevrons, like Slack. */
function Row({ children, onPress, disabled, dimmed }: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  dimmed?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 42,
        marginHorizontal: 8, paddingHorizontal: 8, borderRadius: 10, borderCurve: 'continuous',
        backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
        opacity: dimmed ? 0.5 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

/** Dot-and-count: grey dot + unread, or red dot + for-you (desktop unread-badge.tsx). */
function UnreadBadge({ badge }: { badge: { unread: number; forYou: number } }) {
  const colors = useColors();
  if (badge.unread <= 0) return null;
  const forYou = badge.forYou > 0;
  const figure = forYou ? badge.forYou : badge.unread;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: forYou ? '#ff453a' : colors.tertiaryLabel }} />
      <Text style={{ fontSize: 12, fontWeight: forYou ? '600' : '500', color: forYou ? colors.label : colors.secondaryLabel, fontVariant: ['tabular-nums'] }}>
        {figure > 999 ? '999+' : figure}
      </Text>
    </View>
  );
}
