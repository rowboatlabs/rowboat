import { Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardVisible } from '@/lib/use-keyboard-visible';
import type { Member, Message } from '@rowboat/spaces-protocol';

import { spaces } from '@x/shared';

import { ChatMarkdown } from '@/components/markdown';
import { MessageLinkPreviews } from '@/components/link-preview-card';
import { SpaceBlobImage } from '@/components/space-blob-image';
import { MessageActionSheet, MessageRow, applyReaction } from '@/components/space-message';
import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { SpacesLive } from '@/lib/spaces/live';
import { useColors } from '@/theme/colors';

// One flat thread: root pinned on top, replies below, composer posts with
// threadRoot. Live folds replies + reactions addressed to this thread.
export default function SpaceThreadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const account = useSpacesAccount();
  const params = useLocalSearchParams<{ org: string; space: string; root: string; title: string; me: string }>();
  const { org, space, root, me } = params;

  const client = useMemo(
    () => new SpacesClient({ baseUrl: `https://${org}`, token: (opts) => account.getAccessToken(opts) }),
    [org, account],
  );

  const [rootMessage, setRootMessage] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[] | null>(null);
  const [members, setMembers] = useState<Map<string, Member>>(new Map());
  const memberNames = useMemo(() => new Map([...members].map(([id, m]) => [id, m.displayName])), [members]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [reactionsOnly, setReactionsOnly] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const lastOffset = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.listThread(space, root), client.listMembers(space)])
      .then(([thread, memberList]) => {
        if (cancelled) return;
        setMembers(new Map(memberList.map((m) => [m.id, m])));
        setRootMessage(thread.root);
        setReplies(thread.messages);
        lastOffset.current = thread.messages.at(-1)?.offset ?? thread.root.offset;
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [client, space, root]);

  useEffect(() => {
    if (replies === null) return;
    const live = new SpacesLive({ baseUrl: `https://${org}`, token: () => account.getAccessToken() });
    const off = live.subscribe(
      space,
      (frame) => {
        if (frame.kind !== 'event') return;
        const event = frame.event;
        if (event.type === 'message' && event.message.threadRoot === root) {
          setReplies((prev) => (prev && !prev.some((m) => m.id === event.message.id) ? [...prev, event.message] : prev));
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

  // Land on the root (what you tapped); scroll only when a new reply lands.
  const seenReplies = useRef<number | null>(null);
  useEffect(() => {
    const n = replies?.length;
    if (n === undefined) return;
    if (seenReplies.current !== null && n > seenReplies.current) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
    seenReplies.current = n;
  }, [replies?.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setSending(true);
    setDraft('');
    try {
      const { message } = await client.postMessage(space, { body, threadRoot: root, actingMode: 'direct' });
      setReplies((prev) => (prev && !prev.some((m) => m.id === message.id) ? [...prev, message] : prev));
    } catch (err) {
      setDraft(body);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.label }}>Thread</Text>
              {params.title ? <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>#{params.title}</Text> : null}
            </View>
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
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 12 }}
        >
          {error ? <Text style={{ fontSize: 13, color: colors.destructive, paddingHorizontal: 16, paddingBottom: 8 }}>{error}</Text> : null}
          {rootMessage ? (
            <RootMessage
              message={rootMessage}
              member={members.get(rootMessage.author.memberId)}
              memberNames={memberNames}
              me={me}
              onToggleReaction={toggleReaction}
              onLongPress={(m) => { setReactionsOnly(false); setActionMessage(m); }}
              onAddReaction={(m) => { setReactionsOnly(true); setActionMessage(m); }}
            />
          ) : null}
          {rootMessage && replies !== null ? (
            <Pressable
              onPress={replies.length === 0 ? () => inputRef.current?.focus() : undefined}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4,
                paddingHorizontal: 16, paddingVertical: 12,
                borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: colors.separator,
              }}
            >
              {replies.length === 0 ? (
                <>
                  <Image source="sf:bubble.left" style={{ width: 17, height: 17 }} tintColor={colors.secondaryLabel} />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.secondaryLabel }}>Reply in Thread</Text>
                </>
              ) : (
                <Text style={{ fontSize: 15, color: colors.secondaryLabel }}>
                  {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                </Text>
              )}
            </Pressable>
          ) : null}
          {replies?.map((m) => (
            <MessageRow key={m.id} message={m} member={members.get(m.author.memberId)} memberNames={memberNames} me={me} onToggleReaction={toggleReaction} onLongPress={(m) => { setReactionsOnly(false); setActionMessage(m); }}
              onAddReaction={(m) => { setReactionsOnly(true); setActionMessage(m); }} />
          ))}
        </ScrollView>
      )}

      {/* Composer — Slack's single rounded field; send arrow appears with a draft */}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: (keyboardVisible ? 0 : insets.bottom) + 8 }}>
        <View
          style={{
            flexDirection: 'row', alignItems: 'flex-end',
            backgroundColor: colors.secondaryBackground, borderRadius: 24, borderCurve: 'continuous',
            paddingLeft: 16, paddingRight: 6, minHeight: 46,
          }}
        >
          <TextInput
            ref={inputRef}
            style={{ flex: 1, maxHeight: 120, fontSize: 16, color: colors.label, paddingVertical: 12 }}
            placeholder="Add a reply"
            placeholderTextColor={colors.tertiaryLabel}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          {draft.trim() ? (
            <Pressable onPress={() => void send()} disabled={sending} style={{ padding: 6, opacity: sending ? 0.4 : 1 }}>
              <Image source="sf:arrow.up.circle.fill" style={{ width: 30, height: 30 }} tintColor={colors.label} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <MessageActionSheet
        reactionsOnly={reactionsOnly}
        message={actionMessage}
        me={me}
        onClose={() => setActionMessage(null)}
        onToggleReaction={toggleReaction}
      />
    </KeyboardAvoidingView>
  );
}

// The root, Slack-style: 40pt avatar, bold name with the timestamp UNDER it,
// full-size body, then reaction pills + the always-on emoji+ pill.
function RootMessage({ message, member, memberNames, me, onToggleReaction, onLongPress, onAddReaction }: {
  message: Message;
  member?: Member;
  memberNames: ReadonlyMap<string, string>;
  me: string;
  onToggleReaction: (message: Message, emoji: string) => void;
  onLongPress: (message: Message) => void;
  onAddReaction: (message: Message) => void;
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
      <ChatMarkdown extraRules={imageRule}>{body}</ChatMarkdown>
      <MessageLinkPreviews body={message.body} />
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
