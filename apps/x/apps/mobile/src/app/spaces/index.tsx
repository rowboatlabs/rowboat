import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useSpacesAccount, type SpacesOrg } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import type { Member, Space, UnreadSnapshot } from '@rowboat/spaces-protocol';
import { StatusBanner } from '@/components/status-banner';
import { loadValue, peekValue, saveValue } from '@/lib/spaces/cache';
import { isNetworkError } from '@/lib/spaces/errors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/bottom-sheet';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

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

  // One org on screen at a time (Slack's workspace model); the header opens
  // the switcher. The choice is remembered across launches.
  const [selectedId, setSelectedId] = useState<string | null>(() => peekValue<string>('selectedOrg') ?? null);
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    void loadValue<string>('selectedOrg').then((v) => v && setSelectedId((prev) => prev ?? v));
  }, []);
  const current = account.orgs?.find((o) => o.id === selectedId) ?? account.orgs?.[0];
  const who = current?.displayName ?? account.orgs?.[0]?.displayName;


  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <StatusBanner error={account.orgsError} onRetry={() => void refresh()} />
      {account.orgs === null && !account.orgsError ? <ActivityIndicator style={{ marginTop: 48 }} /> : null}
      {current ? <OrgCard key={current.id} org={current} onSwitch={() => setSwitching(true)} /> : null}
      {account.orgs?.length === 0 && !account.orgsError ? (
        <View style={{ alignItems: 'center', marginTop: 56, gap: 10 }}>
          <View style={{ width: 72, height: 72, borderRadius: 22, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
            <Image source="sf:person.2" style={{ width: 32, height: 32 }} tintColor={colors.secondaryLabel} />
          </View>
          <Text style={{ ...type.title, color: colors.label }}>No orgs yet</Text>
          <Text style={{ ...type.body, lineHeight: 22, textAlign: 'center', color: colors.secondaryLabel, paddingHorizontal: 24 }}>
            Ask a teammate for an invite link to join their space.
          </Text>
          <Pressable
            onPress={() => router.push('/spaces/join')}
            style={({ pressed }) => ({ marginTop: 8, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.label, opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ ...type.bodyStrong, color: colors.background }}>Join with a link</Text>
          </Pressable>
        </View>
      ) : null}

      {/* You + the one way in */}
      <Card>
        {who ? (
          <CardRow first onPress={() => router.push('/spaces/account')}>
            <Avatar id={current?.memberId ?? who} name={who} size={28} />
            <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{who}</Text>
            <Chevron />
          </CardRow>
        ) : null}
        <CardRow first={!who} onPress={() => router.push('/spaces/join')}>
          <Glyph icon="sf:link" />
          <Text style={{ flex: 1, ...type.body, color: colors.label }}>Join with an invite link</Text>
          <Chevron />
        </CardRow>
      </Card>
      <OrgSwitcher
        visible={switching}
        orgs={account.orgs ?? []}
        currentId={current?.id}
        onPick={(id) => {
          setSelectedId(id);
          saveValue('selectedOrg', id);
          setSwitching(false);
        }}
        onClose={() => setSwitching(false)}
      />
    </ScrollView>
  );
}

/** Slack's workspace switcher: a bottom sheet of your orgs, a check on the current one. */
function OrgSwitcher({ visible, orgs, currentId, onPick, onClose }: {
  visible: boolean;
  orgs: SpacesOrg[];
  currentId?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <BottomSheet visible={visible} onClose={onClose}
      style={{ paddingTop: 10, paddingHorizontal: 16, paddingBottom: insets.bottom + 12, gap: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.groupedBackground }}
    >
          <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.separator }} />
          <Text style={{ ...type.title, color: colors.label, paddingHorizontal: 4 }}>Your orgs</Text>
          <Card>
            {orgs.map((o, i) => (
              <CardRow key={o.id} first={i === 0} onPress={() => onPick(o.id)}>
                <OrgLogo org={o} size={28} readOnly />
                <View style={{ flex: 1, paddingVertical: 8 }}>
                  <Text numberOfLines={1} style={{ ...type.bodyStrong, color: colors.label }}>{o.name}</Text>
                  <Text numberOfLines={1} style={{ ...type.caption, color: colors.tertiaryLabel }}>{o.address}</Text>
                </View>
                {o.id === currentId ? <Image source="sf:checkmark" style={{ width: 15, height: 15 }} tintColor="#0a84ff" /> : null}
              </CardRow>
            ))}
          </Card>
          <Card>
            <CardRow
              first
              onPress={() => {
                onClose();
                router.push('/spaces/join');
              }}
            >
              <Glyph icon="sf:plus" />
              <Text style={{ flex: 1, ...type.body, color: colors.label }}>Join another org</Text>
            </CardRow>
          </Card>
    </BottomSheet>
  );
}

