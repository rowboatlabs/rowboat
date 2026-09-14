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

const KIND_LABEL: Record<ActivityItem['kind'], string> = {
  mention: 'mentioned you',
  here: 'mentioned everyone',
  dm: 'messaged you',
  reply: 'replied',
  reaction: 'reacted',
};

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
      contentContainerStyle={{ paddingVertical: 8 }}
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
      {error ? <Text selectable style={{ fontSize: 13, color: colors.destructive, paddingHorizontal: 16 }}>{error}</Text> : null}
      {rows === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {rows?.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 64, gap: 8 }}>
          <Image source="sf:bell.slash" style={{ width: 32, height: 32 }} tintColor={colors.tertiaryLabel} />
          <Text style={{ fontSize: 14, color: colors.tertiaryLabel }}>Nothing for you yet.</Text>
        </View>
      ) : null}
      {rows?.map((row) => <ActivityRow key={`${row.org.id}:${row.item.id}`} row={row} onPress={() => open(row)} />)}
    </ScrollView>
  );
}

function ActivityRow({ row, onPress }: { row: Row; onPress: () => void }) {
  const colors = useColors();
  const { item, names } = row;
  const nameMap = useMemo(() => new Map(Object.entries(names)), [names]);
  const actor = names[item.actors[0]?.memberId ?? ''] ?? 'Someone';
  const others = item.actors.length - 1;
  const who = others > 0 ? `${actor} and ${others} other${others > 1 ? 's' : ''}` : actor;
  const verb = item.kind === 'reaction' ? `reacted ${item.emoji ?? ''}` : KIND_LABEL[item.kind];
  const where = item.spaceKind === 'direct' ? 'in your DM' : `in #${item.spaceName}`;
  const excerpt = spaces.resolveMentions(item.message.body, nameMap).replace(/\s+/g, ' ').trim();
  const when = timeAgo(item.at);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: 10, marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 10,
        borderRadius: 10, borderCurve: 'continuous',
        backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
      })}
    >
      <View style={{ width: 8, alignItems: 'center', paddingTop: 7 }}>
        {item.unread ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#ff453a' }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: colors.secondaryLabel }}>
          <Text style={{ fontWeight: '600', color: colors.label }}>{who}</Text> {verb} {where} · {when}
        </Text>
        <Text numberOfLines={2} style={{ fontSize: 15, lineHeight: 20, color: item.unread ? colors.label : colors.secondaryLabel }}>
          {excerpt || '(no text)'}
        </Text>
      </View>
    </Pressable>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
