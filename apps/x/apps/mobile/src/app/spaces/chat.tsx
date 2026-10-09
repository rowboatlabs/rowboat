import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useKeyboardVisible } from '@/lib/use-keyboard-visible';
import type { Member, Message } from '@rowboat/spaces-protocol';
import { spaces } from '@x/shared';

import { MessageActionSheet, MessageRow, applyReaction } from '@/components/space-message';
import { SpaceComposer, type SpaceComposerHandle } from '@/components/space-composer';
import { applyPollVote } from '@/components/poll-card';
import { setActiveSpace } from '@/lib/push';
import { useSpacesAccount } from '@/lib/spaces/account';
import { STREAM_CACHE_LIMIT, loadRoster, loadValue, peekRoster, peekValue, saveRoster, saveValue, seedThreadRoot } from '@/lib/spaces/cache';
import { StatusBanner } from '@/components/status-banner';
import { fetchLinkPreview, peekLinkPreview, previewUrls } from '@/lib/spaces/link-preview';

/** Rows whose link cards must be in before a channel is revealed, and how long we'll wait. */
const TAIL_ROWS = 8;
const TAIL_WAIT_MS = 700;
import { SpacesClient } from '@/lib/spaces/client';
import { SpacesLive } from '@x/spaces-client';
import { useColors } from '@/theme/colors';

