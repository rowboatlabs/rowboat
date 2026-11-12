import { router } from 'expo-router';
import { Image } from '@/components/sf-image';
import { Pressable, Text, View } from 'react-native';
import type { SearchResults } from '@rowboat/spaces-protocol';

import { useColors } from '@/theme/colors';

// The server's categorized search hits (harbor search.ts) as three sections —
// Messages, Discussions, Files — the web's search bar and ⌘K palette's shape.
// Shared by a space's own search screen and the Search tab, which searches
// every space you are in (2026-11-12): there `spaceName` labels each hit.

/** Where a hit opens: the chat params of the space it lives in. */
export type HitSpace = { title: string; kind?: 'direct' };

/** Mention tokens in a raw snippet read as their names: `[@Name](#member:…)` → `@Name`. */
export function plainSnippet(raw: string): string {
  return raw.replace(/\[(@[^\]]+)\]\(#(?:member:[^)]+|here)\)/g, '$1').replace(/\[(#[^\]]+)\]\(#space:[^)]+\)/g, '$1');
}

export function SearchHits({ results, org, me, spaceFor, showSpace }: {
  results: SearchResults;
  org: string;
  me: string;
  /** The hit's space, by id; a hit in a space not known here is left out. */
  spaceFor: (spaceId: string) => HitSpace | undefined;
  /** Label each hit with its space (the cross-space search). */
  showSpace?: boolean;
}) {
  const colors = useColors();
  const messages = results.messages.filter((h) => spaceFor(h.spaceId));
  const topics = results.topics.filter((h) => spaceFor(h.topic.spaceId));
  const assets = results.assets.filter((h) => spaceFor(h.spaceId));
  const where = (spaceId: string) => {
    if (!showSpace) return '';
    const s = spaceFor(spaceId);
    return s ? `${s.kind === 'direct' ? '' : '#'}${s.title} · ` : '';
  };
  const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const rowStyle = ({ pressed }: { pressed: boolean }) => ({
    marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10, borderCurve: 'continuous' as const,
    backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
  });
  const openThread = (spaceId: string, root: string, focus?: string) => {
    const s = spaceFor(spaceId)!;
    router.push({ pathname: '/spaces/thread', params: { org, space: spaceId, title: s.title, me, root, ...(focus ? { focus } : {}) } });
  };

  return (
    <View>
      {messages.length ? <SearchSection label="Messages" /> : null}
      {messages.map((hit) => (
        <Pressable key={hit.messageId} onPress={() => openThread(hit.spaceId, hit.threadRootId, hit.messageId)} style={(s) => ({ ...rowStyle(s), gap: 2 })}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: colors.tertiaryLabel }}>
            {where(hit.spaceId)}{hit.topicTitle ? `${hit.topicTitle} · ` : ''}{day(hit.postedAt)}
          </Text>
          <Text numberOfLines={3} style={{ fontSize: 15, lineHeight: 20, color: colors.label }}>{plainSnippet(hit.snippet)}</Text>
        </Pressable>
      ))}

      {topics.length ? <SearchSection label="Discussions" /> : null}
      {topics.map(({ topic }) => (
        <Pressable key={topic.id} onPress={() => openThread(topic.spaceId, topic.rootMessageId)} style={(s) => ({ ...rowStyle(s), flexDirection: 'row', alignItems: 'center', gap: 10 })}>
          <Image source="sf:bubble.left.and.bubble.right" style={{ width: 16, height: 16 }} tintColor={colors.secondaryLabel} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={2} style={{ fontSize: 15, color: colors.label }}>{topic.title}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.tertiaryLabel }}>
              {where(topic.spaceId)}{topic.archived ? 'Archived · ' : ''}{day(topic.createdAt)}
            </Text>
          </View>
        </Pressable>
      ))}

      {assets.length ? <SearchSection label="Files" /> : null}
      {assets.map((hit) => (
        <Pressable
          key={hit.id}
          onPress={() => router.push({ pathname: '/spaces/file', params: { org, space: hit.spaceId, assetId: hit.id, path: hit.path, title: hit.path.split('/').pop() ?? hit.path, mime: hit.blob?.mime ?? '' } })}
          style={(s) => ({ ...rowStyle(s), flexDirection: 'row', alignItems: 'center', gap: 10 })}
        >
          <Image source="sf:doc.text" style={{ width: 16, height: 16 }} tintColor={colors.secondaryLabel} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, color: colors.label }}>{hit.path}</Text>
            {showSpace ? <Text numberOfLines={1} style={{ fontSize: 12, color: colors.tertiaryLabel }}>{where(hit.spaceId).replace(/ · $/, '')}</Text> : null}
            {hit.snippet ? <Text numberOfLines={2} style={{ fontSize: 13, color: colors.secondaryLabel }}>{plainSnippet(hit.snippet)}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** True when the page holds no hit this screen can open. */
export function noHits(results: SearchResults, spaceFor: (spaceId: string) => HitSpace | undefined): boolean {
  return (
    !results.messages.some((h) => spaceFor(h.spaceId)) &&
    !results.topics.some((h) => spaceFor(h.topic.spaceId)) &&
    !results.assets.some((h) => spaceFor(h.spaceId))
  );
}

export function SearchSection({ label }: { label: string }) {
  const colors = useColors();
  return <Text style={{ fontSize: 13, fontWeight: '600', color: colors.secondaryLabel, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>{label}</Text>;
}
