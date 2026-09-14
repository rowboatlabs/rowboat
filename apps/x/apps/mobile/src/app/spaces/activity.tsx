import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { ActivityItem, ActivityPage } from '@rowboat/spaces-protocol';
import { spaces } from '@x/shared';

import { useSpacesAccount, type SpacesOrg } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { useColors } from '@/theme/colors';

// Activity (desktop activity-view.tsx for parity): everything that involves
// you across every space — mentions, @here, DMs, replies in threads you
// follow, reactions on your messages — newest first, from GET /v1/activity.
// The page carries names for everyone on it, so no roster calls. Tap opens
// the conversation; reading there clears the unread mark.


type Filter = 'all' | 'mentions' | 'threads' | 'reactions';
const FILTERS: { key: Filter; label: string; kinds?: ActivityItem['kind'][] }[] = [
  { key: 'all', label: 'All' },
  { key: 'mentions', label: 'Mentions', kinds: ['mention', 'here', 'dm'] },
  { key: 'threads', label: 'Threads', kinds: ['reply'] },
  { key: 'reactions', label: 'Reactions', kinds: ['reaction'] },
];

interface Row {
  org: SpacesOrg;
  item: ActivityItem;
  names: Record<string, string>;
}

export default function ActivityScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const visible = useMemo(() => rows?.filter((r) => FILTERS.find((f) => f.key === filter)!.kinds?.includes(r.item.kind) ?? true) ?? null, [rows, filter]);

  const load = useCallback(async () => {
    const orgs = account.orgs ?? [];
    try {
      const pages = await Promise.all(
        orgs.map(async (org) => {
          const client = new SpacesClient({ baseUrl: `https://${org.address}`, token: account.getAccessToken });
          const page: ActivityPage = await client.activity({ limit: 50 });
          return page.items.map((item) => ({ org, item, names: page.names }));
        }),
      );
      setRows(pages.flat().sort((a, b) => (a.item.at < b.item.at ? 1 : -1)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [account.orgs, account.getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (row: Row) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    const base = { org: row.org.address, space: row.item.spaceId, me: row.org.memberId, title: row.item.spaceName };
    if (row.item.threadRootId) {
      router.push({ pathname: '/spaces/thread', params: { ...base, root: row.item.threadRootId } });
    } else if (row.item.kind === 'reaction' || row.item.message.replyCount > 0) {
      router.push({ pathname: '/spaces/thread', params: { ...base, root: row.item.message.id } });
    } else {
      router.push({ pathname: '/spaces/chat', params: base });
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {/* Slack's filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}>
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                setFilter(f.key);
              }}
              style={{
                paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
                backgroundColor: on ? colors.label : colors.secondaryBackground,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: on ? colors.background : colors.label }}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {error ? <Text selectable style={{ fontSize: 13, color: colors.destructive, paddingHorizontal: 16 }}>{error}</Text> : null}
      {rows === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {visible?.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 72, gap: 8 }}>
          <Image source="sf:bell.slash" style={{ width: 32, height: 32 }} tintColor={colors.tertiaryLabel} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.secondaryLabel }}>You're all caught up</Text>
          <Text style={{ fontSize: 13, color: colors.tertiaryLabel }}>Mentions, replies and reactions show up here.</Text>
        </View>
      ) : null}
      {visible?.map((row, i) => (
        <ActivityRow key={`${row.org.id}:${row.item.id}`} row={row} first={i === 0} onPress={() => open(row)} />
      ))}
    </ScrollView>
  );
}

// Deterministic avatar tint (the chat rows' trick).
const HUES = [211, 32, 145, 262, 90, 340, 174, 20];
function avatarColor(id: string, dark: boolean): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${HUES[h % HUES.length]}, 45%, ${dark ? 32 : 82}%)`;
}

const KIND_ICON: Record<ActivityItem['kind'], string> = {
  mention: 'sf:at',
  here: 'sf:megaphone',
  dm: 'sf:envelope',
  reply: 'sf:bubble.left.and.bubble.right',
  reaction: 'sf:face.smiling',
};

function ActivityRow({ row, first, onPress }: { row: Row; first: boolean; onPress: () => void }) {
  const colors = useColors();
  const dark = colors.background === '#000000';
  const { item, names } = row;
  const nameMap = useMemo(() => new Map(Object.entries(names)), [names]);
  const actorId = item.actors[0]?.memberId ?? '';
  const actor = names[actorId] ?? 'Someone';
  const others = item.actors.length - 1;
  const who = others > 0 ? `${actor} +${others}` : actor;
  const where = item.spaceKind === 'direct' ? 'Direct message' : `#${item.spaceName}`;
  const headline =
    item.kind === 'reaction'
      ? `Reacted ${item.emoji ?? ''} to your message`
      : item.kind === 'reply'
        ? 'Replied in thread'
        : item.kind === 'here'
          ? 'Mentioned everyone'
          : item.kind === 'dm'
            ? 'Sent you a message'
            : 'Mentioned you';
  const excerpt = plainText(spaces.resolveMentions(item.message.body, nameMap));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
        borderTopWidth: first ? 0 : 0.5, borderTopColor: colors.separator,
        backgroundColor: pressed ? colors.secondaryBackground : item.unread ? (dark ? 'rgba(10,132,255,0.06)' : 'rgba(10,132,255,0.05)') : 'transparent',
      })}
    >
      <View
        style={{
          width: 40, height: 40, borderRadius: 10, borderCurve: 'continuous',
          alignItems: 'center', justifyContent: 'center', backgroundColor: avatarColor(actorId, dark),
        }}
      >
        <Text style={{ fontSize: 17, fontWeight: '600', color: colors.label }}>{(actor[0] ?? '?').toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Image source={KIND_ICON[item.kind]} style={{ width: 12, height: 12 }} tintColor={colors.tertiaryLabel} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: colors.tertiaryLabel }}>
            {headline} · {where}
          </Text>
          <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>{timeAgo(item.at)}</Text>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: item.unread ? '700' : '600', color: colors.label }}>{who}</Text>
        <Text numberOfLines={2} style={{ fontSize: 15, lineHeight: 20, color: item.unread ? colors.label : colors.secondaryLabel }}>
          {excerpt || '(attachment)'}
        </Text>
      </View>
      {item.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 4, backgroundColor: '#0a84ff' }} /> : null}
    </Pressable>
  );
}

/** Markdown → one line of plain text for a preview row. */
function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '(image)')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
