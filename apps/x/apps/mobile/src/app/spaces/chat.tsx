import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { HeaderFade } from '@/components/header-fade';
import { SpacesClient } from '@/lib/spaces/client';
import { SpacesLive } from '@/lib/spaces/live';
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
  const listRef = useRef<FlatList<Message>>(null);
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
    client
      .listMembers(space)
      .then((memberList) => {
        if (cancelled) return;
        setMembers(new Map(memberList.map((m) => [m.id, m])));
        saveRoster(org, space, memberList);
      })
      .catch(() => {});
    client
      .listStream(space)
      .then((stream) => {
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
  const newestFirst = useMemo(
    () => (messages ? messages.filter((m) => !m.deletedAt || m.replyCount > 0).reverse() : []),
    [messages],
  );

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
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
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

  const openThread = useCallback(
    (message: Message) => {
      seedThreadRoot(org, space, message);
      router.push({ pathname: '/spaces/thread', params: { org, space, root: message.id, title: title ?? 'Thread', me } });
    },
    [org, space, title, me],
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen
        options={{
          title: title ?? 'Space',
          // The inverted list fights iOS's see-through header + scroll-edge
          // effect (it fogs the whole list): solid bar here, HeaderFade below it.
          headerTransparent: false,
          headerStyle: { backgroundColor: colors.background },
          scrollEdgeEffects: { top: 'hidden', bottom: 'hidden' },
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
      <HeaderFade headerHeight={0} fade={20} />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }}>
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
      ) : messages === null || newestFirst.length === 0 ? (
        <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" alwaysBounceVertical style={{ flex: 1 }}>
          {messages && newestFirst.length === 0 ? (
            <Text style={{ textAlign: 'center', marginTop: 48, fontSize: 14, color: colors.tertiaryLabel }}>
              No messages yet — say hi.
            </Text>
          ) : null}
        </ScrollView>
      ) : (
        <FlatList
          ref={listRef}
          inverted
          data={newestFirst}
          keyExtractor={(m) => m.id}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 12 }}
          // New messages: follow them only when you're already at the bottom.
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
          initialNumToRender={20}
          windowSize={15}
          renderItem={({ item: m }) => (
            <MessageRow
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
            />
          )}
        />
      )}

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
