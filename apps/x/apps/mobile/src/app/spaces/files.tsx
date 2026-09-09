import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { SpacesLive } from '@/lib/spaces/live';
import { useColors } from '@/theme/colors';

// A space's files (S3, read-only): entries grouped into a collapsible tree on
// '/' (folders are display only — same shape as the Brain tree). Changesets
// arriving over the WS refresh the listing.

interface Entry {
  path: string;
  updatedAt: string;
  mime?: string;
}

interface Node {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  entry?: Entry;
  children: Node[];
}

function buildTree(entries: Entry[]): Node[] {
  const root: Node = { name: '', path: '', kind: 'dir', children: [] };
  for (const entry of entries) {
    const parts = entry.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const leaf = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part && c.kind === (leaf ? 'file' : 'dir'));
      if (!child) {
        child = { name: part, path: parts.slice(0, i + 1).join('/'), kind: leaf ? 'file' : 'dir', children: [] };
        if (leaf) child.entry = entry;
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: Node[]): Node[] => {
    nodes.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
    nodes.forEach((n) => sort(n.children));
    return nodes;
  };
  return sort(root.children);
}

export default function SpaceFilesScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const params = useLocalSearchParams<{ org: string; space: string; title: string }>();
  const { org, space, title } = params;

  const client = useMemo(
    () => new SpacesClient({ baseUrl: `https://${org}`, token: (opts) => account.getAccessToken(opts) }),
    [org, account],
  );

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const result = await client.listAssets(space);
      setEntries(result.map((e) => ({ path: e.path, updatedAt: e.updatedAt, mime: e.blob?.mime })));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, space]);

  useEffect(() => {
    void refresh().then(() => {
      loaded.current = true;
    });
  }, [refresh]);

  // A changeset means some file changed — refetch the cheap listing.
  useEffect(() => {
    const live = new SpacesLive({ baseUrl: `https://${org}`, token: () => account.getAccessToken() });
    const off = live.subscribe(space, (frame) => {
      if (frame.kind === 'event' && frame.event.type === 'change' && loaded.current) void refresh();
    });
    return () => {
      off();
      live.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one socket per screen
  }, [org, space]);

  const tree = useMemo(() => buildTree(entries ?? []), [entries]);

  const open = (node: Node) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    router.push({ pathname: '/spaces/file', params: { org, space, path: node.path, title: node.name, mime: node.entry?.mime ?? '' } });
  };

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNodes = (nodes: Node[], depth: number): React.ReactNode =>
    nodes.map((node) => (
      <View key={`${node.kind}:${node.path}`}>
        <Pressable
          onPress={() => (node.kind === 'dir' ? toggle(node.path) : open(node))}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingVertical: 10, paddingRight: 16, paddingLeft: 16 + depth * 18,
            backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
          })}
        >
          <Image
            source={node.kind === 'dir' ? (collapsed.has(node.path) ? 'sf:chevron.right' : 'sf:chevron.down') : fileIcon(node)}
            style={{ width: node.kind === 'dir' ? 12 : 16, height: node.kind === 'dir' ? 12 : 16 }}
            tintColor={node.kind === 'dir' ? colors.tertiaryLabel : colors.secondaryLabel}
          />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: colors.label, fontWeight: node.kind === 'dir' ? '600' : '400' }}>
            {node.name}
          </Text>
        </Pressable>
        {node.kind === 'dir' && !collapsed.has(node.path) ? renderNodes(node.children, depth + 1) : null}
      </View>
    ));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingVertical: 8 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void refresh().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Stack.Screen options={{ title: title ? `${title} files` : 'Files' }} />
      {error ? <Text style={{ fontSize: 13, color: colors.destructive, paddingHorizontal: 16, paddingBottom: 8 }}>{error}</Text> : null}
      {entries === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {entries !== null ? renderNodes(tree, 0) : null}
      {entries?.length === 0 ? (
        <Text style={{ textAlign: 'center', marginTop: 48, fontSize: 14, color: colors.tertiaryLabel }}>No files yet.</Text>
      ) : null}
    </ScrollView>
  );
}

function fileIcon(node: Node): string {
  const mime = node.entry?.mime ?? '';
  if (mime.startsWith('image/')) return 'sf:photo';
  if (node.name.endsWith('.md')) return 'sf:doc.text';
  if (mime) return 'sf:doc';
  return 'sf:doc.text';
}
