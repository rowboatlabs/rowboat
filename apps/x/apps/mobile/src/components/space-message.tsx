import * as Haptics from 'expo-haptics';
import { memo, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { Member, Message } from '@rowboat/spaces-protocol';

import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { spaces } from '@x/shared';

import { ChatMarkdown } from '@/components/markdown';
import { MessageLinkPreviews } from '@/components/link-preview-card';
import { PollCard } from '@/components/poll-card';
import { SpaceBlobImage } from '@/components/space-blob-image';
import { EmojiPicker } from '@/components/emoji-picker';
import { BottomSheet } from '@/components/bottom-sheet';
import { useColors } from '@/theme/colors';

// Shared message presentation for the stream and thread screens: row, reaction
// chips, long-press action sheet. All server calls stay in the screens — this
// file only renders and calls back.

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

/** Local fold of one reaction toggle — mirrors the server's read-side fold. */
export function applyReaction(message: Message, emoji: string, memberId: string, action: 'added' | 'removed'): Message {
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

// Deterministic avatar tint per author so rows scan like Slack's, without
// shipping profile images. Muted so both themes keep contrast with the initial.
const AVATAR_HUES = [211, 32, 145, 262, 90, 340, 174, 20];
function avatarColor(id: string, dark: boolean): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${AVATAR_HUES[h % AVATAR_HUES.length]}, 45%, ${dark ? 32 : 82}%)`;
}

export const MessageRow = memo(function MessageRow({
  message,
  member,
  memberNames,
  me,
  onToggleReaction,
  onOpenThread,
  onLongPress,
  onAddReaction,
  alwaysShowReactionBar,
  onVote,
  onRemoveVote,
  onEndPoll,
}: {
  message: Message;
  member?: Member;
  /** id → displayName for the whole space — resolves @<memberId> mentions. */
  memberNames?: ReadonlyMap<string, string>;
  me: string;
  onToggleReaction: (message: Message, emoji: string) => void;
  /** Omit on the thread screen (replies have no threads). */
  onOpenThread?: (message: Message) => void;
  onLongPress: (message: Message) => void;
  /** The emoji+ pill — a reactions-only picker (defaults to the full sheet). */
  onAddReaction?: (message: Message) => void;
  /** Thread root: keep the emoji+ pill visible even with zero reactions (Slack). */
  alwaysShowReactionBar?: boolean;
  /** Polls: cast / withdraw / end. Absent = read-only card. */
  onVote?: (message: Message, answerIds: number[]) => void;
  onRemoveVote?: (message: Message) => void;
  onEndPoll?: (message: Message) => void;
}) {
  const colors = useColors();
  const dark = colors.isDark;
  const name = member?.displayName ?? message.author.memberId;
  const agent = message.author.actingMode !== 'direct';
  const time = new Date(message.postedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // Wire member addresses ("@01ABC…") → bold display names, code spans untouched.
  const body = useMemo(
    () => (memberNames ? spaces.decorateMentions(message.body, memberNames) : message.body),
    [message.body, memberNames],
  );

  // Long-press a reaction chip → who reacted (opens on that emoji's tab).
  const [reactorsFor, setReactorsFor] = useState<string | null>(null);

  const imageRule = useMemo(
    () => ({
      image: (node: { key: string; attributes: { src?: string } }) =>
        node.attributes.src ? <SpaceBlobImage key={node.key} src={node.attributes.src} /> : null,
    }),
    [],
  );

  // Deleted messages are filtered out by the screens (Slack); one that still
  // has replies stays as a placeholder so its thread remains reachable.
  if (message.deletedAt) {
    return (
      <Pressable
        onPress={onOpenThread && message.replyCount > 0 ? () => onOpenThread(message) : undefined}
        style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 6 }}
      >
        <View
          style={{
            width: 34, height: 34, borderRadius: 8, borderCurve: 'continuous', marginTop: 2,
            alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryBackground,
          }}
        >
          <Image source="sf:trash" style={{ width: 15, height: 15 }} tintColor={colors.tertiaryLabel} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: 4 }}>
          <Text style={{ fontSize: 15, color: colors.tertiaryLabel }}>This message was deleted.</Text>
          {onOpenThread && message.replyCount > 0 ? (
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#0a84ff' }}>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'} ›
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <>
    <Pressable
      // Tap opens the thread (Slack); long-press keeps the action sheet.
      onPress={onOpenThread ? () => onOpenThread(message) : undefined}
      onLongPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress(message);
      }}
      delayLongPress={250}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 6,
        backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
      })}
    >
      <View
        style={{
          width: 34, height: 34, borderRadius: 8, borderCurve: 'continuous', marginTop: 2,
          alignItems: 'center', justifyContent: 'center', backgroundColor: avatarColor(message.author.memberId, dark),
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.label }}>
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
          {message.editedAt ? <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>(edited)</Text> : null}
        </View>
        {message.poll ? (
          <PollCard
            message={message}
            poll={message.poll}
            me={me}
            onVote={onVote ?? (() => {})}
            onRemoveVote={onRemoveVote ?? (() => {})}
            onEndPoll={onEndPoll}
          />
        ) : (
          <>
            <ChatMarkdown extraRules={imageRule}>{body}</ChatMarkdown>
            <MessageLinkPreviews body={message.body} />
          </>
        )}
        {message.reactions.length > 0 || alwaysShowReactionBar ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {message.reactions.map((g) => {
              const mine = g.memberIds.includes(me);
              return (
                <Pressable
                  key={g.emoji}
                  onPress={() => {
                    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                    onToggleReaction(message, g.emoji);
                  }}
                  onLongPress={() => {
                    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setReactorsFor(g.emoji);
                  }}
                  delayLongPress={250}
                  style={{
                    flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 3,
                    borderRadius: 12, backgroundColor: colors.secondaryBackground,
                    borderWidth: 1, borderColor: mine ? colors.label : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 13 }}>{g.emoji}</Text>
                  <Text style={{ fontSize: 13, fontWeight: mine ? '600' : '400', color: mine ? colors.label : colors.secondaryLabel }}>
                    {g.memberIds.length}
                  </Text>
                </Pressable>
              );
            })}
            {/* Slack's add-reaction pill: emoji picker only. */}
            <Pressable
              onPress={() => {
                if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                (onAddReaction ?? onLongPress)(message);
              }}
              style={{
                flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3,
                borderRadius: 12, backgroundColor: colors.secondaryBackground,
              }}
            >
              <Image source="sf:face.smiling" style={{ width: 14, height: 14 }} tintColor={colors.secondaryLabel} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.secondaryLabel, marginLeft: 1, marginTop: -6 }}>+</Text>
            </Pressable>
          </View>
        ) : null}
        {onOpenThread && message.replyCount > 0 ? (
          <Pressable onPress={() => onOpenThread(message)} hitSlop={6} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#0a84ff' }}>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'} ›
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
    {reactorsFor !== null ? (
      <ReactorsSheet
        message={message}
        initial={reactorsFor}
        me={me}
        memberNames={memberNames}
        onClose={() => setReactorsFor(null)}
      />
    ) : null}
    </>
  );
});

/**
 * Who reacted (Slack's reactions sheet): an "All" tab plus one tab per emoji,
 * each listing the people behind it. Names come from the space roster; you
 * show as "You".
 */
function ReactorsSheet({
  message,
  initial,
  me,
  memberNames,
  onClose,
}: {
  message: Message;
  initial: string;
  me: string;
  memberNames?: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const colors = useColors();
  const dark = colors.isDark;
  const [tab, setTab] = useState<string>(initial);
  const nameOf = (id: string) => (id === me ? 'You' : memberNames?.get(id) ?? 'Unknown member');
  const total = message.reactions.reduce((n, g) => n + g.memberIds.length, 0);
  const rows =
    tab === 'all'
      ? message.reactions.flatMap((g) => g.memberIds.map((id) => ({ id, emoji: g.emoji })))
      : (message.reactions.find((g) => g.emoji === tab)?.memberIds ?? []).map((id) => ({ id, emoji: tab }));

  const tabs = [{ key: 'all', label: `All ${total}` }, ...message.reactions.map((g) => ({ key: g.emoji, label: `${g.emoji} ${g.memberIds.length}` }))];

  return (
    <BottomSheet visible={true} onClose={onClose} maxHeight={0.6}
      style={{ paddingTop: 10, paddingBottom: 34, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.background }}
    >
          <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.separator, marginBottom: 12 }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 10 }}>
            {tabs.map((t) => {
              const on = t.key === tab;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                    setTab(t.key);
                  }}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: on ? colors.label : colors.secondaryBackground }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: on ? colors.background : colors.label }}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ height: 0.5, backgroundColor: colors.separator }} />
          <ScrollView contentContainerStyle={{ paddingVertical: 6 }}>
            {rows.map(({ id, emoji }) => {
              const name = nameOf(id);
              return (
                <View key={`${emoji}:${id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 }}>
                  <View
                    style={{
                      width: 32, height: 32, borderRadius: 8, borderCurve: 'continuous',
                      alignItems: 'center', justifyContent: 'center', backgroundColor: avatarColor(id, dark),
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.label }}>{(name[0] ?? '?').toUpperCase()}</Text>
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: colors.label }}>{name}</Text>
                  {tab === 'all' ? <Text style={{ fontSize: 20 }}>{emoji}</Text> : null}
                </View>
              );
            })}
          </ScrollView>
    </BottomSheet>
  );
}

