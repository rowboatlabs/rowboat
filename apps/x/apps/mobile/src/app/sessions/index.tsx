import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Button, FlatList, Pressable, RefreshControl, StyleSheet, Text, useColorScheme, View } from 'react-native';
import type { sessions as sessionsShared } from '@x/shared';

import * as analytics from '@/lib/analytics';
import { StatusPill } from '@/components/status-pill';
import { useConnection } from '@/lib/connection';

type Entry = sessionsShared.SessionIndexEntry;

export default function SessionsScreen() {
  const scheme = useColorScheme();
  const textColor = scheme === 'dark' ? '#fff' : '#000';
  const { sessions, events, unpair } = useConnection();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessions) return;
    setLoading(true);
    try {
      const result = await sessions.list();
      setEntries(
        [...result.sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessions]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    if (!events) return;
    const offEvents = events.on('sessions:events', () => void refresh());
    const offResync = events.onResync(() => void refresh());
    return () => {
      offEvents();
      offResync();
    };
  }, [events, refresh]);

  const newChat = useCallback(async () => {
    if (!sessions) return;
    const { sessionId } = await sessions.create({});
    router.push({ pathname: '/sessions/[id]', params: { id: sessionId } });
  }, [sessions]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => <StatusPill />,
          headerLeft: () => (
            <Button
              title="Unpair"
              onPress={() => {
                analytics.mobileUnpaired('user');
                void unpair().then(() => router.replace('/pairing'));
              }}
            />
          ),
        }}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={entries}
        keyExtractor={(item) => item.sessionId}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push({ pathname: '/sessions/[id]', params: { id: item.sessionId } })}
          >
            <Text style={[styles.title, { color: textColor }]} numberOfLines={1}>
              {item.title || 'Untitled chat'}
            </Text>
            <Text style={[styles.meta, { color: textColor }]}>
              {new Date(item.updatedAt).toLocaleString()} · {item.turnCount} turn
              {item.turnCount === 1 ? '' : 's'}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? null : <Text style={styles.empty}>No chats yet — start one below.</Text>
        }
      />
      <View style={styles.footer}>
        <Button title="New chat" onPress={() => void newChat()} />
        <Button title="Notes" onPress={() => router.push('/notes')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#8884',
    gap: 2,
  },
  title: { fontSize: 16, fontWeight: '500' },
  meta: { fontSize: 12, opacity: 0.55 },
  empty: { textAlign: 'center', marginTop: 48, opacity: 0.6, color: '#888' },
  error: { color: '#c0392b', padding: 12 },
  footer: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8 },
});
