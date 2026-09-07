import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardVisible } from '@/lib/use-keyboard-visible';
import type { Member, Message } from '@rowboat/spaces-protocol';

import { MessageActionSheet, MessageRow, applyReaction } from '@/components/space-message';
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
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
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

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setSending(true);
    setDraft('');
    try {
      const { message } = await client.postMessage(space, { body, actingMode: 'direct' });
      foldMessage(message);
    } catch (err) {
      setDraft(body);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

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
              onLongPress={setActionMessage}
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
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: (keyboardVisible ? 0 : insets.bottom) + 8 }}>
        <TextInput
          style={{
            flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10,
            fontSize: 16, color: colors.label, backgroundColor: colors.secondaryBackground,
            borderRadius: 20, borderCurve: 'continuous',
          }}
          placeholder={`Message #${title ?? ''}`}
          placeholderTextColor={colors.tertiaryLabel}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          style={{ opacity: draft.trim() && !sending ? 1 : 0.35, paddingBottom: 4 }}
        >
          <Image source="sf:arrow.up.circle.fill" style={{ width: 32, height: 32 }} tintColor={colors.label} />
        </Pressable>
      </View>

      <MessageActionSheet
        message={actionMessage}
        me={me}
        onClose={() => setActionMessage(null)}
        onToggleReaction={toggleReaction}
        onReply={openThread}
      />
    </KeyboardAvoidingView>
  );
}
