import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { sessions as sessionsShared } from '@x/shared';

import * as analytics from '@/lib/analytics';
import { useConnection } from '@/lib/connection';
import { useColors } from '@/theme/colors';

type Entry = sessionsShared.SessionIndexEntry;

// The drawer: chat history + search up top, Brain and the connection row at
// the foot — the Claude-app sidebar, minimal.
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
      setEntries([...result.sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
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
    router.replace({ pathname: '/', params: id ? { id } : { id: '' } });
    props.navigation.closeDrawer();
  };

  const connected = status === 'connected';

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 8, backgroundColor: colors.background }}>
      {/* Search + new chat */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
        <View
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: colors.secondaryBackground, borderRadius: 10,
            borderCurve: 'continuous', paddingHorizontal: 10, height: 36,
          }}
        >
          <Image source="sf:magnifyingglass" style={{ width: 14, height: 14 }} tintColor={colors.tertiaryLabel} />
          <TextInput
            style={{ flex: 1, fontSize: 15, color: colors.label }}
            placeholder="Search"
            placeholderTextColor={colors.tertiaryLabel}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
        </View>
        <Pressable hitSlop={8} onPress={() => openChat()}>
          <Image source="sf:square.and.pencil" style={{ width: 22, height: 22 }} tintColor={colors.label} />
        </Pressable>
      </View>

      {/* History */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.sessionId}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openChat(item.sessionId)}
            style={({ pressed }) => ({
              paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8, borderCurve: 'continuous',
              backgroundColor: pressed ? (colors.secondaryBackground) : 'transparent',
            })}
          >
            <Text numberOfLines={1} style={{ fontSize: 15, color: colors.label }}>
              {item.title || 'New chat'}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', marginTop: 32, fontSize: 14, color: colors.tertiaryLabel }}>
            {query ? 'No matches' : 'No chats yet'}
          </Text>
        }
      />

      {/* Foot: Brain, then the connection row */}
      <View style={{ borderTopWidth: 0.5, borderTopColor: colors.separator, paddingTop: 6, paddingBottom: insets.bottom + 8, paddingHorizontal: 8, gap: 2 }}>
        <FootRow
          icon="sf:brain"
          label="Brain"
          onPress={() => {
            router.push('/notes');
            props.navigation.closeDrawer();
          }}
        />
        <FootRow
          icon={connected ? 'sf:laptopcomputer' : 'sf:wifi.slash'}
          label={connected ? (pairing?.name ?? 'Connected') : 'Reconnecting…'}
          detail="Unpair"
          detailColor={colors.destructive}
          onDetail={() => {
            analytics.mobileUnpaired('user');
            void unpair().then(() => router.replace('/pairing'));
          }}
        />
      </View>
    </View>
  );
}

function FootRow({ icon, label, onPress, detail, detailColor, onDetail }: {
  icon: string;
  label: string;
  onPress?: () => void;
  detail?: string;
  detailColor?: string;
  onDetail?: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8, borderCurve: 'continuous',
        backgroundColor: pressed && onPress ? (colors.secondaryBackground) : 'transparent',
      })}
    >
      <Image source={icon} style={{ width: 18, height: 18 }} tintColor={colors.secondaryLabel} />
      <Text style={{ flex: 1, fontSize: 15, color: colors.label }}>{label}</Text>
      {detail ? (
        <Pressable hitSlop={8} onPress={onDetail}>
          <Text style={{ fontSize: 13, color: detailColor ?? (colors.secondaryLabel) }}>{detail}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}