/** Long-press sheet: quick reactions + reply. Kept dependency-free (RN Modal). */
export function MessageActionSheet({
  message,
  me,
  onClose,
  onToggleReaction,
  onReply,
  onQuote,
  onEdit,
  onDelete,
  linkFor,
  reactionsOnly,
}: {
  message: Message | null;
  me: string;
  onClose: () => void;
  onToggleReaction: (message: Message, emoji: string) => void;
  /** Omit on the thread screen — the composer is already the reply box. */
  onReply?: (message: Message) => void;
  onQuote?: (message: Message) => void;
  /** Author-only (the content plane is role-flat). */
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  /** The message's canonical link (https://<org>/s/<space>/m/<id>). */
  linkFor?: (message: Message) => string;
  /** The emoji+ pill's mode: just the reactions row. */
  reactionsOnly?: boolean;
}) {
  const colors = useColors();
  const [more, setMore] = useState(false);
  if (!message) return null;
  const mine = new Set(message.reactions.filter((g) => g.memberIds.includes(me)).map((g) => g.emoji));
  const isAuthor = message.author.memberId === me;

  // Slack's long-press menu, cut to what the org supports.
  const actions: { key: string; icon: string; label: string; destructive?: boolean; run: () => void }[] = [];
  if (onReply) actions.push({ key: 'reply', icon: 'sf:arrowshape.turn.up.left', label: 'Reply in thread', run: () => onReply(message) });
  if (onQuote) actions.push({ key: 'quote', icon: 'sf:quote.opening', label: 'Quote reply', run: () => onQuote(message) });
  actions.push({ key: 'copy', icon: 'sf:doc.on.doc', label: 'Copy message', run: () => void Clipboard.setStringAsync(message.body) });
  if (linkFor) actions.push({ key: 'link', icon: 'sf:link', label: 'Copy link', run: () => void Clipboard.setStringAsync(linkFor(message)) });
  if (isAuthor && onEdit && !message.poll) actions.push({ key: 'edit', icon: 'sf:pencil', label: 'Edit message', run: () => onEdit(message) });
  if (isAuthor && onDelete) actions.push({ key: 'delete', icon: 'sf:trash', label: 'Delete message', destructive: true, run: () => onDelete(message) });

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            marginHorizontal: 12, marginBottom: 40, padding: 10, gap: 6,
            borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.background,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: reactionsOnly ? 0 : 4 }}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => {
                  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                  onToggleReaction(message, emoji);
                  onClose();
                }}
                style={{
                  width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: mine.has(emoji) ? colors.secondaryBackground : 'transparent',
                }}
              >
                <Text style={{ fontSize: 26 }}>{emoji}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setMore(true)}
              style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryBackground }}
            >
              <Image source="sf:plus" style={{ width: 18, height: 18 }} tintColor={colors.secondaryLabel} />
            </Pressable>
          </View>
          <EmojiPicker
            visible={more}
            onClose={() => setMore(false)}
            onPick={(emoji) => {
              onToggleReaction(message, emoji);
              onClose();
            }}
          />
          {!reactionsOnly
            ? actions.map((a) => (
                <Pressable
                  key={a.key}
                  onPress={() => {
                    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                    onClose();
                    a.run();
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 46,
                    paddingHorizontal: 12, borderRadius: 12, borderCurve: 'continuous',
                    backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
                  })}
                >
                  <Image source={a.icon} style={{ width: 20, height: 20 }} tintColor={a.destructive ? colors.destructive : colors.secondaryLabel} />
                  <Text style={{ fontSize: 16, color: a.destructive ? colors.destructive : colors.label }}>{a.label}</Text>
                </Pressable>
              ))
            : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