// Deterministic, muted org tile tint (same trick as message avatars).
const ORG_HUES = [211, 262, 174, 32, 340, 90];
function orgTint(id: string, dark: boolean): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${ORG_HUES[h % ORG_HUES.length]}, 50%, ${dark ? 34 : 40}%)`;
}

function OrgCard({ org, onSwitch }: { org: SpacesOrg; onSwitch: () => void }) {
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

  const people = orgMembers.length;

  return (
    <View style={{ gap: 24 }}>
      {/* Org identity: a plain card — tile, name, one quiet line of facts. */}
      <Card>
        <Pressable
          onPress={() => {
            if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
            onSwitch();
          }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: pressed ? colors.secondaryBackground : 'transparent' })}
        >
          <OrgLogo org={org} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text numberOfLines={1} style={{ ...type.title, color: colors.label }}>{org.name}</Text>
            <Text style={{ ...type.caption, color: colors.secondaryLabel }}>
              {[
                org.role === 'admin' ? 'Admin' : 'Member',
                people > 0 ? `${people} ${people === 1 ? 'person' : 'people'}` : null,
                spaces ? `${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'}` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Image source="sf:chevron.up.chevron.down" style={{ width: 11, height: 15 }} tintColor={colors.tertiaryLabel} />
        </Pressable>
      </Card>

      <StatusBanner error={error} />
      {spaces === null && !error ? <ActivityIndicator style={{ alignSelf: 'center', marginVertical: 16 }} /> : null}

      {/* Spaces */}
      {spaces !== null ? (
        <View style={{ gap: 8 }}>
          <SectionLabel text="Spaces" />
          <Card>
            {spaces.map((space, i) => {
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
            {spaces.length === 0 ? (
              <Text style={{ ...type.body, color: colors.tertiaryLabel, padding: 14 }}>No spaces in this org yet.</Text>
            ) : null}
          </Card>
        </View>
      ) : null}

      {/* Direct messages: every member is one tap from a DM (a DM is a
          `direct` space — openDirect is get-or-create, idempotent). Your own
          row opens the self-DM: notes to self, on the org, for every device
          and your agent. */}
      {orgMembers.length > 0 ? (
        <View style={{ gap: 8 }}>
          <SectionLabel text="Direct messages" />
          <Card>
            {orgMembers.map((m, i) => {
              const dm = dmWith(m.id);
              const badge = dm ? badgeFor(dm.id, true) : { unread: 0, forYou: 0 };
              const self = m.id === org.memberId;
              return (
                <CardRow key={m.id} first={i === 0} disabled={openingDm !== null} dimmed={openingDm !== null && openingDm !== m.id} onPress={() => void openDm(m)}>
                  <Avatar id={m.id} name={m.displayName} size={28} />
                  <Text numberOfLines={1} style={{ flex: 1, ...type.body, fontWeight: badge.unread > 0 ? '600' : '400', color: colors.label }}>
                    {m.displayName}
                    {self ? <Text style={{ fontWeight: '400', color: colors.tertiaryLabel }}> (you)</Text> : null}
                  </Text>
                  {openingDm === m.id ? <ActivityIndicator size="small" /> : badge.unread > 0 ? <UnreadBadge badge={badge} /> : null}
                </CardRow>
              );
            })}
          </Card>
        </View>
      ) : null}
    </View>
  );
}

function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ORG_HUES[h % ORG_HUES.length]!;
}

/**
 * The org's logo: a circle — its initial on the org tint, or a photo you
 * picked. Tap to choose or remove. The org server has no logo field yet, so
 * the photo is saved on this phone only (cache.ts value store, wiped on
 * sign-out) and teammates still see the initial.
 */
function OrgLogo({ org, size = 44, readOnly }: { org: SpacesOrg; size?: number; readOnly?: boolean }) {
  const colors = useColors();
  const dark = colors.isDark;
  const key = `orgLogo:${org.id}`;
  const [logo, setLogo] = useState<string | null>(() => peekValue<string | null>(key) ?? null);
  useEffect(() => {
    void loadValue<string | null>(key).then((v) => v && setLogo(v));
  }, [key]);

  const choose = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.4, base64: true });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const uri = `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`;
    setLogo(uri);
    saveValue(key, uri);
  };
  const remove = () => {
    setLogo(null);
    saveValue<string | null>(key, null);
  };
  const onPress = () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    const options = logo ? ['Choose photo', 'Remove logo', 'Cancel'] : ['Choose photo', 'Cancel'];
    if (process.env.EXPO_OS !== 'ios') {
      Alert.alert('Org logo', undefined, [
        { text: 'Choose photo', onPress: () => void choose() },
        ...(logo ? [{ text: 'Remove logo', style: 'destructive' as const, onPress: remove }] : []),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Org logo', message: 'Saved on this phone only.', options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: logo ? 1 : undefined },
      (i) => {
        if (i === 0) void choose();
        else if (logo && i === 1) remove();
      },
    );
  };

  const face = logo ? (
    <Image source={{ uri: logo }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.secondaryBackground }} contentFit="cover" />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: orgTint(org.id, dark) }}>
      <Text style={{ fontSize: size * 0.43, fontWeight: '700', color: '#ffffff' }}>{(org.name[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
  if (readOnly) return face;
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {face}
    </Pressable>
  );
}

/** Section header — the same small caps line Settings uses. */
function SectionLabel({ text }: { text: string }) {
  const colors = useColors();
  return <Text style={{ ...type.section, color: colors.secondaryLabel, paddingHorizontal: 16 }}>{text}</Text>;
}

/** A flat grouped surface (iOS Settings): no shadow, no border — the ground does the work. */
function Card({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={{ borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.card }}>{children}</View>;
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

/** Initial on a soft tint of the person's own hue. */
function Avatar({ id, name, size }: { id: string; name: string; size: number }) {
  const colors = useColors();
  const dark = colors.isDark;
  const hue = hueOf(id);
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: dark ? `hsl(${hue}, 32%, 26%)` : `hsl(${hue}, 62%, 90%)`,
      }}
    >
      <Text style={{ fontSize: size * 0.43, fontWeight: '600', color: dark ? `hsl(${hue}, 70%, 82%)` : `hsl(${hue}, 48%, 34%)` }}>
        {(name[0] ?? '?').toUpperCase()}
      </Text>
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
