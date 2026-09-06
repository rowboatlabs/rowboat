import * as Haptics from 'expo-haptics';
import { memo, useMemo } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import type { Member, Message } from '@rowboat/spaces-protocol';

import { ChatMarkdown } from '@/components/markdown';
import { SpaceBlobImage } from '@/components/space-blob-image';
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
  me,
  onToggleReaction,
  onOpenThread,
  onLongPress,
}: {
  message: Message;
  member?: Member;
  me: string;
  onToggleReaction: (message: Message, emoji: string) => void;
  /** Omit on the thread screen (replies have no threads). */
  onOpenThread?: (message: Message) => void;
  onLongPress: (message: Message) => void;
}) {
  const colors = useColors();
  const dark = colors.background === '#000000';
  const name = member?.displayName ?? message.author.memberId;
  const agent = message.author.actingMode !== 'direct';
  const time = new Date(message.postedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const imageRule = useMemo(
    () => ({
      image: (node: { key: string; attributes: { src?: string } }) =>
        node.attributes.src ? <SpaceBlobImage key={node.key} src={node.attributes.src} /> : null,
    }),
    [],
  );

  if (message.deletedAt) {
    return (
      <Text style={{ paddingHorizontal: 16, paddingVertical: 6, fontSize: 13, fontStyle: 'italic', color: colors.tertiaryLabel }}>
        Message deleted
      </Text>
    );
  }

  return (
    <Pressable
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
        <ChatMarkdown extraRules={imageRule}>{message.body}</ChatMarkdown>
        {message.reactions.length > 0 ? (
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
  );
});

/** Long-press sheet: quick reactions + reply. Kept dependency-free (RN Modal). */
export function MessageActionSheet({
  message,
  me,
  onClose,
  onToggleReaction,
  onReply,
}: {
  message: Message | null;
  me: string;
  onClose: () => void;
  onToggleReaction: (message: Message, emoji: string) => void;
  /** Omit on the thread screen — the composer is already the reply box. */
  onReply?: (message: Message) => void;
}) {
  const colors = useColors();
  if (!message) return null;
  const mine = new Set(message.reactions.filter((g) => g.memberIds.includes(me)).map((g) => g.emoji));

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            marginHorizontal: 12, marginBottom: 40, padding: 14, gap: 12,
            borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.background,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
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
          </View>
          {onReply ? (
            <Pressable
              onPress={() => {
                onReply(message);
                onClose();
              }}
              style={({ pressed }) => ({
                paddingVertical: 12, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center',
                backgroundColor: pressed ? colors.separator : colors.secondaryBackground,
              })}
            >
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.label }}>Reply in thread</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
