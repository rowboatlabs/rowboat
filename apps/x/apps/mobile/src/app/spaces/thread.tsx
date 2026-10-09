import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useKeyboardVisible } from '@/lib/use-keyboard-visible';
import type { Member, Message } from '@rowboat/spaces-protocol';

import { spaces } from '@x/shared';

import { ChatMarkdown } from '@/components/markdown';
import { MessageLinkPreviews } from '@/components/link-preview-card';
import { SpaceBlobImage } from '@/components/space-blob-image';
import { MessageActionSheet, MessageRow, applyReaction, parseAssetLink } from '@/components/space-message';
import { SpaceComposer, type SpaceComposerHandle } from '@/components/space-composer';
import { PollCard, applyPollVote } from '@/components/poll-card';
import { setActiveSpace } from '@/lib/push';
import { useSpacesAccount } from '@/lib/spaces/account';
import { StatusBanner } from '@/components/status-banner';
import { loadRoster, loadThread, peekRoster, peekThread, saveRoster, saveThread } from '@/lib/spaces/cache';
import { SpacesClient } from '@/lib/spaces/client';
import { SpacesLive } from '@x/spaces-client';
import { useColors } from '@/theme/colors';

// One flat thread: root pinned on top, replies below, composer posts with
// threadRoot. Live folds replies + reactions addressed to this thread.
export default function SpaceThreadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  // The header is see-through (soft scroll edge): content insets itself.
  const headerHeight = useHeaderHeight();
  const account = useSpacesAccount();
  const params = useLocalSearchParams<{ org: string; space: string; root: string; title: string; me: string }>();
  const { org, space, root, me } = params;

  const client = useMemo(
    () => new SpacesClient({ baseUrl: `https://${org}`, token: (opts) => account.getAccessToken(opts) }),
    [org, account],
  );

  // Paint from cache synchronously when we can (stream-seeded root, or a
  // thread opened earlier this session); the fetch below replaces it.
  const initial = peekThread(org, space, root);
  const [rootMessage, setRootMessage] = useState<Message | null>(initial?.root ?? null);
  const [replies, setReplies] = useState<Message[] | null>(initial?.messages ?? null);
  const [members, setMembers] = useState<Map<string, Member>>(() => new Map((peekRoster(org, space) ?? []).map((m) => [m.id, m])));
  const memberNames = useMemo(() => new Map([...members].map(([id, m]) => [id, m.displayName])), [members]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [reactionsOnly, setReactionsOnly] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(initial?.following ?? null);
  const scrollRef = useRef<ScrollView>(null);
  const composerRef = useRef<SpaceComposerHandle>(null);
  const lastOffset = useRef<number | undefined>(undefined);
  // Land on the root (what you tapped). Scroll down only for a reply that
  // arrives live or that you send — never because a refresh swapped the list.
  const scrollToNewest = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  if (lastOffset.current === undefined && initial?.messages) {
    lastOffset.current = initial.messages.at(-1)?.offset ?? initial.root.offset;
  }

  useEffect(() => {
    let cancelled = false;
    // Disk cache (after a relaunch) — only if nothing better is on screen yet.
    void Promise.all([loadThread(org, space, root), loadRoster(org, space)]).then(([cached, roster]) => {
      if (cancelled) return;
      if (roster) setMembers((prev) => (prev.size ? prev : new Map(roster.map((m) => [m.id, m]))));
      if (!cached?.messages) return;
      setRootMessage((prev) => prev ?? cached.root);
      setReplies((prev) => {
        if (prev) return prev;
        lastOffset.current = cached.messages!.at(-1)?.offset ?? cached.root.offset;
        return cached.messages;
      });
      setFollowing((prev) => prev ?? cached.following);
    });
    // Names don't block the thread: each request lands on its own.
    client
      .listMembers(space)
      .then((memberList) => {
        if (cancelled) return;
        setMembers(new Map(memberList.map((m) => [m.id, m])));
        saveRoster(org, space, memberList);
      })
      .catch(() => {});
    client
      .listThread(space, root)
      .then((thread) => {
        if (cancelled) return;
        const freshLast = thread.messages.at(-1)?.offset ?? thread.root.offset;
        setRootMessage(thread.root);
        // Keep anything live delivered after the server's snapshot.
        setReplies((prev) => [...thread.messages, ...(prev ?? []).filter((m) => m.offset > freshLast && !thread.messages.some((f) => f.id === m.id))]);
        setFollowing(thread.following);
        lastOffset.current = Math.max(lastOffset.current ?? 0, freshLast);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [client, org, space, root]);

  // Deleted replies vanish (Slack) — they anchor nothing.
  const visibleReplies = useMemo(() => replies?.filter((m) => !m.deletedAt) ?? null, [replies]);

  // Write-through: whatever is on screen is what the next open paints.
  useEffect(() => {
    if (rootMessage && replies) saveThread(org, space, { root: rootMessage, messages: replies, following });
  }, [org, space, rootMessage, replies, following]);

  useEffect(() => {
    if (replies === null) return;
    const live = new SpacesLive({ baseUrl: `https://${org}`, token: () => account.getAccessToken() });
    const off = live.subscribe(
      space,
      (frame) => {
        if (frame.kind !== 'event') return;
        const event = frame.event;
        if (event.type === 'message' && event.message.threadRoot === root) {
          setReplies((prev) => {
            if (!prev || prev.some((m) => m.id === event.message.id)) return prev;
            scrollToNewest();
            return [...prev, event.message];
          });
        } else if (event.type === 'message_deleted') {
          const patch = (m: Message) => (m.id === event.deletion.messageId ? { ...m, body: '', deletedAt: event.deletion.at } : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        } else if (event.type === 'message_edited') {
          const patch = (m: Message) => (m.id === event.edit.messageId ? { ...m, body: event.edit.body, editedAt: event.edit.at } : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        } else if (event.type === 'reaction') {
          const patch = (m: Message) => (m.id === event.reaction.messageId ? applyReaction(m, event.reaction.emoji, event.reaction.by.memberId, event.action) : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        } else if (event.type === 'poll_vote') {
          const patch = (m: Message) => (m.id === event.vote.messageId && m.poll ? { ...m, poll: applyPollVote(m.poll, { answerId: event.vote.answerId, memberId: event.vote.by.memberId, action: event.action }) } : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        } else if (event.type === 'poll_ended') {
          const patch = (m: Message) => (m.id === event.end.messageId && m.poll ? { ...m, poll: { ...m.poll, endedAt: event.end.at } } : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        }
      },
      lastOffset.current,
    );
    return () => {
      off();
      live.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect once per screen after first load
  }, [replies === null, org, space, root]);


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

  const send = async (body: string) => {
    if (sending) return;
    setSending(true);
    try {
      const { message } = await client.postMessage(space, { body, threadRoot: root, actingMode: 'direct' });
      setReplies((prev) => (prev && !prev.some((m) => m.id === message.id) ? [...prev, message] : prev));
      scrollToNewest();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  // Thread read mark: the newest reply on screen (a thread takes a mark
  // whether or not we follow it — CONTRACT.md amendment 2026-09-11).
  const newestReply = replies?.at(-1)?.offset;
  useEffect(() => {
    if (newestReply === undefined) return;
    const t = setTimeout(() => void client.markRead(space, { threadRootId: root, offset: newestReply }).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [client, space, root, newestReply]);

  useEffect(() => {
    setActiveSpace(space);
    return () => setActiveSpace(null);
  }, [space]);

  const patchBoth = useCallback((folded: Message) => {
    setRootMessage((prev) => (prev && prev.id === folded.id ? folded : prev));
    setReplies((prev) => prev?.map((m) => (m.id === folded.id ? folded : m)) ?? null);
  }, []);
  const quote = useCallback((message: Message) => composerRef.current?.quote(spaces.resolveMentions(message.body, memberNames)), [memberNames]);
  const beginEdit = useCallback((message: Message) => composerRef.current?.beginEdit(message.id, message.body), []);
  const saveEdit = useCallback(
    (id: string, body: string) => {
      client.editMessage(space, id, { body, actingMode: 'direct' }).then(patchBoth).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    },
    [client, space, patchBoth],
  );
  const confirmDelete = useCallback(
    (message: Message) => {
      Alert.alert('Delete message?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            client.deleteMessage(space, message.id, { actingMode: 'direct' }).then(patchBoth).catch((err) => setError(err instanceof Error ? err.message : String(err)));
          },
        },
      ]);
    },
    [client, space, patchBoth],
  );
  const linkFor = useCallback((message: Message) => `https://${org}/s/${space}/m/${message.id}`, [org, space]);

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

  const vote = useCallback(
    (message: Message, answerIds: number[]) => {
      void (async () => {
        try {
          let latest = message;
          for (const answerId of answerIds) latest = await client.votePoll(space, message.id, { answerId, action: 'add', actingMode: 'direct' });
          patchBoth(latest);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [client, space, patchBoth],
  );
  const removeVote = useCallback(
    (message: Message) => {
      const mine = message.poll?.votes.filter((g) => g.memberIds.includes(me)).map((g) => g.answerId) ?? [];
      void (async () => {
        let latest = message;
        for (const answerId of mine) latest = await client.votePoll(space, message.id, { answerId, action: 'remove', actingMode: 'direct' }).catch(() => latest);
        patchBoth(latest);
      })();
    },
    [client, space, me, patchBoth],
  );
  const endPoll = useCallback(
    (message: Message) => {
      client.endPoll(space, message.id, { actingMode: 'direct' }).then(patchBoth).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    },
    [client, space, patchBoth],
  );

  const toggleReaction = useCallback(
    (message: Message, emoji: string) => {
      const mine = message.reactions.some((g) => g.emoji === emoji && g.memberIds.includes(me));
      const patchWith = (folded: Message) => {
        setRootMessage((prev) => (prev && prev.id === folded.id ? folded : prev));
        setReplies((prev) => prev?.map((m) => (m.id === folded.id ? folded : m)) ?? null);
      };
      patchWith(applyReaction(message, emoji, me, mine ? 'removed' : 'added'));
      client
        .reactToMessage(space, message.id, { emoji, action: mine ? 'remove' : 'add', actingMode: 'direct' })
        .then(patchWith)
        .catch(() => patchWith(message));
    },
    [client, space, me],
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={0}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.label }}>Thread</Text>
              {params.title ? <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>#{params.title}</Text> : null}
            </View>
          ),
          // Follow = replies land in Activity + notifications (Slack's bell).
          headerRight: () =>
            following === null ? null : (
              <Pressable
                hitSlop={10}
                onPress={() => {
                  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                  const next = !following;
                  setFollowing(next);
                  client.followThread(space, root, next).catch(() => setFollowing(!next));
                }}
              >
                <Image source={following ? 'sf:bell.fill' : 'sf:bell'} style={{ width: 20, height: 20 }} tintColor={colors.label} />
              </Pressable>
            ),
        }}
      />
      {rootMessage === null && !error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          alwaysBounceVertical
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 12 }}
        >
          <StatusBanner error={error} offlineText={replies ? "You're offline. Showing saved replies." : "You're offline. Replies will load when you're back online."} />
          {rootMessage?.deletedAt ? (
            <MessageRow message={rootMessage} me={me} onToggleReaction={toggleReaction} onLongPress={() => {}} />
          ) : rootMessage ? (
            <RootMessage
              message={rootMessage}
              member={members.get(rootMessage.author.memberId)}
              memberNames={memberNames}
              me={me}
              onToggleReaction={toggleReaction}
              onLongPress={(m) => { setReactionsOnly(false); setActionMessage(m); }}
              onAddReaction={(m) => { setReactionsOnly(true); setActionMessage(m); }}
              onVote={vote}
              onRemoveVote={removeVote}
              onEndPoll={endPoll}
              onOpenAsset={openAssetLink}
            />
          ) : null}
          {rootMessage && visibleReplies !== null ? (
            <Pressable
              onPress={visibleReplies.length === 0 ? () => composerRef.current?.focus() : undefined}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4,
                paddingHorizontal: 16, paddingVertical: 12,
                borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: colors.separator,
              }}
            >
              {visibleReplies.length === 0 ? (
                <>
                  <Image source="sf:bubble.left" style={{ width: 17, height: 17 }} tintColor={colors.secondaryLabel} />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.secondaryLabel }}>Reply in Thread</Text>
                </>
              ) : (
                <Text style={{ fontSize: 15, color: colors.secondaryLabel }}>
                  {visibleReplies.length} {visibleReplies.length === 1 ? 'reply' : 'replies'}
                </Text>
              )}
            </Pressable>
          ) : null}
          {/* Root painted from the stream; replies still on their way. */}
          {rootMessage && replies === null && !error ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
          {visibleReplies?.map((m) => (
            <MessageRow key={m.id} message={m} member={members.get(m.author.memberId)} memberNames={memberNames} me={me} onToggleReaction={toggleReaction} onLongPress={(m) => { setReactionsOnly(false); setActionMessage(m); }} onOpenAsset={openAssetLink}
              onAddReaction={(m) => { setReactionsOnly(true); setActionMessage(m); }} onVote={vote} onRemoveVote={removeVote} onEndPoll={endPoll} />
          ))}
        </ScrollView>
      )}

      {/* Composer */}
      <View style={{ paddingTop: 8, paddingBottom: keyboardVisible ? 16 : insets.bottom + 10 }}>
        <SpaceComposer
          ref={composerRef}
          placeholder="Add a reply"
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
        onQuote={quote}
        onEdit={beginEdit}
        onDelete={confirmDelete}
        linkFor={linkFor}
      />
    </KeyboardAvoidingView>
  );
}

// The root, Slack-style: 40pt avatar, bold name with the timestamp UNDER it,
// full-size body, then reaction pills + the always-on emoji+ pill.
function RootMessage({ message, member, memberNames, me, onToggleReaction, onLongPress, onAddReaction, onVote, onRemoveVote, onEndPoll, onOpenAsset }: {
  message: Message;
  member?: Member;
  memberNames: ReadonlyMap<string, string>;
  me: string;
  onToggleReaction: (message: Message, emoji: string) => void;
  onLongPress: (message: Message) => void;
  onAddReaction: (message: Message) => void;
  onVote: (message: Message, answerIds: number[]) => void;
  onRemoveVote: (message: Message) => void;
  onEndPoll: (message: Message) => void;
  onOpenAsset?: (link: { host: string; spaceId: string; assetId: string; label: string }) => void;
}) {
  const colors = useColors();
  const name = member?.displayName ?? message.author.memberId;
  const body = spaces.decorateMentions(message.body, memberNames);
  // Same authed blob-image rule the chat rows use — the default renderer
  // can't fetch Harbor blobs.
  const imageRule = useMemo(
    () => ({
      image: (node: { key: string; attributes: { src?: string } }) =>
        node.attributes.src ? <SpaceBlobImage key={node.key} src={node.attributes.src} /> : null,
    }),
    [],
  );
  const posted = new Date(message.postedAt);
  const today = new Date().toDateString() === posted.toDateString();
  const stamp = `${today ? 'Today' : posted.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${posted.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <Pressable
      onLongPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress(message);
      }}
      delayLongPress={250}
      style={{ paddingHorizontal: 16, paddingTop: 4 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <View
          style={{
            width: 40, height: 40, borderRadius: 10, borderCurve: 'continuous',
            alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryBackground,
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: '600', color: colors.label }}>{(name[0] ?? '?').toUpperCase()}</Text>
        </View>
        <View>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.label }}>{name}</Text>
          <Text style={{ fontSize: 13, color: colors.tertiaryLabel }}>{stamp}</Text>
        </View>
      </View>
      {message.poll ? (
        <PollCard message={message} poll={message.poll} me={me} onVote={onVote} onRemoveVote={onRemoveVote} onEndPoll={onEndPoll} />
      ) : (
        <>
          <ChatMarkdown
            extraRules={imageRule}
            onLinkPress={(url) => {
              const link = parseAssetLink(url);
              if (!link || !onOpenAsset) return true;
              onOpenAsset(link);
              return false;
            }}
          >
            {body}
          </ChatMarkdown>
          <MessageLinkPreviews body={message.body} />
        </>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
        {message.reactions.map((g) => {
          const mine = g.memberIds.includes(me);
          return (
            <Pressable
              key={g.emoji}
              onPress={() => onToggleReaction(message, g.emoji)}
              style={{
                flexDirection: 'row', gap: 4, paddingHorizontal: 9, paddingVertical: 4,
                borderRadius: 14, backgroundColor: colors.secondaryBackground,
                borderWidth: 1, borderColor: mine ? colors.label : 'transparent',
              }}
            >
              <Text style={{ fontSize: 14 }}>{g.emoji}</Text>
              <Text style={{ fontSize: 14, fontWeight: mine ? '600' : '400', color: mine ? colors.label : colors.secondaryLabel }}>{g.memberIds.length}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => onAddReaction(message)}
          style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4,
            borderRadius: 14, backgroundColor: colors.secondaryBackground,
          }}
        >
          <Image source="sf:face.smiling" style={{ width: 16, height: 16 }} tintColor={colors.secondaryLabel} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.secondaryLabel, marginLeft: 1, marginTop: -7 }}>+</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}
