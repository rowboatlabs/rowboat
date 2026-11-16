import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { Member, Message, TopicListing } from '@rowboat/spaces-protocol';
import { spaces } from '@x/shared';

import { Glyph, Group, Row } from '@/components/grouped';
import { Image } from '@/components/sf-image';
import { loadRoster, peekRoster } from '@/lib/spaces/cache';
import { useOrgClient } from '@/lib/spaces/invites';
import { loadPinned } from '@/lib/spaces/pins';
import { memberLabel } from '@/lib/spaces/profiles';
import { removeSaved, useSaved } from '@/lib/spaces/saved';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Pinned and saved (2026-11-13, the desktop's bookmarks panel): two lists of
// messages in one space. Pinned is shared — anyone's 📌, the whole space sees
// the same list. Saved is yours, on this phone only. A row opens the message's
// thread.

/** One line of a message: names for mention tokens, markdown scaffolding and images dropped. */
function excerpt(body: string, memberNames: ReadonlyMap<string, string>, max = 140): string {
  const flat = spaces
    .resolveMentions(body, memberNames)
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/^[ \t]*>.*$/gm, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[`*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat || '(attachment)';
}

export default function SavedScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; space: string; title?: string; me: string; tab?: string }>();
  const { org, space, me } = params;
  const client = useOrgClient(org);
  const [tab, setTab] = useState<'pinned' | 'saved'>(params.tab === 'saved' ? 'saved' : 'pinned');
  const [pinned, setPinned] = useState<Message[] | null>(null);
  const [topics, setTopics] = useState<TopicListing[]>([]);
  const [roster, setRoster] = useState<Member[]>(() => peekRoster(org, space) ?? []);
  const saved = useSaved(org, space);

  useEffect(() => {
    let cancelled = false;
    void loadRoster(org, space).then((r) => !cancelled && r && setRoster((prev) => (prev.length ? prev : r)));
    client.listMembers(space).then((r) => !cancelled && setRoster(r)).catch(() => {});
    client.listTopics(space).then((t) => !cancelled && setTopics(t)).catch(() => {});
    void loadPinned(client, space).then((p) => !cancelled && setPinned(p));
    return () => {
      cancelled = true;
    };
  }, [client, org, space]);

  const memberNames = useMemo(() => new Map(roster.map((m) => [m.id, memberLabel(m)])), [roster]);
  const nameOf = (id: string) => (id === me ? 'You' : memberNames.get(id) ?? 'Unknown member');
  const where = (rootId: string) => {
    const topic = topics.find((t) => t.rootMessageId === rootId);
    return topic ? spaces.resolveMentions(topic.title, memberNames) : 'Messages';
  };
  const open = (rootId: string) =>
    router.push({ pathname: '/spaces/thread', params: { org, space, root: rootId, title: params.title ?? 'Thread', me } });
  const when = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

  const rows =
    tab === 'pinned'
      ? (pinned ?? []).map((m) => ({ id: m.id, root: m.threadRoot ?? m.id, author: m.author.memberId, body: m.body, postedAt: m.postedAt }))
      : saved.map((s) => ({ id: s.messageId, root: s.threadRootId, author: s.authorId, body: s.body, postedAt: s.postedAt }));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
    >
      <Stack.Screen options={{ title: 'Pinned and saved' }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['pinned', 'saved'] as const).map((t) => {
          const on = t === tab;
          return (
            <Pressable
              key={t}
              onPress={() => {
                if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                setTab(t);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? colors.label : colors.card }}
            >
              <Image source={t === 'pinned' ? 'sf:pin' : 'sf:bookmark'} style={{ width: 13, height: 13 }} tintColor={on ? colors.background : colors.label} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: on ? colors.background : colors.label }}>
                {t === 'pinned' ? `Pinned${pinned ? ` ${pinned.length}` : ''}` : `Saved ${saved.length}`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'pinned' && pinned === null ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : rows.length === 0 ? (
        <Text style={{ ...type.caption, lineHeight: 18, color: colors.secondaryLabel, paddingHorizontal: 4 }}>
          {tab === 'pinned'
            ? 'Nothing pinned. Long-press a message and choose Pin message. Pins are shared with everyone in the space.'
            : 'Nothing saved. Long-press a message and choose Save for later. Saved messages are just for you, on this phone.'}
        </Text>
      ) : (
        <Group footer={tab === 'saved' ? 'Saved messages stay on this phone. They don’t sync with the desktop app.' : undefined}>
          {rows.map((r, i) => (
            <Row key={r.id} first={i === 0} onPress={() => open(r.root)}>
              <Glyph icon={tab === 'pinned' ? 'sf:pin' : 'sf:bookmark'} />
              <View style={{ flex: 1, paddingVertical: 10, gap: 2 }}>
                <Text numberOfLines={1} style={{ ...type.caption, color: colors.secondaryLabel }}>
                  <Text style={{ fontWeight: '600', color: colors.label }}>{nameOf(r.author)}</Text>
                  {`  ${when(r.postedAt)} · ${where(r.root)}`}
                </Text>
                <Text numberOfLines={3} style={{ ...type.body, color: colors.label }}>{excerpt(r.body, memberNames)}</Text>
              </View>
              {tab === 'saved' ? (
                <Pressable hitSlop={10} accessibilityLabel="Remove from saved" onPress={() => void removeSaved(org, space, r.id)}>
                  <Image source="sf:xmark.circle.fill" style={{ width: 18, height: 18 }} tintColor={colors.tertiaryLabel} />
                </Pressable>
              ) : null}
            </Row>
          ))}
        </Group>
      )}
    </ScrollView>
  );
}
