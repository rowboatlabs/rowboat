import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text } from 'react-native';
import type { Member, Message, TopicListing, UnreadSnapshot } from '@rowboat/spaces-protocol';
import { spaces } from '@x/shared';

import { ThreadFilterBar, ThreadRows, ThreadsEmpty } from '@/components/thread-list';
import { ThreadOptionsSheet } from '@/components/thread-options';
import { StatusBanner } from '@/components/status-banner';
import { loadRoster, peekRoster, saveRoster, seedThreadRoot } from '@/lib/spaces/cache';
import { useOrgClient } from '@/lib/spaces/invites';
import { memberLabel } from '@/lib/spaces/profiles';
import {
  DEFAULT_FILTERS,
  loadFilters,
  participantsOf,
  saveFilters,
  spaceThreadRows,
  threadLabelOf,
  type ThreadItem,
  type ThreadsFilters,
} from '@/lib/spaces/threads';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// One space's threads (2026-11-13, the web's Threads tab,
// space-threads-view.tsx): every conversation in the space, not only the
// named ones. All / Named / Sessions / By me, Active / Archived, and people,
// kept for this space on this phone. Unnamed threads come from the stream's
// loaded window, so "Load older threads" pages the stream; the archived list
// loads whole. Opened from the space's header.
export default function SpaceThreadsScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; space: string; title?: string; me: string }>();
  const { org, space, me } = params;
  const client = useOrgClient(org);
  const memoryKey = `${org}:${space}`;

  const [filters, setFiltersState] = useState<ThreadsFilters>(DEFAULT_FILTERS);
  useEffect(() => {
    let cancelled = false;
    void loadFilters(memoryKey).then((saved) => !cancelled && setFiltersState(saved));
    return () => {
      cancelled = true;
    };
  }, [memoryKey]);
  const setFilters = (next: ThreadsFilters) => {
    setFiltersState(next);
    saveFilters(memoryKey, next);
  };

  const [topics, setTopics] = useState<TopicListing[] | null>(null);
  const [roots, setRoots] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [archivedPlain, setArchivedPlain] = useState<Message[]>([]);
  const [unread, setUnread] = useState<UnreadSnapshot | null>(null);
  const [members, setMembers] = useState<Map<string, Member>>(() => new Map((peekRoster(org, space) ?? []).map((m) => [m.id, m])));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [options, setOptions] = useState<ThreadItem | null>(null);
  // Once older pages are in, whether there are more is theirs to say.
  const pagedOlder = useRef(false);

  const load = useCallback(async () => {
    try {
      const [topicList, stream] = await Promise.all([client.listTopics(space, true), client.listStream(space)]);
      setTopics(topicList);
      // Keep older pages already loaded: the newest page replaces only its own window.
      setRoots((prev) => {
        const oldest = stream.messages[0]?.offset ?? Infinity;
        return [...(prev ?? []).filter((m) => m.offset < oldest), ...stream.messages];
      });
      if (!pagedOlder.current) setHasMore(stream.hasMore);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // An older Harbor has no such route: nothing archived to show.
    client.listArchivedThreads(space).then(setArchivedPlain).catch(() => {});
    client.unread().then(setUnread).catch(() => {});
  }, [client, space]);

  useEffect(() => {
    let cancelled = false;
    void loadRoster(org, space).then((roster) => {
      if (!cancelled && roster) setMembers((prev) => (prev.size ? prev : new Map(roster.map((m) => [m.id, m]))));
    });
    client
      .listMembers(space)
      .then((list) => {
        if (cancelled) return;
        setMembers(new Map(list.map((m) => [m.id, m])));
        saveRoster(org, space, list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, org, space]);

  // On open, and coming back from a thread: its replies, marks and options may have moved.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadOlder = async () => {
    const oldest = roots?.[0]?.offset;
    if (oldest === undefined || loadingOlder) return;
    pagedOlder.current = true;
    setLoadingOlder(true);
    try {
      const page = await client.listStream(space, { beforeOffset: oldest });
      setRoots((prev) => [...page.messages.filter((m) => !(prev ?? []).some((p) => p.id === m.id)), ...(prev ?? [])]);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOlder(false);
    }
  };

  const nameOf = useCallback((id: string) => {
    const m = members.get(id);
    return m ? memberLabel(m) : 'Unknown member';
  }, [members]);
  const memberNames = useMemo(() => new Map([...members].map(([id, m]) => [id, memberLabel(m)])), [members]);

  const loaded = topics !== null && roots !== null;
  const allRows = useMemo(
    () => spaceThreadRows(topics ?? [], roots ?? [], archivedPlain, filters.kind, filters.archived, me),
    [topics, roots, archivedPlain, filters.kind, filters.archived, me],
  );
  const rows = filters.people.length ? allRows.filter((r) => participantsOf(r.root).some((id) => filters.people.includes(id))) : allRows;
  const archivedCount = useMemo(() => spaceThreadRows(topics ?? [], [], archivedPlain, filters.kind, true, me).length, [topics, archivedPlain, filters.kind, me]);
  const people = useMemo(() => [...new Set(allRows.flatMap((r) => participantsOf(r.root)))], [allRows]);
  const unreadOf = (rootId: string) => unread?.spaces.find((s) => s.spaceId === space)?.threads.find((t) => t.rootMessageId === rootId);

  const items: ThreadItem[] = rows.map(({ rootMessageId, topic, root, activityAt }) => {
    const u = unreadOf(rootMessageId);
    return {
      spaceId: space,
      rootMessageId,
      root,
      topic,
      activityAt,
      title: spaces.resolveMentions(topic?.title ?? root?.session?.title ?? threadLabelOf(root?.body ?? ''), memberNames),
      people: participantsOf(root),
      unread: u?.unreadReplies ?? 0,
      forYou: u?.unreadMentions ?? 0,
    };
  });

  const open = (item: ThreadItem) => {
    if (item.root) seedThreadRoot(org, space, item.root);
    router.push({ pathname: '/spaces/thread', params: { org, space, root: item.rootMessageId, title: params.title ?? 'Thread', me } });
  };

  const pagesStream = filters.kind !== 'named' && !filters.archived;
  const chosenNames = filters.people.map(nameOf).join(' or ');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 40, gap: 16 }}
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
      <Stack.Screen options={{ title: 'Threads' }} />
      <ThreadFilterBar filters={filters} onChange={setFilters} archivedCount={archivedCount} people={people} nameOf={nameOf} />
      <StatusBanner error={error} offlineText="You're offline. Threads will load when you're back online." onRetry={() => void load()} />
      {!loaded && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      <ThreadRows items={items} nameOf={nameOf} onOpen={open} onLongPress={setOptions} />
      {loaded && rows.length === 0 ? (
        filters.archived ? (
          <ThreadsEmpty icon="sf:archivebox" title="No archived threads" detail="Archived threads stay readable here. A new reply brings one back." />
        ) : filters.people.length ? (
          <ThreadsEmpty
            icon="sf:person.2"
            title={`No threads with ${chosenNames}`}
            detail={`Threads ${chosenNames} started or replied to show up here.`}
            action={{ label: 'Show everyone', onPress: () => setFilters({ ...filters, people: [] }) }}
          />
        ) : filters.kind === 'sessions' ? (
          <ThreadsEmpty icon="sf:timer" title="No sessions" detail="Make a thread a session from its ⋯ menu. End it there when the work is done." />
        ) : filters.kind === 'named' ? (
          <ThreadsEmpty icon="sf:bubble.left.and.bubble.right" title="No named threads yet" detail="Make a thread a discussion from its ⋯ menu, and it shows up here." />
        ) : filters.kind === 'mine' ? (
          <ThreadsEmpty icon="sf:bubble.left" title="No threads started by you" detail="Threads whose first message you posted show up here." />
        ) : (
          <ThreadsEmpty icon="sf:bubble.left" title="No threads yet" detail="Reply to a message to start a thread." />
        )
      ) : null}
      {loaded && pagesStream && hasMore ? (
        <Pressable onPress={() => void loadOlder()} disabled={loadingOlder} style={{ alignSelf: 'center', padding: 10 }}>
          <Text style={{ ...type.caption, fontWeight: '600', color: colors.secondaryLabel }}>{loadingOlder ? 'Loading…' : 'Load older threads'}</Text>
        </Pressable>
      ) : null}
      <ThreadOptionsSheet
        visible={options !== null}
        onClose={() => setOptions(null)}
        client={client}
        org={org}
        space={space}
        root={options?.root ?? null}
        topic={options?.topic ?? null}
        onChange={() => void load()}
      />
    </ScrollView>
  );
}
