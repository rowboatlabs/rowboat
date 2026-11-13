import { router, useFocusEffect } from 'expo-router';
import { Image } from '@/components/sf-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View, TextInput, LayoutAnimation } from 'react-native';

import { useSpacesAccount, type SpacesOrg } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import type { Member, SearchResults, Space, UnreadSnapshot } from '@rowboat/spaces-protocol';
import { Avatar, AuthedImage } from '@/components/avatar';
import { StatusBanner } from '@/components/status-banner';
import { friendlyError } from '@/lib/spaces/errors';
import { canMessageDirect, isDeparted, memberLabel } from '@/lib/spaces/profiles';
import { useBlockedIds } from '@/lib/spaces/moderation';
import { useMyAvatar } from '@/lib/spaces/my-avatar';
import { useParentHeader } from '@/lib/use-parent-header';
import { pickProfileImage } from '@/lib/spaces/profile-image';
import { loadValue, peekValue, saveValue } from '@/lib/spaces/cache';
import { isNetworkError } from '@/lib/spaces/errors';
import { takeSpacesChanged } from '@/lib/spaces/invites';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/bottom-sheet';
import { SearchHits, noHits, type HitSpace } from '@/components/search-results';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Spaces home: signed out → one sign-in button; signed in → the server as
// inset-grouped cards (iOS Settings shape): your spaces, your direct
// messages, your link. One server since 2026-11-09: no switcher.
export type SpacesTabKey = 'home' | 'dms' | 'more' | 'search';

