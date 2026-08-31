import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { z } from 'zod';
import type { workspace as workspaceShared } from '@x/shared';

import { useConnection } from '@/lib/connection';
import { useColors } from '@/theme/colors';

type DirEntry = z.infer<typeof workspaceShared.DirEntry>;

// The Brain: the knowledge/ folder as a collapsible tree (read-only), the
// desktop sidebar's shape. Notes only (.md); folders collapse; edits on the
// Mac refresh the tree live over the WS.

interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  mtimeMs: number;
  children: TreeNode[];
}

function buildTree(entries: DirEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  const dirFor = (dirPath: string): TreeNode[] => {
    if (!dirPath) return root;
    let node = dirs.get(dirPath);
    if (!node) {
      const parent = dirFor(dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '');
      node = { name: dirPath.split('/').pop()!, path: dirPath, kind: 'dir', mtimeMs: 0, children: [] };
      dirs.set(dirPath, node);
      parent.push(node);
    }
    return node.children;
  };
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.path.endsWith('.md')) continue;
    // readdir('knowledge') returns workspace-root-relative paths — strip the
    // prefix for the tree; keep the full path for navigation.
    const rel = entry.path.startsWith('knowledge/') ? entry.path.slice('knowledge/'.length) : entry.path;
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    dirFor(dir).push({
      name: rel.split('/').pop()!.replace(/\.md$/, ''),
      path: entry.path,
      kind: 'file',
      mtimeMs: entry.stat?.mtimeMs ?? 0,
      children: [],
    });
  }
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
    nodes.forEach((n) => sortNodes(n.children));
    return nodes;
  };
  return sortNodes(root);
}

export default function BrainScreen() {
  const colors = useColors();
  const { rpc, events } = useConnection();
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!rpc) return;
    setLoading(true);
    try {
      // No allowedExtensions: core's filter skips DIRECTORIES that lack the
      // extension, so recursion never descends — filter .md client-side.
      const all = await rpc.call('workspace:readdir', {
        path: 'knowledge',
        opts: { recursive: true, includeStats: true },
      });
      setEntries(all);
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

  useEffect(() => {
    if (!events) return;
    const off = events.on('workspace:didChange', (payload) => {
      const e = payload as { path?: string; paths?: string[] };
      const touched = [e.path, ...(e.paths ?? [])].filter(Boolean) as string[];
      if (touched.length === 0 || touched.some((p) => p.startsWith('knowledge/'))) void refresh();
    });
    const offResync = events.onResync(() => void refresh());
    return () => {
      off();
      offResync();
    };
  }, [events, refresh]);

  const tree = useMemo(() => buildTree(entries), [entries]);

  const toggle = (path: string) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const pad = 12 + depth * 16;
    if (node.kind === 'dir') {
      const open = !collapsed.has(node.path);
      return (
        <View key={node.path}>
          <Pressable
            onPress={() => toggle(node.path)}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 8,
              paddingVertical: 9, paddingLeft: pad, paddingRight: 12,
              borderRadius: 8, borderCurve: 'continuous',
              backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
            })}
          >
            <Image
              source={open ? 'sf:chevron.down' : 'sf:chevron.right'}
              style={{ width: 11, height: 11 }}
              tintColor={colors.tertiaryLabel}
            />
            <Image source="sf:folder" style={{ width: 16, height: 16 }} tintColor={colors.secondaryLabel} />
            <Text style={{ fontSize: 15, fontWeight: '500', color: colors.label }} numberOfLines={1}>
              {node.name}
            </Text>
          </Pressable>
          {open && node.children.map((child) => renderNode(child, depth + 1))}
        </View>
      );
    }
    return (
      <Pressable
        key={node.path}
        onPress={() => router.push({ pathname: '/notes/view', params: { path: node.path } })}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingVertical: 9, paddingLeft: pad + 19, paddingRight: 12,
          borderRadius: 8, borderCurve: 'continuous',
          backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
        })}
      >
        <Image source="sf:doc.text" style={{ width: 15, height: 15 }} tintColor={colors.tertiaryLabel} />
        <Text style={{ flex: 1, fontSize: 15, color: colors.label }} numberOfLines={1}>
          {node.name}
        </Text>
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
    >
      {error && (
        <Text selectable style={{ color: colors.destructive, padding: 12 }}>
          {error}
        </Text>
      )}
      {!loading && !error && tree.length === 0 && (
        <Text style={{ textAlign: 'center', marginTop: 48, color: colors.tertiaryLabel }}>
          No notes yet — create one on your Mac.
        </Text>
      )}
      {tree.map((node) => renderNode(node, 0))}
    </ScrollView>
  );
}
