import { Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Member, Message } from '@rowboat/spaces-protocol';

import { ChatMarkdown } from '@/components/markdown';
import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { SpacesLive } from '@/lib/spaces/live';
import { useColors } from '@/theme/colors';

// One space's stream (S2): root messages newest at the bottom, live over the
// org WS, composer to post. Slack-minimal rows — avatar, name, time, body.
export default function SpaceChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const account = useSpacesAccount();
  const params = useLocalSearchParams<{ org: string; space: string; title: string; me: string }>();
  const { org, space, title } = params;

  const client = useMemo(
    () => new SpacesClient({ baseUrl: `https://${org}`, token: (opts) => account.getAccessToken(opts) }),
    [org, account],
  );

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [members, setMembers] = useState<Map<string, Member>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen options={{ title: title ?? 'Space' }} />
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
          {messages?.map((m) => <MessageRow key={m.id} message={m} member={members.get(m.author.memberId)} />)}
          {messages?.length === 0 ? (
            <Text style={{ textAlign: 'center', marginTop: 48, fontSize: 14, color: colors.tertiaryLabel }}>
              No messages yet — say hi.
            </Text>
          ) : null}
        </ScrollView>
      )}

      {/* Composer */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 8 }}>
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
    </KeyboardAvoidingView>
  );
}

function applyReaction(message: Message, emoji: string, memberId: string, action: 'added' | 'removed'): Message {
  const groups = message.reactions.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
  const group = groups.find((g) => g.emoji === emoji);
  if (action === 'added') {
    if (group) {
      if (!group.memberIds.includes(memberId)) group.memberIds.push(memberId);
    } else {
      groups.push({ emoji, memberIds: [memberId] });
    }
  } else if (group) {
    group.memberIds = group.memberIds.filter((id) => id !== memberId);
  }
  return { ...message, reactions: groups.filter((g) => g.memberIds.length > 0) };
}

function MessageRow({ message, member }: { message: Message; member?: Member }) {
  const colors = useColors();
  const name = member?.displayName ?? message.author.memberId;
  const agent = message.author.actingMode !== 'direct';
  const time = new Date(message.postedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (message.deletedAt) {
    return (
      <Text style={{ paddingHorizontal: 16, paddingVertical: 6, fontSize: 13, fontStyle: 'italic', color: colors.tertiaryLabel }}>
        Message deleted
      </Text>
    );
  }

  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 6 }}>
      <View
        style={{
          width: 34, height: 34, borderRadius: 8, borderCurve: 'continuous', marginTop: 2,
          alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryBackground,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.secondaryLabel }}>
          {(name[0] ?? '?').toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.label }}>
            {name}
            {agent ? <Text style={{ fontWeight: '400', color: colors.tertiaryLabel }}>  (agent)</Text> : null}
          </Text>
          <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>{time}</Text>
        </View>
        <ChatMarkdown>{message.body}</ChatMarkdown>
        {message.reactions.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {message.reactions.map((g) => (
              <View
                key={g.emoji}
                style={{
                  flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 3,
                  borderRadius: 12, backgroundColor: colors.secondaryBackground,
                }}
              >
                <Text style={{ fontSize: 13 }}>{g.emoji}</Text>
                <Text style={{ fontSize: 13, color: colors.secondaryLabel }}>{g.memberIds.length}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {message.replyCount > 0 ? (
          <Text style={{ marginTop: 4, fontSize: 13, color: colors.secondaryLabel }}>
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