export function SpacesTab({ tab }: { tab: SpacesTabKey }) {
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
  return <OrgList tab={tab} />;
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

function OrgList({ tab }: { tab: SpacesTabKey }) {
  const account = useSpacesAccount();
  const colors = useColors();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await account.refreshOrgs();
    setRefreshing(false);
  }, [account]);

  // The one server (2026-11-09).
  const current = account.orgs?.[0];
  const who = current?.displayName;
  const myAvatar = useMyAvatar(current);


  // One screen per tab of the Spaces bar ((tabs)/_layout.tsx): Home, DMs,
  // More, and the search tab — spaces and people by name, then messages,
  // discussions and files across every space (2026-11-12).
  const [query, setQuery] = useState('');
  const TITLES: Record<SpacesTabKey, string> = { home: 'Spaces', dms: 'Direct messages', more: 'More', search: 'Search' };
  useParentHeader(TITLES[tab]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.groupedBackground }}>
        <ScrollView
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        >
          <StatusBanner error={account.orgsError} onRetry={() => void refresh()} />
          {account.orgs === null && !account.orgsError ? <ActivityIndicator style={{ marginTop: 48 }} /> : null}

          {tab === 'search' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.card }}>
              <Image source="sf:magnifyingglass" style={{ width: 16, height: 16 }} tintColor={colors.tertiaryLabel} />
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder="Search messages, files, spaces, people"
                placeholderTextColor={colors.tertiaryLabel}
                autoCorrect={false}
                clearButtonMode="while-editing"
                style={{ flex: 1, paddingVertical: 12, ...type.body, color: colors.label }}
              />
            </View>
          ) : null}

          {tab === 'more' ? (
            <>
              <Card>
                {who ? (
                  <CardRow first onPress={() => router.push('/spaces/account')}>
                    <Avatar id={current?.memberId ?? who} name={who} size={28} url={myAvatar} />
                    <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{who}</Text>
                    {/* One tap to your QR code (2026-11-11), for showing it to someone in person. */}
                    {current ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Show your QR code"
                        hitSlop={10}
                        onPress={() => router.push({ pathname: '/spaces/invite', params: { org: current.address, qr: '1' } })}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingHorizontal: 4 })}
                      >
                        <Image source="sf:qrcode" style={{ width: 20, height: 20 }} tintColor={colors.secondaryLabel} />
                      </Pressable>
                    ) : null}
                    <Chevron />
                  </CardRow>
                ) : null}
                <CardRow first={!who} onPress={() => router.push('/spaces/settings')}>
                  <Glyph icon="sf:gearshape" />
                  <Text style={{ flex: 1, ...type.body, color: colors.label }}>Settings</Text>
                  <Chevron />
                </CardRow>
                {/* Your agents (2026-11-13): list, create one Rowboat runs, and manage each. */}
                {current ? (
                  <CardRow onPress={() => router.push({ pathname: '/spaces/agents', params: { org: current.address, me: current.memberId } })}>
                    <Glyph icon="sf:cpu" />
                    <Text style={{ flex: 1, ...type.body, color: colors.label }}>Agents</Text>
                    <Chevron />
                  </CardRow>
                ) : null}
              </Card>
              <Card>
                <CardRow first onPress={() => router.push('/spaces/join')}>
                  <Glyph icon="sf:link" />
                  <Text style={{ flex: 1, ...type.body, color: colors.label }}>Join with an invite link</Text>
                  <Chevron />
                </CardRow>
                <CardRow onPress={() => router.push('/pairing')}>
                  <Glyph icon="sf:laptopcomputer" />
                  <Text style={{ flex: 1, ...type.body, color: colors.label }}>Connect your Mac</Text>
                  <Chevron />
                </CardRow>
              </Card>
            </>
          ) : current ? (
            <OrgCard
              key={current.id}
              org={current}
              mode={tab === 'dms' ? 'dms' : tab === 'search' ? 'search' : 'home'}
              query={tab === 'search' ? query : ''}
            />
          ) : null}

          {account.orgs?.length === 0 && !account.orgsError && tab !== 'more' ? (
            <View style={{ alignItems: 'center', marginTop: 56, gap: 10 }}>
              <View style={{ width: 72, height: 72, borderRadius: 22, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
                <Image source="sf:person.2" style={{ width: 32, height: 32 }} tintColor={colors.secondaryLabel} />
              </View>
              <Text style={{ ...type.title, color: colors.label }}>Spaces is unreachable</Text>
              <Text style={{ ...type.body, lineHeight: 22, textAlign: 'center', color: colors.secondaryLabel, paddingHorizontal: 24 }}>
                Check your connection and pull to refresh, or open an invite link someone sent you.
              </Text>
              <Pressable
                onPress={() => router.push('/spaces/join')}
                style={({ pressed }) => ({ marginTop: 8, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.label, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ ...type.bodyStrong, color: colors.background }}>Join with a link</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
    </View>
  );
}

// Deterministic, muted org tile tint (same trick as message avatars).
const ORG_HUES = [211, 262, 174, 32, 340, 90];
function orgTint(id: string, dark: boolean): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${ORG_HUES[h % ORG_HUES.length]}, 50%, ${dark ? 34 : 40}%)`;
}

function OrgCard({ org, mode = 'home', query = '' }: { org: SpacesOrg; mode?: 'home' | 'dms' | 'search'; query?: string }) {
  const account = useSpacesAccount();
  const colors = useColors();
  const dark = colors.isDark;
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
      // Badges: the server's unread snapshot (read state is server-owned).
      client.unread().then(setUnread).catch(() => {});
      // Rosters per space — best-effort, rows render without them first.
      const loaded = await Promise.all(all.map(async (s) => [s.id, await client.listMembers(s.id).catch(() => [])] as const));
      setMembers(new Map(loaded));
      saveValue(membersKey, loaded);
      setError(null);
    } catch (err) {
      // Offline is already said once at the top of the screen (the server record
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
      // A new space, or one joined by link, reloads the list.
      if (takeSpacesChanged(org.address)) void load();
      else if (spaces !== null) client.unread().then(setUnread).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps -- spaces !== null stands for spaces
    }, [client, load, org.address, spaces !== null]),
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

  // Under an admins-only invite policy a member's invite is refused, so Invite hides.

  const [openingDm, setOpeningDm] = useState<string | null>(null);
  const blockedIds = useBlockedIds(org.address);
  const blockedKey = [...blockedIds].join(',');

  // Deleted accounts you share a DM with that has messages in it. A DM's
  // stream also holds join events, so ask for its newest message instead.
  const [talkedWith, setTalkedWith] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    const gone = new Map<string, Member>();
    for (const list of members.values()) for (const m of list) if (m.deactivatedAt && m.id !== org.memberId) gone.set(m.id, m);
    void Promise.all(
      [...gone.keys()].map(async (memberId) => {
        const dm = dmWith(memberId);
        if (!dm) return null;
        const { messages } = await client.listStream(dm.id, { limit: 1 }).catch(() => ({ messages: [] }));
        return messages.length > 0 ? memberId : null;
      }),
    ).then((ids) => !cancelled && setTalkedWith(new Set(ids.filter((x): x is string => x !== null))));
    return () => {
      cancelled = true;
    };
  }, [client, members, dmWith, org.memberId]);

  const openDm = async (m: Member) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    const title = m.id === org.memberId ? `${m.displayName} (you)` : memberLabel(m);
    // An existing DM opens as is (2026-10-19): Harbor refuses to start one
    // with a deleted account, but the history you share stays readable.
    const existing = dmWith(m.id);
    if (existing) {
      router.push({ pathname: '/spaces/chat', params: { org: org.address, space: existing.id, title, me: org.memberId, kind: 'direct' } });
      return;
    }
    setOpeningDm(m.id);
    try {
      const { space } = await client.openDirect(m.id);
      router.push({ pathname: '/spaces/chat', params: { org: org.address, space: space.id, title, me: org.memberId, kind: 'direct' } });
    } catch (err) {
      // A one-off refusal, not the screen's state: an alert the user dismisses.
      Alert.alert("Couldn't open a conversation", friendlyError(err));
    } finally {
      setOpeningDm(null);
    }
  };

  const orgMembers = useMemo(() => {
    const seen = new Map<string, Member>();
    for (const list of members.values()) for (const m of list) if (!seen.has(m.id)) seen.set(m.id, m);
    // A deleted account (2026-10-19) stays only where you two actually talked:
    // a DM with messages in it. Otherwise there's nobody left to message.
    for (const m of seen.values()) if (m.deactivatedAt && !talkedWith.has(m.id)) seen.delete(m.id);
    // People you blocked (2026-10-20) leave the list; unblock from Account.
    for (const id of blockedIds) seen.delete(id);
    // An agent that is not yours can't be messaged (2026-11-09, the reach rule).
    for (const m of [...seen.values()]) if (!canMessageDirect(m, org.memberId)) seen.delete(m.id);
    // You first (the self-DM is your notes-to-self), then everyone by name.
    return [...seen.values()].sort((a, b) =>
      a.id === org.memberId ? -1 : b.id === org.memberId ? 1 : a.displayName.localeCompare(b.displayName),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- blockedKey stands for blockedIds
  }, [members, org.memberId, talkedWith, blockedKey]);

  const people = orgMembers.filter((m) => !m.deactivatedAt).length;
  // Collapsible sections (Slack): remembered per org; only on Home. A
  // collapsed section still says how much is waiting inside it.
  const collapseKey = `collapsed:${org.id}`;
  type Collapsed = { spaces?: boolean; dms?: boolean; agents?: boolean };
  const [collapsed, setCollapsed] = useState<Collapsed>(() => peekValue<Collapsed>(collapseKey) ?? {});
  useEffect(() => {
    void loadValue<Collapsed>(collapseKey).then((v) => v && setCollapsed(v));
  }, [collapseKey]);
  const toggle = (section: 'spaces' | 'dms' | 'agents') => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsed((prev) => {
      const next = { ...prev, [section]: !prev[section] };
      saveValue(collapseKey, next);
      return next;
    });
  };
  const canCollapse = mode === 'home';
  const spacesClosed = canCollapse && Boolean(collapsed.spaces);
  const dmsClosed = canCollapse && Boolean(collapsed.dms);
  const agentsClosed = canCollapse && Boolean(collapsed.agents);
  const sum = (badges: { unread: number; forYou: number }[]) =>
    badges.reduce((t, b) => ({ unread: t.unread + b.unread, forYou: t.forYou + b.forYou }), { unread: 0, forYou: 0 });
  const spacesWaiting = sum((spaces ?? []).map((sp) => badgeFor(sp.id, false)));
  const waitingIn = (list: Member[]) => sum(list.map((m) => { const dm = dmWith(m.id); return dm ? badgeFor(dm.id, true) : { unread: 0, forYou: 0 }; }));

  // Search: spaces and people whose names contain the query, then the
  // server's search over every space you are in (GET /v1/search, 2026-11-12),
  // what the web's ⌘K palette shows. Debounced, one request per pause.
  const q = query.trim().toLowerCase();
  const [hits, setHits] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<unknown>(null);
  useEffect(() => {
    const text = query.trim();
    if (mode !== 'search' || !text) {
      setHits(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      client
        .search(undefined, { q: text, limit: 20 })
        .then((r) => {
          if (cancelled) return;
          setHits(r);
          setSearchError(null);
        })
        .catch((err) => {
          // Offline is already said at the top of the screen; the name matches still show.
          if (!cancelled) setSearchError(isNetworkError(err) ? null : err);
        })
        .finally(() => !cancelled && setSearching(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [client, mode, query]);
  // A hit opens in its space: a DM is titled by the other person, as its row is.
  const spaceFor = useCallback(
    (spaceId: string): HitSpace | undefined => {
      const sp = spaces?.find((x) => x.id === spaceId);
      if (sp) return { title: sp.name };
      const dm = directs.find((x) => x.id === spaceId);
      if (!dm) return undefined;
      const otherId = dm.participants?.find((id) => id !== org.memberId) ?? org.memberId;
      const other = members.get(dm.id)?.find((m) => m.id === otherId) ?? orgMembers.find((m) => m.id === otherId);
      return { title: other ? (otherId === org.memberId ? `${other.displayName} (you)` : memberLabel(other)) : 'Direct message', kind: 'direct' };
    },
    [spaces, directs, members, orgMembers, org.memberId],
  );
  const shownSpaces = mode === 'dms' ? null : mode === 'search' && q ? (spaces?.filter((s) => s.name.toLowerCase().includes(q)) ?? null) : spaces;
  const shownMembers = mode === 'search' && q ? orgMembers.filter((m) => m.displayName.toLowerCase().includes(q)) : orgMembers;
  // People and your agents in their own sections (2026-11-09, as the desktop's sidebar has them).
  const shownPeople = shownMembers.filter((m) => m.kind !== 'agent');
  const shownAgents = shownMembers.filter((m) => m.kind === 'agent');
  // Home's Agents section (2026-11-13). The desktop lists the agents you have a
  // DM with; the phone has no per-DM activity time, so unread first, then those
  // DMs, then by name, capped at five so Home stays short. "View all agents"
  // reaches the rest.
  const HOME_AGENTS = 5;
  const agentRank = (m: Member) => {
    const dm = dmWith(m.id);
    return dm && badgeFor(dm.id, true).unread > 0 ? 0 : dm ? 1 : 2;
  };
  const homeAgents = [...shownAgents].sort((a, b) => agentRank(a) - agentRank(b) || a.displayName.localeCompare(b.displayName)).slice(0, HOME_AGENTS);
  // Others' agents after yours, filling the five (2026-11-13, Gagan: "I only see
  // my agents"): the ones in spaces you share, as the desktop Agents page finds
  // them. Harbor refuses a DM with an agent you don't own (the reach rule,
  // 2026-11-09), so they open their read-only page instead, under their owner's name.
  const othersAgents = useMemo(() => {
    const seen = new Map<string, Member>();
    for (const list of members.values()) for (const m of list) if (m.kind === 'agent' && !seen.has(m.id) && !isDeparted(m) && !canMessageDirect(m, org.memberId)) seen.set(m.id, m);
    for (const id of blockedIds) seen.delete(id);
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- blockedKey stands for blockedIds
  }, [members, org.memberId, blockedKey]);
  const ownerName = (m: Member) => {
    if (!m.ownerId) return 'Built in';
    for (const list of members.values()) {
      const owner = list.find((x) => x.id === m.ownerId);
      if (owner) return `${owner.displayName}’s`;
    }
    return 'Someone else’s';
  };
  const homeOthers = othersAgents.slice(0, Math.max(0, HOME_AGENTS - homeAgents.length));
  const agentsLink = { org: org.address, me: org.memberId };

  const memberRow = (m: Member, i: number) => {
    const dm = dmWith(m.id);
    const badge = dm ? badgeFor(dm.id, true) : { unread: 0, forYou: 0 };
    const self = m.id === org.memberId;
    return (
      <CardRow key={m.id} first={i === 0} disabled={openingDm !== null} dimmed={openingDm !== null && openingDm !== m.id} onPress={() => void openDm(m)}>
        <Avatar id={m.id} name={m.displayName} size={28} url={m.avatarUrl} />
        <Text numberOfLines={1} style={{ flex: 1, ...type.body, fontWeight: badge.unread > 0 ? '600' : '400', color: colors.label }}>
          {m.displayName}
          {self ? <Text style={{ fontWeight: '400', color: colors.tertiaryLabel }}> (you)</Text> : null}
          {m.deactivatedAt ? <Text style={{ fontWeight: '400', color: colors.tertiaryLabel }}> (deactivated)</Text> : null}
        </Text>
        {openingDm === m.id ? <ActivityIndicator size="small" /> : badge.unread > 0 ? <UnreadBadge badge={badge} /> : null}
      </CardRow>
    );
  };

  const otherAgentRow = (m: Member, i: number) => (
    <CardRow key={m.id} first={i === 0} onPress={() => router.push({ pathname: '/spaces/agent', params: { ...agentsLink, agent: m.id, title: m.displayName } })}>
      <Avatar id={m.id} name={m.displayName} size={28} url={m.avatarUrl} />
      <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{m.displayName}</Text>
      <Text numberOfLines={1} style={{ ...type.caption, color: colors.tertiaryLabel, maxWidth: '40%' }}>{ownerName(m)}</Text>
      <Chevron />
    </CardRow>
  );

  // People, then your agents: every member is one tap from a DM (a DM is a
  // `direct` space — openDirect is get-or-create, idempotent). Your own row
  // opens the self-DM: notes to self, on the server, for every device and your agent.
  const memberSections = (sections: { key: 'dms' | 'agents'; text: string; list: Member[]; closed: boolean }[]) =>
    sections.map(({ key, text, list, closed }) => list.length > 0 ? (
      <View key={key} style={{ gap: 8 }}>
        <SectionLabel text={text} collapsed={closed} onToggle={canCollapse ? () => toggle(key) : undefined} waiting={waitingIn(list)} />
        {closed ? null : <Card>{list.map(memberRow)}</Card>}
      </View>
    ) : null);

  return (
    <View style={{ gap: 24 }}>
      {mode === 'home' ? (
        <>
      {/* Identity: a plain card — tile, name, one quiet line of facts. */}
      <Card radius={32 /* near-concentric with the 44pt tile and its 14pt inset */}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <OrgTile org={org} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text numberOfLines={1} style={{ ...type.title, color: colors.label }}>{org.name}</Text>
            <Text style={{ ...type.caption, color: colors.secondaryLabel }}>
              {[
                people > 0 ? `${people} ${people === 1 ? 'person' : 'people'}` : null,
                spaces ? `${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'}` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      </Card>
        </>
      ) : null}

      <StatusBanner error={error} />
      {spaces === null && !error ? <ActivityIndicator style={{ alignSelf: 'center', marginVertical: 16 }} /> : null}

      {/* Spaces */}
      {shownSpaces !== null && (mode !== 'search' || shownSpaces.length > 0) ? (
        <View style={{ gap: 8 }}>
          <SectionLabel text="Spaces" collapsed={spacesClosed} onToggle={canCollapse ? () => toggle('spaces') : undefined} waiting={spacesWaiting} />
          {spacesClosed ? null : (
          <Card>
            {shownSpaces.map((space, i) => {
              const badge = badgeFor(space.id, false);
              return (
                <CardRow
                  key={space.id}
                  first={i === 0}
                  onPress={() => router.push({ pathname: '/spaces/chat', params: { org: org.address, space: space.id, title: space.name, me: org.memberId } })}
                >
                  <Glyph icon="sf:number" />
                  <Text numberOfLines={1} style={{ flex: 1, ...type.body, fontWeight: badge.unread > 0 ? '600' : '400', color: colors.label }}>{space.name}</Text>
                  <UnreadBadge badge={badge} />
                </CardRow>
              );
            })}
            {shownSpaces.length === 0 && mode !== 'home' ? (
              <Text style={{ ...type.body, color: colors.tertiaryLabel, padding: 14 }}>No spaces yet.</Text>
            ) : null}
            {/* New group (2026-11-02): the last row of the list, as Slack does. Browse went with open spaces (2026-11-09). */}
            {mode === 'home' ? (
              <CardRow first={shownSpaces.length === 0} onPress={() => router.push({ pathname: '/spaces/new-space', params: { org: org.address, me: org.memberId } })}>
                <Glyph icon="sf:plus" />
                <Text style={{ flex: 1, ...type.body, color: colors.secondaryLabel }}>New space</Text>
              </CardRow>
            ) : null}
          </Card>
          )}
        </View>
      ) : null}

      {/* On Home the agents get their own section below; elsewhere they follow People. */}
      {memberSections([
        { key: 'dms', text: 'People', list: shownPeople, closed: dmsClosed },
        ...(mode === 'home' ? [] : [{ key: 'agents' as const, text: 'Agents', list: shownAgents, closed: agentsClosed }]),
      ])}

      {/* Agents last on Home (2026-11-13, Gagan: Spaces, People, then Agents on
          the phone, not the desktop sidebar's Agents first): yours, then
          others', then Add agent and View all agents. Shown even with none
          yet, so Add agent is always one tap away. */}
      {mode === 'home' && spaces !== null ? (
        <View style={{ gap: 8 }}>
          <SectionLabel text="Agents" collapsed={agentsClosed} onToggle={() => toggle('agents')} waiting={waitingIn(shownAgents)} />
          {agentsClosed ? null : (
          <Card>
            {homeAgents.map(memberRow)}
            {homeOthers.map((m, i) => otherAgentRow(m, homeAgents.length + i))}
            <CardRow first={homeAgents.length + homeOthers.length === 0} onPress={() => router.push({ pathname: '/spaces/new-agent', params: agentsLink })}>
              <Glyph icon="sf:plus" />
              <Text style={{ flex: 1, ...type.body, color: colors.secondaryLabel }}>Add agent</Text>
            </CardRow>
            <CardRow onPress={() => router.push({ pathname: '/spaces/agents', params: agentsLink })}>
              <Glyph icon="sf:cpu" />
              <Text style={{ flex: 1, ...type.body, color: colors.secondaryLabel }}>View all agents</Text>
              <Chevron />
            </CardRow>
          </Card>
          )}
        </View>
      ) : null}
      {mode === 'search' && q ? (
        <>
          {searchError ? <StatusBanner error={searchError} /> : null}
          {hits && !noHits(hits, spaceFor) ? (
            <Card>
              <View style={{ paddingVertical: 6 }}>
                <SearchHits results={hits} org={org.address} me={org.memberId} spaceFor={spaceFor} showSpace />
              </View>
            </Card>
          ) : null}
          {searching ? <ActivityIndicator style={{ alignSelf: 'center' }} /> : null}
        </>
      ) : null}
      {/* Your personal link (harbor spec §4 Invites, 2026-11-09): how someone outside your groups reaches you. Under everything. */}
      {mode === 'home' ? (
        <Card>
          <CardRow first onPress={() => router.push({ pathname: '/spaces/invite', params: { org: org.address } })}>
            <Glyph icon="sf:link" />
            <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>Share your link</Text>
            <Chevron />
          </CardRow>
        </Card>
      ) : null}
      {mode === 'search' && q && !searching && !searchError && (shownSpaces?.length ?? 0) === 0 && shownMembers.length === 0 && (!hits || noHits(hits, spaceFor)) ? (
        <Text style={{ ...type.body, textAlign: 'center', color: colors.tertiaryLabel, paddingTop: 24 }}>No results for “{query.trim()}”</Text>
      ) : null}
    </View>
  );
}

