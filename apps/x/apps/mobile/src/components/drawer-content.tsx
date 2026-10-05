import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { router, usePathname, type Href } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sessions as sessionsShared } from '@x/shared';

import * as analytics from '@/lib/analytics';
import { useConnection } from '@/lib/connection';
import { Avatar } from '@/components/avatar';
import { useSpacesAccount } from '@/lib/spaces/account';
import { peekValue } from '@/lib/spaces/cache';
import { useMyAvatar } from '@/lib/spaces/my-avatar';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

type Entry = sessionsShared.SessionIndexEntry;

// The drawer: you, then where you can go (Spaces, Activity, Settings), then
// your Mac — an invitation until it's paired, chat history and Brain after.
export function DrawerContent(props: DrawerContentComponentProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { sessions, events, status, pairing, unpair } = useConnection();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    if (!sessions) return;
    try {
      const result = await sessions.list();
      // Space-thread sessions belong to Spaces, not the Mac chat list (main 9bc0e44e).
      setEntries(
        result.sessions
          .filter(sessionsShared.isChatListSession)
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
      );
    } catch {
      // keep the last list; the connection row shows the state
    }
  }, [sessions]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!events) return;
    const offEvents = events.on('sessions:events', () => void refresh());
    const offResync = events.onResync(() => void refresh());
    return () => {
      offEvents();
      offResync();
    };
  }, [events, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => (e.title ?? '').toLowerCase().includes(q));
  }, [entries, query]);

  const openChat = (id?: string) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    router.replace({ pathname: '/chat', params: id ? { id } : { id: '' } });
    props.navigation.closeDrawer();
  };

  const paired = Boolean(pairing);
  const connected = status === 'connected';

  const account = useSpacesAccount();
  const pathname = usePathname();
  const selectedOrg = peekValue<string>('selectedOrg');
  const org = account.orgs?.find((o) => o.id === selectedOrg) ?? account.orgs?.[0];
  const myAvatar = useMyAvatar(org);
  const go = (href: Href) => {
    router.push(href);
    props.navigation.closeDrawer();
  };
  const inSettings = /^\/spaces\/(settings|account|notifications)/.test(pathname) || pathname === '/notifications';
  const inActivity = pathname.startsWith('/spaces/activity');
  const inSpaces = pathname.startsWith('/spaces') && !inSettings && !inActivity;

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 8, backgroundColor: colors.background }}>
      {/* You — and the way to your account. */}
      {org ? (
        <Pressable
          onPress={() => go('/spaces/account')}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 8, paddingHorizontal: 10, paddingVertical: 10,
            borderRadius: 16, borderCurve: 'continuous', backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
          })}
        >
          <Avatar id={org.memberId} name={org.displayName} size={40} url={myAvatar} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text numberOfLines={1} style={{ ...type.body, fontWeight: '700', color: colors.label }}>{org.displayName}</Text>
            <Text numberOfLines={1} style={{ ...type.caption, color: colors.secondaryLabel }}>{org.name}</Text>
          </View>
        </Pressable>
      ) : (
        <Text style={{ ...type.title, color: colors.label, paddingHorizontal: 18, paddingVertical: 8 }}>Rowboat</Text>
      )}

      {/* Where you can go. */}
      <View style={{ gap: 2, paddingTop: 14 }}>
        <NavRow icon="sf:bubble.left.and.bubble.right" label="Spaces" active={inSpaces} onPress={() => go('/spaces')} />
        <NavRow icon="sf:bell" label="Activity" active={inActivity} onPress={() => go('/spaces/activity')} />
        <NavRow icon="sf:gearshape" label="Settings" active={inSettings} onPress={() => go('/spaces/settings')} />
      </View>

      <View style={{ height: 0.5, marginHorizontal: 18, marginTop: 14, marginBottom: 18, backgroundColor: colors.separator }} />

      {/* Your Mac: one quiet invitation until it's paired, then chat + Brain. */}
      <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.tertiaryLabel, paddingHorizontal: 18, paddingBottom: 6 }}>Your Mac</Text>
      {paired ? (
        <>
          <View style={{ gap: 2 }}>
            <NavRow icon="sf:square.and.pencil" label="New chat" active={false} onPress={() => openChat()} />
            <NavRow icon="sf:brain" label="Brain" active={pathname.startsWith('/notes')} onPress={() => go('/notes')} />
          </View>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 12, marginTop: 10, marginBottom: 4,
              backgroundColor: colors.secondaryBackground, borderRadius: 10, borderCurve: 'continuous', paddingHorizontal: 10, height: 36,
            }}
          >
            <Image source="sf:magnifyingglass" style={{ width: 14, height: 14 }} tintColor={colors.tertiaryLabel} />
            <TextInput
              style={{ flex: 1, ...type.body, color: colors.label }}
              placeholder="Search chats"
              placeholderTextColor={colors.tertiaryLabel}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
          </View>
          <FlatList
            style={{ flex: 1 }}
            data={filtered}
            keyExtractor={(item) => item.sessionId}
            contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => openChat(item.sessionId)}
                style={({ pressed }) => ({
                  minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, borderCurve: 'continuous',
                  backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
                })}
              >
                <Text numberOfLines={1} style={{ ...type.body, color: colors.label }}>{item.title || 'New chat'}</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={{ ...type.caption, color: colors.tertiaryLabel, paddingHorizontal: 10, paddingTop: 8 }}>
                {query ? 'No matches' : 'No chats yet'}
              </Text>
            }
          />
          {/* The connection, and the way out of it. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colors.separator }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? '#30d158' : colors.tertiaryLabel }} />
            <Text numberOfLines={1} style={{ flex: 1, ...type.caption, color: colors.secondaryLabel }}>
              {connected ? (pairing?.name ?? 'Connected') : 'Reconnecting…'}
            </Text>
            <Pressable
              hitSlop={8}
              onPress={() => {
                analytics.mobileUnpaired('user');
                void unpair().then(() => router.replace('/spaces'));
              }}
            >
              <Text style={{ ...type.caption, color: colors.destructive }}>Unpair</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <NavRow icon="sf:laptopcomputer" label="Connect your Mac" detail="Chat and Brain, on your phone" active={pathname === '/pairing'} onPress={() => go('/pairing')} />
        </>
      )}
    </View>
  );
}

/** A destination: glyph + label, tinted fill when it's where you are. */
function NavRow({ icon, label, detail, active, onPress }: { icon: string; label: string; detail?: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: detail ? 54 : 44,
        marginHorizontal: 8, paddingHorizontal: 10, borderRadius: 12, borderCurve: 'continuous',
        backgroundColor: active || pressed ? colors.secondaryBackground : 'transparent',
      })}
    >
      <View style={{ width: 24, alignItems: 'center' }}>
        <Image source={icon} style={{ width: 20, height: 20 }} contentFit="contain" tintColor={active ? colors.label : colors.secondaryLabel} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ ...type.body, fontWeight: active ? '600' : '400', color: colors.label }}>{label}</Text>
        {detail ? <Text numberOfLines={1} style={{ ...type.caption, color: colors.tertiaryLabel }}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}
