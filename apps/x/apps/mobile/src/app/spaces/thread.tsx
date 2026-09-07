import { Stack, useLocalSearchParams } from 'expo-router';
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

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(t);
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
      <Stack.Screen options={{ title: 'Thread' }} />
      {rootMessage === null && !error ? (
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
          {rootMessage ? (
            <MessageRow message={rootMessage} member={members.get(rootMessage.author.memberId)} memberNames={memberNames} me={me} onToggleReaction={toggleReaction} onLongPress={(m) => { setReactionsOnly(false); setActionMessage(m); }}
              onAddReaction={(m) => { setReactionsOnly(true); setActionMessage(m); }} />
          ) : null}
          {rootMessage && (replies?.length ?? 0) > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.tertiaryLabel }}>
                {replies!.length} {replies!.length === 1 ? 'REPLY' : 'REPLIES'}
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.separator }} />
            </View>
          ) : null}
          {replies?.map((m) => (
            <MessageRow key={m.id} message={m} member={members.get(m.author.memberId)} memberNames={memberNames} me={me} onToggleReaction={toggleReaction} onLongPress={(m) => { setReactionsOnly(false); setActionMessage(m); }}
              onAddReaction={(m) => { setReactionsOnly(true); setActionMessage(m); }} />
          ))}
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
          placeholder="Reply…"
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
        reactionsOnly={reactionsOnly}
        message={actionMessage}
        me={me}
        onClose={() => setActionMessage(null)}
        onToggleReaction={toggleReaction}
      />
    </KeyboardAvoidingView>
  );
}