/** The server's tile: its initial on a muted tint (the org logo went with the orgs, 2026-11-09). */
function OrgTile({ org, size = 44 }: { org: SpacesOrg; size?: number }) {
  const colors = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: orgTint(org.id, colors.isDark) }}>
      <Text style={{ fontSize: size * 0.43, fontWeight: '700', color: '#ffffff' }}>{(org.name[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
}

/**
 * Section header — the small caps line Settings uses. With onToggle it is a
 * button: a chevron that points down when open and right when collapsed, and
 * what's waiting inside when it is closed.
 */
function SectionLabel({ text, collapsed, onToggle, waiting }: {
  text: string;
  collapsed?: boolean;
  onToggle?: () => void;
  waiting?: { unread: number; forYou: number };
}) {
  const colors = useColors();
  const label = <Text style={{ ...type.section, color: colors.secondaryLabel }}>{text}</Text>;
  if (!onToggle) return <View style={{ paddingHorizontal: 16 }}>{label}</View>;
  return (
    <View style={{ gap: 14 }}>
      <Pressable
        onPress={() => {
          if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
          onToggle();
        }}
        hitSlop={{ top: 10, bottom: 10 }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 22, opacity: pressed ? 0.6 : 1 })}
      >
        {label}
        <Image source={collapsed ? 'sf:chevron.right' : 'sf:chevron.down'} style={{ width: 10, height: 10 }} contentFit="contain" tintColor={colors.tertiaryLabel} />
        <View style={{ flex: 1 }} />
        {collapsed && waiting ? <UnreadBadge badge={waiting} /> : null}
      </Pressable>
      {/* Closed, a hairline stands in for the list — it separates one closed section from the next. */}
      {collapsed ? <View style={{ height: 0.5, marginHorizontal: 16, backgroundColor: colors.separator }} /> : null}
    </View>
  );
}

