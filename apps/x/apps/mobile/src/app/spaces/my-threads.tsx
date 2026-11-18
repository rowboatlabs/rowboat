import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import type { Member, ThreadListing } from '@rowboat/spaces-protocol';
import { spaces } from '@x/shared';

import { ThreadFilters, ThreadRows, ThreadsEmpty, clearedFilters, filterSummary, isFiltered } from '@/components/thread-list';
import { ThreadOptionsSheet } from '@/components/thread-options';
import { StatusBanner } from '@/components/status-banner';
import { loadValue, peekValue, seedThreadRoot } from '@/lib/spaces/cache';
import { useOrgClient } from '@/lib/spaces/invites';
import { memberLabel } from '@/lib/spaces/profiles';
import {
  DEFAULT_FILTERS,
  loadFilters,
  myThreadMatches,
  participantsOf,
  saveFilters,
  threadLabelOf,
  type ThreadItem,
  type ThreadsFilters,
} from '@/lib/spaces/threads';
import { useColors } from '@/theme/colors';

// Your threads across the server (2026-11-13, the web's /threads page,
// my-threads-view.tsx): every thread you started or follow, in every space,
// newest activity first, each with where it stands for you (Harbor's
// status). The space Threads screen's filters plus a Spaces filter in the
// same menu; the archived list is fetched on open so its count rides the
// Archived segment.
// Opened from the More tab.
export default function MyThreadsScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; me: string }>();
  const { org, me } = params;
  const client = useOrgClient(org);

  const [filters, setFiltersState] = useState<ThreadsFilters>(DEFAULT_FILTERS);
  useEffect(() => {
    let cancelled = false;
    void loadFilters(`mine:${org}`).then((saved) => !cancelled && setFiltersState(saved));
    return () => {
      cancelled = true;
    };
  }, [org]);
  const setFilters = (next: ThreadsFilters) => {
    setFiltersState(next);
    saveFilters(`mine:${org}`, next);
  };

  const [active, setActive] = useState<ThreadListing[] | null>(null);
  const [ended, setEnded] = useState<ThreadListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [options, setOptions] = useState<ThreadItem | null>(null);

  // Names come from the rosters Home already keeps for every space.
  const membersKey = `orgMembers:${org}`;
  const [rosters, setRosters] = useState<Map<string, Member[]>>(() => new Map(peekValue<[string, Member[]][]>(membersKey) ?? []));
  useEffect(() => {
    let cancelled = false;
    void loadValue<[string, Member[]][]>(membersKey).then((saved) => {
      if (!cancelled && saved) setRosters((prev) => (prev.size ? prev : new Map(saved)));
    });
    return () => {
      cancelled = true;
    };
  }, [membersKey]);

  const load = useCallback(async () => {
    try {
      const [live, archived] = await Promise.all([client.myThreads(), client.myThreads(true).catch(() => [])]);
      setActive(live);
      setEnded(archived);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // A space Home hasn't listed yet (joined since) fetches its own roster.
  const listed = useMemo(() => [...new Set([...(active ?? []), ...(ended ?? [])].map((t) => t.spaceId))], [active, ended]);
  useEffect(() => {
    const missing = listed.filter((id) => !rosters.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (id) => [id, await client.listMembers(id).catch(() => [] as Member[])] as const)).then((pairs) => {
      if (!cancelled) setRosters((prev) => new Map([...prev, ...pairs]));
    });
    return () => {
      cancelled = true;
    };
  }, [client, listed, rosters]);

  const members = useMemo(() => {
    const out = new Map<string, Member>();
    for (const list of rosters.values()) for (const m of list) out.set(m.id, m);
    return out;
  }, [rosters]);
  const memberNames = useMemo(() => new Map([...members].map(([id, m]) => [id, memberLabel(m)])), [members]);
  const nameOf = useCallback((id: string) => memberNames.get(id) ?? 'Unknown member', [memberNames]);

  // A DM's listing carries Harbor's placeholder name, so it is named for the other person.
  const whereOf = (t: ThreadListing) => {
    if (t.spaceKind !== 'direct') return `#${t.spaceName}`;
    const other = rosters.get(t.spaceId)?.find((m) => m.id !== me);
    return other ? memberLabel(other) : t.spaceName;
  };

  const all = filters.archived ? ended ?? [] : active ?? [];
  const loaded = filters.archived ? ended !== null : active !== null;
  const ofKind = all.filter((t) => myThreadMatches(t, filters.kind, me));
  const rows = ofKind.filter(
    (t) =>
      (filters.spaces.length === 0 || filters.spaces.includes(t.spaceId)) &&
      (filters.people.length === 0 || participantsOf(t.root).some((id) => filters.people.includes(id))),
  );
  const archivedCount = (ended ?? []).filter((t) => myThreadMatches(t, filters.kind, me)).length;
  const spaceOptions = [...new Map([...ofKind, ...all.filter((t) => filters.spaces.includes(t.spaceId))].map((t) => [t.spaceId, { id: t.spaceId, name: whereOf(t) }])).values()];
  const people = [...new Set(ofKind.flatMap((t) => participantsOf(t.root)))];
  const summary = filterSummary(filters, nameOf, (id) => spaceOptions.find((s) => s.id === id)?.name ?? 'Space');
  const clearAction = { label: 'Clear filters', onPress: () => setFilters(clearedFilters(filters)) };

  const items: ThreadItem[] = rows.map((t) => ({
    spaceId: t.spaceId,
    rootMessageId: t.root.id,
    root: t.root,
    ...(t.topic ? { topic: t.topic } : {}),
    title: spaces.resolveMentions(t.topic?.title ?? t.root.session?.title ?? threadLabelOf(t.root.body), memberNames),
    activityAt: t.lastActivityAt,
    people: participantsOf(t.root),
    unread: t.unreadReplies,
    forYou: t.unreadMentions,
    spaceName: whereOf(t),
    status: t.status,
  }));

  const open = (item: ThreadItem) => {
    if (item.root) seedThreadRoot(org, item.spaceId, item.root);
    const listing = all.find((t) => t.spaceId === item.spaceId && t.root.id === item.rootMessageId);
    router.push({
      pathname: '/spaces/thread',
      params: { org, space: item.spaceId, root: item.rootMessageId, title: listing?.spaceKind === 'direct' ? 'Thread' : listing?.spaceName ?? 'Thread', me },
    });
  };

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
      <Stack.Screen options={{ title: 'Your threads' }} />
      <ThreadFilters filters={filters} onChange={setFilters} archivedCount={archivedCount} people={people} nameOf={nameOf} spaces={spaceOptions} />
      <StatusBanner error={error} offlineText="You're offline. Your threads will load when you're back online." onRetry={() => void load()} />
      {!loaded && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      <ThreadRows items={items} nameOf={nameOf} onOpen={open} onLongPress={setOptions} />
      {loaded && rows.length === 0 ? (
        filters.archived && isFiltered(filters) ? (
          <ThreadsEmpty icon="sf:archivebox" title="No archived threads match" detail={`Nothing archived for ${summary}.`} action={clearAction} />
        ) : filters.archived ? (
          <ThreadsEmpty icon="sf:archivebox" title="Nothing archived" detail="Threads you archive and sessions you end stay readable here. A new reply brings one back." />
        ) : filters.people.length || filters.spaces.length ? (
          <ThreadsEmpty icon="sf:person.2" title="No threads match" detail={`Nothing for ${summary}.`} action={clearAction} />
        ) : filters.kind === 'sessions' ? (
          <ThreadsEmpty icon="sf:timer" title="No sessions" detail="Make a thread a session from its ⋯ menu. End it there when the work is done." action={clearAction} />
        ) : filters.kind === 'named' ? (
          <ThreadsEmpty icon="sf:bubble.left.and.bubble.right" title="No named threads" detail="Discussions you started or follow show up here." action={clearAction} />
        ) : filters.kind === 'mine' ? (
          <ThreadsEmpty icon="sf:bubble.left" title="No threads started by you" detail="Threads whose first message you posted show up here." action={clearAction} />
        ) : (
          <ThreadsEmpty icon="sf:bubble.left" title="No threads yet" detail="Threads you start or reply to, in any space, show up here." />
        )
      ) : null}
      <ThreadOptionsSheet
        visible={options !== null}
        onClose={() => setOptions(null)}
        client={client}
        org={org}
        space={options?.spaceId ?? ''}
        root={options?.root ?? null}
        topic={options?.topic ?? null}
        onChange={() => void load()}
      />
    </ScrollView>
  );
}