// One space's stream (S2): root messages newest at the bottom, live over the
// org WS, composer to post. Long-press a row for reactions / reply-in-thread;
// replies live on the thread screen.
export default function SpaceChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const account = useSpacesAccount();
  const params = useLocalSearchParams<{ org: string; space: string; title: string; me: string }>();
  const { org, space, title, me } = params;

  const client = useMemo(
    () => new SpacesClient({ baseUrl: `https://${org}`, token: (opts) => account.getAccessToken(opts) }),
    [org, account],
  );

  // Stream tail cache: paint the last visit instantly (and offline), then the
  // server's answer replaces it.
  const streamCacheKey = `stream:${org}:${space}`;
  const [messages, setMessages] = useState<Message[] | null>(() => peekValue<Message[]>(streamCacheKey) ?? null);
  const [members, setMembers] = useState<Map<string, Member>>(() => new Map((peekRoster(org, space) ?? []).map((m) => [m.id, m])));
  const memberNames = useMemo(() => new Map([...members].map(([id, m]) => [id, m.displayName])), [members]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [reactionsOnly, setReactionsOnly] = useState(false);
  const listRef = useRef<ScrollView>(null);
  const headerHeight = useHeaderHeight();
  // Bottom-anchored by hand (so iOS's soft scroll edge can run under the
  // see-through header — an inverted list breaks it):
  //  - first paint is hidden until we've jumped to the newest message;
  //  - content growth follows the bottom only while you're AT the bottom
  //    and not touching the list;
  //  - maintainVisibleContentPosition keeps your place when rows above you
  //    grow (late link cards/images) — the old flicker.
  const [positioned, setPositioned] = useState(false);
  const revealing = useRef(false);
  const messagesRef = useRef<Message[] | null>(null);
  // "Follow the bottom" is YOUR intent, decided only when a drag settles —
  // never by programmatic or keep-position scrolls (those fooled it before).
  // Keep-position (maintainVisibleContentPosition) is always on: when rows
  // ABOVE the viewport change height — a first open lands a dozen link cards
  // in ~1.5s — iOS corrects the offset natively in the same frame. Doing it
  // from JS a frame late was the flicker.
  const atBottom = useRef(true);
  const dragging = useRef(false);
  // Jump-to-latest button: shown once you're more than a screenful-ish up,
  // with a dot when something new landed while you were away.
  const [away, setAway] = useState(false);
  const [newWhileAway, setNewWhileAway] = useState(false);
  const awayRef = useRef(false);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement, contentInset } = e.nativeEvent;
    const gap = contentSize.height + (contentInset?.bottom ?? 0) - (contentOffset.y + layoutMeasurement.height);
    const next = gap > 400;
    if (next !== awayRef.current) {
      awayRef.current = next;
      setAway(next);
      if (!next) setNewWhileAway(false);
    }
  }, []);
  const jumpToLatest = useCallback(() => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    atBottom.current = true;
    listRef.current?.scrollToEnd({ animated: true });
  }, []);
  const settle = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    dragging.current = false;
    const { contentOffset, contentSize, layoutMeasurement, contentInset } = e.nativeEvent;
    atBottom.current = contentSize.height + (contentInset?.bottom ?? 0) - (contentOffset.y + layoutMeasurement.height) < 80;
  }, []);
  // After layout commits (a frame later), not mid-layout.
  const toEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }, []);
  const onContentSizeChange = useCallback(() => {
    if (!positioned) {
      toEnd();
      if (revealing.current) return;
      revealing.current = true;
      // Reveal once the last screenful's link cards are in (they'd grow rows
      // you're looking at), capped so a slow site can't hold the screen.
      const urls = (messagesRef.current ?? []).slice(-TAIL_ROWS).flatMap((m) => previewUrls(m.body)).filter((u) => peekLinkPreview(u) === undefined);
      const settled = urls.length ? Promise.race([Promise.allSettled(urls.map((u) => fetchLinkPreview(u))), new Promise((r) => setTimeout(r, TAIL_WAIT_MS))]) : Promise.resolve();
      void settled.then(() =>
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: false });
          requestAnimationFrame(() => setPositioned(true));
        }),
      );
      return;
    }
    if (atBottom.current && !dragging.current) toEnd();
  }, [positioned, toEnd]);
  // The viewport changes size too — the composer and header settle after a
  // push transition, the keyboard comes and goes. Same rule: re-pin if following.
  const viewportHeight = useRef(0);
  const onViewportLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h === viewportHeight.current) return;
      viewportHeight.current = h;
      if (atBottom.current && !dragging.current) toEnd();
    },
    [toEnd],
  );
  const composerRef = useRef<SpaceComposerHandle>(null);
  const lastOffset = useRef<number | undefined>(undefined);

  // Fold one live message into the stream: roots append; replies bump their
  // root's reply chip.
  // Idempotent: the live socket replays from an offset the (cached or fresh)
  // snapshot may already include, so a reply counts only once — by id, and
  // only if it's newer than the root's lastReplyAt the server already folded.
  const countedReplies = useRef(new Set<string>());
  const countedDeletes = useRef(new Set<string>());
  const foldMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      if (!prev) return prev;
      if (message.threadRoot) {
        if (countedReplies.current.has(message.id)) return prev;
        countedReplies.current.add(message.id);
        return prev.map((m) =>
          m.id === message.threadRoot && (!m.lastReplyAt || message.postedAt > m.lastReplyAt)
            ? { ...m, replyCount: m.replyCount + 1, lastReplyAt: message.postedAt }
            : m,
        );
      }
      if (prev.some((m) => m.id === message.id)) return prev;
      if (awayRef.current) setNewWhileAway(true);
      return [...prev, message];
    });
  }, []);

  if (lastOffset.current === undefined && messages?.length) lastOffset.current = messages.at(-1)?.offset;

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // Disk cache after a relaunch — names and messages land in the same
    // render, so rows never flash raw member ids before names arrive.
    void Promise.all([loadValue<Message[]>(streamCacheKey), loadRoster(org, space)]).then(([cached, roster]) => {
      if (cancelled) return;
      if (roster) setMembers((prev) => (prev.size ? prev : new Map(roster.map((m) => [m.id, m]))));
      if (cached) {
        setMessages((prev) => {
          if (prev) return prev;
          lastOffset.current = cached.at(-1)?.offset;
          return cached;
        });
      }
    });
    const rosterReq = client
      .listMembers(space)
      .then((memberList) => {
        if (cancelled) return;
        setMembers(new Map(memberList.map((m) => [m.id, m])));
        saveRoster(org, space, memberList);
      })
      .catch(() => {});
    client
      .listStream(space)
      .then(async (stream) => {
        // Names first: rows painted with raw member ids reflow when the
        // roster lands (a visible jump on a first open).
        await rosterReq;
        if (cancelled) return;
        const freshLast = stream.messages.at(-1)?.offset ?? 0;
        // Keep anything live delivered after the server's snapshot.
        setMessages((prev) => [...stream.messages, ...(prev ?? []).filter((m) => m.offset > freshLast && !stream.messages.some((f) => f.id === m.id))]);
        lastOffset.current = Math.max(lastOffset.current ?? 0, freshLast) || undefined;
        setError(null);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- streamCacheKey derives from org+space
  }, [client, org, space, reloadKey]);

  // Write-through (tail only).
  useEffect(() => {
    if (messages) saveValue(streamCacheKey, messages.slice(-STREAM_CACHE_LIMIT));
  }, [streamCacheKey, messages]);

  // Newest first for the inverted list: row 0 sits at the bottom, so content
  // that grows later (link cards, images) pushes history UP, never the view.
  // Deleted messages vanish (Slack) unless replies still hang off them.
  messagesRef.current = messages;
  const visible = useMemo(() => messages?.filter((m) => !m.deletedAt || m.replyCount > 0) ?? [], [messages]);

  // Live: one socket for this screen's lifetime, replay from the last offset
  // the initial fetch saw (subscribe waits until that fetch lands).
  useEffect(() => {
    if (messages === null) return;
    const live = new SpacesLive({ baseUrl: `https://${org}`, token: () => account.getAccessToken() });
    const off = live.subscribe(
      space,
      (frame) => {
        if (frame.kind !== 'event') return;
        const event = frame.event;
        if (event.type === 'message') foldMessage(event.message);
        else if (event.type === 'message_deleted') {
          // A deleted reply leaves its root's count (the server's count is live replies only).
          const { messageId, threadRoot, at } = event.deletion;
          setMessages((prev) =>
            prev?.map((m) =>
              m.id === messageId
                ? { ...m, body: '', deletedAt: at }
                : threadRoot && m.id === threadRoot && !countedDeletes.current.has(messageId)
                  ? (countedDeletes.current.add(messageId), { ...m, replyCount: Math.max(0, m.replyCount - 1) })
                  : m,
            ) ?? null,
          );
        } else if (event.type === 'message_edited') {
          setMessages((prev) => prev?.map((m) => (m.id === event.edit.messageId ? { ...m, body: event.edit.body, editedAt: event.edit.at } : m)) ?? null);
        } else if (event.type === 'reaction') {
          // Reactions fold server-side on reads; refetch the one message set is
          // overkill — apply the toggle locally.
          setMessages((prev) => prev?.map((m) => (m.id === event.reaction.messageId ? applyReaction(m, event.reaction.emoji, event.reaction.by.memberId, event.action) : m)) ?? null);
        } else if (event.type === 'poll_vote') {
          setMessages((prev) => prev?.map((m) => (m.id === event.vote.messageId && m.poll ? { ...m, poll: applyPollVote(m.poll, { answerId: event.vote.answerId, memberId: event.vote.by.memberId, action: event.action }) } : m)) ?? null);
        } else if (event.type === 'poll_ended') {
          setMessages((prev) => prev?.map((m) => (m.id === event.end.messageId && m.poll ? { ...m, poll: { ...m.poll, endedAt: event.end.at } } : m)) ?? null);
        }
      },
      lastOffset.current,
    );
    return () => {
      off();
      live.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect once per screen after first load
  }, [messages === null, org, space]);


  const send = async (body: string) => {
    if (sending) return;
    setSending(true);
    try {
      const { message } = await client.postMessage(space, { body, actingMode: 'direct' });
      foldMessage(message);
      // Your own message: always land on it, wherever you were scrolled.
      atBottom.current = true;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  // Read state (org-owned, CONTRACT.md): the newest offset on screen is our
  // stream mark. Debounced — Slack's advice, don't mark on every tick.
  const newest = messages?.at(-1)?.offset;
  useEffect(() => {
    if (newest === undefined) return;
    const t = setTimeout(() => void client.markRead(space, { offset: newest }).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [client, space, newest]);

  // No push banner for the space on screen.
  useEffect(() => {
    setActiveSpace(space);
    return () => setActiveSpace(null);
  }, [space]);

  const replaceMessage = useCallback((folded: Message) => {
    setMessages((prev) => prev?.map((m) => (m.id === folded.id ? folded : m)) ?? null);
  }, []);
  const vote = useCallback(
    (message: Message, answerIds: number[]) => {
      void (async () => {
        try {
          let latest = message;
          for (const answerId of answerIds) latest = await client.votePoll(space, message.id, { answerId, action: 'add', actingMode: 'direct' });
          replaceMessage(latest);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [client, space, replaceMessage],
  );
  const removeVote = useCallback(
    (message: Message) => {
      const mine = message.poll?.votes.filter((g) => g.memberIds.includes(me)).map((g) => g.answerId) ?? [];
      void (async () => {
        let latest = message;
        for (const answerId of mine) latest = await client.votePoll(space, message.id, { answerId, action: 'remove', actingMode: 'direct' }).catch(() => latest);
        replaceMessage(latest);
      })();
    },
    [client, space, me, replaceMessage],
  );
  const endPoll = useCallback(
    (message: Message) => {
      client.endPoll(space, message.id, { actingMode: 'direct' }).then(replaceMessage).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    },
    [client, space, replaceMessage],
  );

  // Optimistic toggle; the server's folded message (and the live echo — both
  // idempotent) settle the final state.
  const toggleReaction = useCallback(
    (message: Message, emoji: string) => {
      const mine = message.reactions.some((g) => g.emoji === emoji && g.memberIds.includes(me));
      const action = mine ? ('removed' as const) : ('added' as const);
      setMessages((prev) => prev?.map((m) => (m.id === message.id ? applyReaction(m, emoji, me, action) : m)) ?? null);
      client
        .reactToMessage(space, message.id, { emoji, action: mine ? 'remove' : 'add', actingMode: 'direct' })
        .then((folded) => setMessages((prev) => prev?.map((m) => (m.id === folded.id ? folded : m)) ?? null))
        .catch(() => {
          // Revert the optimistic fold.
          setMessages((prev) => prev?.map((m) => (m.id === message.id ? applyReaction(m, emoji, me, mine ? 'added' : 'removed') : m)) ?? null);
        });
    },
    [client, space, me],
  );

  // "+" media: upload the bytes to the space's blob store and hand the
  // composer the canonical wire link (space-blob-image.tsx renders it).
  const uploadMedia = useCallback(
    async (file: { uri: string; mime: string; name: string }) => {
      const bytes = new Uint8Array(await (await fetch(file.uri)).arrayBuffer());
      const blob = await client.uploadBlob(space, bytes, { declaredMime: file.mime });
      const qs = new URLSearchParams({ name: file.name });
      if (blob.width && blob.height) {
        qs.set('w', String(blob.width));
        qs.set('h', String(blob.height));
      }
      const link = `https://${org}/s/${space}/b/${blob.hash}?${qs.toString()}`;
      return blob.mime.startsWith('image/') ? `![${file.name}](${link})` : `[${file.name}](${link})`;
    },
    [client, org, space],
  );

  const quote = useCallback((message: Message) => composerRef.current?.quote(spaces.resolveMentions(message.body, memberNames)), [memberNames]);
  const beginEdit = useCallback((message: Message) => composerRef.current?.beginEdit(message.id, message.body), []);
  const saveEdit = useCallback(
    (id: string, body: string) => {
      client.editMessage(space, id, { body, actingMode: 'direct' }).then(replaceMessage).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    },
    [client, space, replaceMessage],
  );
  const confirmDelete = useCallback(
    (message: Message) => {
      Alert.alert('Delete message?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            client.deleteMessage(space, message.id, { actingMode: 'direct' }).then(replaceMessage).catch((err) => setError(err instanceof Error ? err.message : String(err)));
          },
        },
      ]);
    },
    [client, space, replaceMessage],
  );
  const linkFor = useCallback((message: Message) => `https://${org}/s/${space}/m/${message.id}`, [org, space]);

  // A file link in a message: this org's files open in the file screen (by
  // id, so a rename never breaks it); any other host goes to the browser.
  const openAssetLink = useCallback(
    (link: { host: string; spaceId: string; assetId: string }) => {
      if (link.host !== org) {
        void Linking.openURL(`https://${link.host}/s/${link.spaceId}/a/${link.assetId}`);
        return;
      }
      router.push({ pathname: '/spaces/file', params: { org, space: link.spaceId, assetId: link.assetId, path: '', title: 'File', mime: '' } });
    },
    [org],
  );

  const openThread = useCallback(
    (message: Message) => {
      seedThreadRoot(org, space, message);
      router.push({ pathname: '/spaces/thread', params: { org, space, root: message.id, title: title ?? 'Thread', me } });
    },
    [org, space, title, me],
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={0}>
      <Stack.Screen
        options={{
          title: title ?? 'Space',
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <Pressable hitSlop={10} onPress={() => router.push({ pathname: '/spaces/search', params: { org, space, title, me } })}>
                <Image source="sf:magnifyingglass" style={{ width: 20, height: 20 }} tintColor={colors.label} />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => router.push({ pathname: '/spaces/files', params: { org, space, title } })}>
                <Image source="sf:folder" style={{ width: 20, height: 20 }} tintColor={colors.label} />
              </Pressable>
            </View>
          ),
        }}
      />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: headerHeight, left: 0, right: 0, zIndex: 2 }}>
      <StatusBanner
        error={error}
        offlineText={messages ? "You're offline. Showing saved messages." : "You're offline. This space will load when you're back online."}
        onRetry={() => {
          setError(null);
          setReloadKey((k) => k + 1);
        }}
      />
      </View>
      {messages === null && !error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : messages === null || visible.length === 0 ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" alwaysBounceVertical style={{ flex: 1 }}>
          {messages && visible.length === 0 ? (
            <Text style={{ textAlign: 'center', marginTop: 48, fontSize: 14, color: colors.tertiaryLabel }}>
              No messages yet — say hi.
            </Text>
          ) : null}
        </ScrollView>
      ) : (
        <ScrollView
          ref={listRef}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          alwaysBounceVertical
          style={{ flex: 1, opacity: positioned ? 1 : 0 }}
          contentContainerStyle={{ paddingVertical: 12 }}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScrollBeginDrag={() => { dragging.current = true; }}
          onScrollEndDrag={settle}
          onMomentumScrollEnd={settle}
          onContentSizeChange={onContentSizeChange}
          onLayout={onViewportLayout}
          onScroll={onScroll}
          scrollEventThrottle={100}
        >
          {visible.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              member={members.get(m.author.memberId)}
              memberNames={memberNames}
              me={me}
              onToggleReaction={toggleReaction}
              onOpenThread={openThread}
              onLongPress={(m) => { setReactionsOnly(false); setActionMessage(m); }}
              onAddReaction={(m) => { setReactionsOnly(true); setActionMessage(m); }}
              onVote={vote}
              onRemoveVote={removeVote}
              onEndPoll={endPoll}
              onOpenAsset={openAssetLink}
            />
          ))}
        </ScrollView>
      )}

      {away && positioned ? (
        <View pointerEvents="box-none" style={{ height: 0, alignItems: 'flex-end', zIndex: 3 }}>
          <Pressable
            onPress={jumpToLatest}
            hitSlop={8}
            style={({ pressed }) => ({
              position: 'absolute', right: 16, bottom: 10, width: 38, height: 38, borderRadius: 19,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: colors.background, borderWidth: 0.5, borderColor: colors.separator,
              shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Image source="sf:arrow.down" style={{ width: 15, height: 15 }} tintColor={colors.label} />
            {newWhileAway ? (
              <View style={{ position: 'absolute', top: 1, right: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: '#0a84ff', borderWidth: 1.5, borderColor: colors.background }} />
            ) : null}
          </Pressable>
        </View>
      ) : null}
      {messages !== null && visible.length > 0 && !positioned ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : null}

      {/* Composer */}
      <View style={{ paddingTop: 8, paddingBottom: keyboardVisible ? 16 : insets.bottom + 10 }}>
        <SpaceComposer
          ref={composerRef}
          placeholder={`Message #${title ?? ''}`}
          members={[...members.values()]}
          me={me}
          sending={sending}
          onSend={(body) => void send(body)}
          onPickMedia={uploadMedia}
          onEdit={saveEdit}
        />
      </View>

      <MessageActionSheet
        reactionsOnly={reactionsOnly}
        message={actionMessage}
        me={me}
        onClose={() => setActionMessage(null)}
        onToggleReaction={toggleReaction}
        onReply={openThread}
        onQuote={quote}
        onEdit={beginEdit}
        onDelete={confirmDelete}
        linkFor={linkFor}
      />
    </KeyboardAvoidingView>
  );
}