/** A flat grouped surface (iOS Settings): no shadow, no border — the ground does the work. */
function Card({ children, radius = 20 }: { children: ReactNode; radius?: number }) {
  const colors = useColors();
  return <View style={{ borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.card }}>{children}</View>;
}

/** 46pt row with a hairline inset past the leading glyph. */
function CardRow({ children, onPress, first, disabled, dimmed }: {
  children: ReactNode;
  onPress: () => void;
  first?: boolean;
  disabled?: boolean;
  dimmed?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.secondaryBackground : 'transparent', opacity: dimmed ? 0.5 : 1 })}
    >
      {first ? null : <View style={{ height: 0.5, marginLeft: 54, backgroundColor: colors.separator }} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14 }}>{children}</View>
    </Pressable>
  );
}

/** A bare symbol in the leading column — same width as an avatar, no tile. */
function Glyph({ icon }: { icon: string }) {
  const colors = useColors();
  return (
    <View style={{ width: 28, alignItems: 'center' }}>
      <Image source={icon} style={{ width: 17, height: 17 }} tintColor={colors.secondaryLabel} />
    </View>
  );
}

function Chevron() {
  const colors = useColors();
  return <Image source="sf:chevron.right" style={{ width: 7, height: 12 }} tintColor={colors.tertiaryLabel} />;
}

/** Unread: a plain grey count, or a small red pill when it's for you. */
function UnreadBadge({ badge }: { badge: { unread: number; forYou: number } }) {
  const colors = useColors();
  if (badge.unread <= 0) return null;
  const forYou = badge.forYou > 0;
  const figure = forYou ? badge.forYou : badge.unread;
  const text = figure > 99 ? '99+' : String(figure);
  if (!forYou) return <Text style={{ ...type.caption, color: colors.tertiaryLabel, fontVariant: ['tabular-nums'] }}>{text}</Text>;
  return (
    <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff3b30' }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: '#ffffff', fontVariant: ['tabular-nums'] }}>{text}</Text>
    </View>
  );
}
