import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, useColorScheme, View } from 'react-native';
import type { z } from 'zod';
import type { workspace as workspaceShared } from '@x/shared';

import { StatusPill } from '@/components/status-pill';
import { useConnection } from '@/lib/connection';

type DirEntry = z.infer<typeof workspaceShared.DirEntry>;

// Read-only notes browser: the whole workspace tree, filtered to markdown,
// newest first. Sync dirs (config, events, sessions…) hold machine state,
// not notes — hide them.

const HIDDEN_ROOTS = new Set([
  'config', 'events', 'sessions', 'turns', 'runs', 'agents', 'apps',
  'skills', 'code-mode', 'index', 'server.lock',
]);

export default function NotesScreen() {
  const scheme = useColorScheme();
  const textColor = scheme === 'dark' ? '#fff' : '#000';
  const { rpc } = useConnection();
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!rpc) return;
    setLoading(true);
    try {
      const all = await rpc.call('workspace:readdir', {
        path: '',
        opts: { recursive: true, includeStats: true, allowedExtensions: ['.md'] },
      });
      const notes = all
        .filter((e) => e.kind === 'file' && !HIDDEN_ROOTS.has(e.path.split('/')[0]))
        .sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0));
      setEntries(notes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerRight: () => <StatusPill /> }} />
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={entries}
        keyExtractor={(item) => item.path}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push({ pathname: '/notes/view', params: { path: item.path } })}
          >
            <Text style={[styles.title, { color: textColor }]} numberOfLines={1}>
              {item.name.replace(/\.md$/, '')}
            </Text>
            <Text style={[styles.meta, { color: textColor }]} numberOfLines={1}>
              {item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : ''}
              {item.stat ? ` · ${new Date(item.stat.mtimeMs).toLocaleDateString()}` : ''}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={loading ? null : <Text style={styles.empty}>No notes found.</Text>}
      />
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
  meta: { fontSize: 12, opacity: 0.6 },
  empty: { textAlign: 'center', marginTop: 48, opacity: 0.6, color: '#888' },
  error: { color: '#c0392b', padding: 12 },
});
