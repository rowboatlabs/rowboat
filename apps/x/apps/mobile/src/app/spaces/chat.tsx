import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardVisible } from '@/lib/use-keyboard-visible';
import type { Member, Message } from '@rowboat/spaces-protocol';

import { MessageActionSheet, MessageRow, applyReaction } from '@/components/space-message';
import { SpaceComposer } from '@/components/space-composer';
import { applyPollVote } from '@/components/poll-card';
import { setActiveSpace } from '@/lib/push';
import { useSpacesAccount } from '@/lib/spaces/account';
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

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [members, setMembers] = useState<Map<string, Member>>(new Map());
  const memberNames = useMemo(() => new Map([...members].map(([id, m]) => [id, m.displayName])), [members]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [reactionsOnly, setReactionsOnly] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const lastOffset = useRef<number | undefined>(undefined);

  // Fold one live message into the stream: roots append; replies bump their
  // root's reply chip.
  const foldMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      if (!prev) return prev;
      if (message.threadRoot) {
        return prev.map((m) =>
          m.id === message.threadRoot
            ? { ...m, replyCount: m.replyCount + 1, lastReplyAt: message.postedAt }
            : m,
        );
      }
      if (prev.some((m) => m.id === message.id)) return prev;
      return [...prev, message];
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.listStream(space), client.listMembers(space)])
      .then(([stream, memberList]) => {
        if (cancelled) return;
        setMembers(new Map(memberList.map((m) => [m.id, m])));
        setMessages(stream.messages);
        lastOffset.current = stream.messages.at(-1)?.offset;
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [client, space]);

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
          setMessages((prev) => prev?.map((m) => (m.id === event.deletion.messageId ? { ...m, body: '', deletedAt: event.deletion.at } : m)) ?? null);
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

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(t);
  }, [messages?.length]);

  const send = async (body: string) => {
    if (sending) return;
    setSending(true);
    try {
      const { message } = await client.postMessage(space, { body, actingMode: 'direct' });
      foldMessage(message);
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

  const openThread = useCallback(
    (message: Message) => {
      router.push({ pathname: '/spaces/thread', params: { org, space, root: message.id, title: title ?? 'Thread', me } });
    },
    [org, space, title, me],
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen
        options={{
          title: title ?? 'Space',
          headerRight: () => (
            <Pressable
              hitSlop={10}
              onPress={() => router.push({ pathname: '/spaces/files', params: { org, space, title } })}
            >
              <Image source="sf:folder" style={{ width: 20, height: 20 }} tintColor={colors.label} />
            </Pressable>
          ),
        }}
      />
      {messages === null && !error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          keyboardDismissMode="interactive"
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 12 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {error ? <Text style={{ fontSize: 13, color: colors.destructive, paddingHorizontal: 16, paddingBottom: 8 }}>{error}</Text> : null}
          {messages?.map((m) => (
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
            />
          ))}
          {messages?.length === 0 ? (
            <Text style={{ textAlign: 'center', marginTop: 48, fontSize: 14, color: colors.tertiaryLabel }}>
              No messages yet — say hi.
            </Text>
          ) : null}
        </ScrollView>
      )}

      {/* Composer */}
      <View style={{ paddingTop: 8, paddingBottom: (keyboardVisible ? 0 : insets.bottom) + 10 }}>
        <SpaceComposer
          placeholder={`Message #${title ?? ''}`}
          members={[...members.values()]}
          me={me}
          sending={sending}
          onSend={(body) => void send(body)}
        />
      </View>

      <MessageActionSheet
        reactionsOnly={reactionsOnly}
        message={actionMessage}
        me={me}
        onClose={() => setActionMessage(null)}
        onToggleReaction={toggleReaction}
        onReply={openThread}
      />
    </KeyboardAvoidingView>
  );
}
