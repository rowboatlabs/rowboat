import { Stack, router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { ActivityItem, ActivityPage } from '@rowboat/spaces-protocol';
import { spaces } from '@x/shared';

import { useSpacesAccount, type SpacesOrg } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { Avatar } from '@/components/avatar';
import { StatusBanner } from '@/components/status-banner';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

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

export default function ActivityScreen({ embedded, bottomPad }: { embedded?: boolean; bottomPad?: number } = {}) {
  const colors = useColors();
  const account = useSpacesAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [clearing, setClearing] = useState(false);
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

  // readAll on every org, then repaint — the server owns read state.
  const markAllRead = async () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setClearing(true);
    try {
      await Promise.all(
        (account.orgs ?? []).map((org) => new SpacesClient({ baseUrl: `https://${org.address}`, token: account.getAccessToken }).readAll()),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  };
  const anyUnread = rows?.some((r) => r.item.unread) ?? false;

  const open = (row: Row) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    const base = { org: row.org.address, space: row.item.spaceId, me: row.org.memberId, title: row.item.spaceName };
    if (row.item.threadRootId) {
      router.push({ pathname: '/spaces/thread', params: { ...base, root: row.item.threadRootId, focus: 'latest' } });
    } else if (row.item.kind === 'reaction' || row.item.message.replyCount > 0) {
      router.push({ pathname: '/spaces/thread', params: { ...base, root: row.item.message.id } });
    } else {
      router.push({ pathname: '/spaces/chat', params: base });
    }
  };

  // Grouped by day, like a notification list: Today, Yesterday, Earlier.
  const groups = useMemo(() => {
    const out: { label: string; rows: Row[] }[] = [];
    for (const row of visible ?? []) {
      const label = dayLabel(row.item.at);
      const last = out.at(-1);
      if (last && last.label === label) last.rows.push(row);
      else out.push({ label, rows: [row] });
    }
    return out;
  }, [visible]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: 8, paddingBottom: embedded ? (bottomPad ?? 24) : 24, gap: 20 }}
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
      <Stack.Screen
        options={{
          headerRight: () =>
            anyUnread ? (
              <Pressable hitSlop={10} disabled={clearing} onPress={() => void markAllRead()} style={{ opacity: clearing ? 0.5 : 1, paddingHorizontal: 6 }}>
                <Text style={{ ...type.body, color: colors.label }}>Mark all read</Text>
              </Pressable>
            ) : null,
        }}
      />
      {/* Filters: the selected one is filled, the rest sit on the card colour. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                setFilter(f.key);
              }}
              style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: on ? colors.label : colors.card }}
            >
              <Text style={{ ...type.caption, fontWeight: '600', color: on ? colors.background : colors.secondaryLabel }}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <StatusBanner error={error} offlineText="You're offline. Activity will update when you're back online." onRetry={() => void load()} />
      {rows === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {visible?.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 56, gap: 6, paddingHorizontal: 32 }}>
          <Image source="sf:bell.slash" style={{ width: 30, height: 30, marginBottom: 6 }} tintColor={colors.tertiaryLabel} />
          <Text style={{ ...type.bodyStrong, color: colors.label }}>You're all caught up</Text>
          <Text style={{ ...type.caption, textAlign: 'center', color: colors.tertiaryLabel }}>Mentions, replies and reactions show up here.</Text>
        </View>
      ) : null}
      {groups.map((group) => (
        <View key={group.label} style={{ gap: 8, paddingHorizontal: 16 }}>
          <Text style={{ ...type.section, color: colors.secondaryLabel, paddingHorizontal: 16 }}>{group.label}</Text>
          <View style={{ borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.card }}>
            {group.rows.map((row, i) => (
              <ActivityRow key={`${row.org.id}:${row.item.id}`} row={row} first={i === 0} onPress={() => open(row)} />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const KIND_ICON: Record<ActivityItem['kind'], string> = {
  mention: 'sf:at',
  here: 'sf:megaphone',
  dm: 'sf:envelope',
  reply: 'sf:arrowshape.turn.up.left',
  reaction: 'sf:face.smiling',
};

/** One activity: who, when, what they did and where, then the words. */
function ActivityRow({ row, first, onPress }: { row: Row; first: boolean; onPress: () => void }) {
  const colors = useColors();
  const { item, names } = row;
  const nameMap = useMemo(() => new Map(Object.entries(names)), [names]);
  const actorId = item.actors[0]?.memberId ?? '';
  const actor = names[actorId] ?? 'Someone';
  const others = item.actors.length - 1;
  const who = others > 0 ? `${actor} +${others}` : actor;
  const where = item.spaceKind === 'direct' ? 'Direct message' : `#${item.spaceName}`;
  const headline =
    item.kind === 'reaction'
      ? `Reacted ${item.emoji ?? ''}`
      : item.kind === 'reply'
        ? 'Replied in a thread'
        : item.kind === 'here'
          ? 'Mentioned everyone'
          : item.kind === 'dm'
            ? 'Messaged you'
            : 'Mentioned you';
  const excerpt = plainText(spaces.resolveMentions(item.message.body, nameMap));

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? colors.secondaryBackground : 'transparent' })}>
      {first ? null : <View style={{ height: 0.5, marginLeft: 62, backgroundColor: colors.separator }} />}
      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
        <Avatar id={actorId} name={actor} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, ...type.body, fontWeight: item.unread ? '700' : '600', color: colors.label }}>{who}</Text>
            <Text style={{ ...type.caption, color: colors.tertiaryLabel, fontVariant: ['tabular-nums'] }}>{timeAgo(item.at)}</Text>
            {item.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#0a84ff' }} /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Image source={KIND_ICON[item.kind]} style={{ width: 12, height: 12 }} contentFit="contain" tintColor={colors.tertiaryLabel} />
            <Text numberOfLines={1} style={{ flex: 1, ...type.caption, color: colors.tertiaryLabel }}>
              {headline} · {where}
            </Text>
          </View>
          <Text numberOfLines={2} style={{ ...type.body, lineHeight: 21, paddingTop: 2, color: item.unread ? colors.label : colors.secondaryLabel }}>
            {excerpt || '(attachment)'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Today, Yesterday, or Earlier — by the phone's calendar day. */
function dayLabel(iso: string): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(new Date(iso))) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier';
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
