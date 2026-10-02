import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Message, Poll } from '@rowboat/spaces-protocol';

import { useColors } from '@/theme/colors';

// The poll surface, Discord's shape (desktop poll-card.tsx for parity):
// question, "Select one answer", answer rows with the pick control on the
// right, "N votes · 23h left" footer with Show results + Vote. Results are
// bars once you voted, peeked, or the poll closed. Renders INSTEAD of the
// message body (the body is the markdown fallback for poll-blind clients).

export function pollClosed(poll: Poll, now: Date = new Date()): boolean {
  return !!poll.endedAt || Date.parse(poll.expiresAt) <= now.getTime();
}

export function myPollVotes(poll: Poll, memberId: string | undefined): number[] {
  if (!memberId) return [];
  return poll.votes.filter((g) => g.memberIds.includes(memberId)).map((g) => g.answerId);
}

/** Distinct voters — the percentage denominator. */
export function pollVoterCount(poll: Poll): number {
  return new Set(poll.votes.flatMap((g) => g.memberIds)).size;
}

/** Fold one vote toggle — the applyReaction of polls (single-select moves the vote). */
export function applyPollVote(poll: Poll, event: { answerId: number; memberId: string; action: 'added' | 'removed' }): Poll {
  let votes = poll.votes;
  if (event.action === 'added' && !poll.allowMultiselect) {
    votes = votes
      .map((g) => (g.answerId === event.answerId ? g : { ...g, memberIds: g.memberIds.filter((id) => id !== event.memberId) }))
      .filter((g) => g.memberIds.length > 0);
  }
  const existing = votes.find((g) => g.answerId === event.answerId);
  if (event.action === 'added') {
    if (existing?.memberIds.includes(event.memberId)) return { ...poll, votes };
    const next = existing
      ? votes.map((g) => (g.answerId === event.answerId ? { ...g, memberIds: [...g.memberIds, event.memberId] } : g))
      : [...votes, { answerId: event.answerId, memberIds: [event.memberId] }];
    const order = new Map(poll.answers.map((a, i) => [a.id, i]));
    return { ...poll, votes: [...next].sort((a, b) => (order.get(a.answerId) ?? 0) - (order.get(b.answerId) ?? 0)) };
  }
  if (!existing?.memberIds.includes(event.memberId)) return { ...poll, votes };
  return {
    ...poll,
    votes: votes
      .map((g) => (g.answerId === event.answerId ? { ...g, memberIds: g.memberIds.filter((id) => id !== event.memberId) } : g))
      .filter((g) => g.memberIds.length > 0),
  };
}

export function pollDeadlineLabel(poll: Poll, now: Date = new Date()): string {
  if (pollClosed(poll, now)) return 'Final results';
  const minutes = Math.max(1, Math.round((Date.parse(poll.expiresAt) - now.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

export function PollCard({ message, poll, me, onVote, onRemoveVote, onEndPoll }: {
  message: Message;
  poll: Poll;
  me: string;
  onVote: (message: Message, answerIds: number[]) => void;
  onRemoveVote: (message: Message) => void;
  /** Offered to the author while the poll is open. */
  onEndPoll?: (message: Message) => void;
}) {
  const colors = useColors();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const closed = pollClosed(poll, now);
  const mine = myPollVotes(poll, me);
  const voted = mine.length > 0;
  const [peeking, setPeeking] = useState(false);
  const showResults = voted || closed || peeking;
  const voterCount = pollVoterCount(poll);
  const countOf = (id: number) => poll.votes.find((g) => g.answerId === id)?.memberIds.length ?? 0;
  const topCount = poll.votes.reduce((max, g) => Math.max(max, g.memberIds.length), 0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const isAuthor = message.author.memberId === me;

  const toggleSelect = (id: number) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (!poll.allowMultiselect) next.clear();
        next.add(id);
      }
      return next;
    });
  };

  const footerButton = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderCurve: 'continuous',
        backgroundColor: primary ? colors.label : 'transparent',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: primary ? colors.background : colors.label }}>{label}</Text>
    </Pressable>
  );

  return (
    <View
      style={{
        marginTop: 4, padding: 12, gap: 8, borderRadius: 12, borderCurve: 'continuous',
        borderWidth: 0.5, borderColor: colors.separator, backgroundColor: colors.secondaryBackground,
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.label }}>{poll.question}</Text>
      {!showResults ? (
        <Text style={{ fontSize: 12, color: colors.tertiaryLabel, marginTop: -4 }}>
          {poll.allowMultiselect ? 'Select one or more answers' : 'Select one answer'}
        </Text>
      ) : null}

      <View style={{ gap: 6 }}>
        {poll.answers.map((answer) => {
          const count = countOf(answer.id);
          const percent = voterCount > 0 ? Math.round((count / voterCount) * 100) : 0;
          const isMine = mine.includes(answer.id);
          const winner = closed && count > 0 && count === topCount;
          if (showResults) {
            return (
              <View
                key={answer.id}
                style={{
                  overflow: 'hidden', borderRadius: 8, borderCurve: 'continuous',
                  borderWidth: winner ? 1 : 0.5, borderColor: winner ? colors.label : colors.separator, backgroundColor: colors.background,
                }}
              >
                <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${percent}%`, backgroundColor: winner ? colors.separator : colors.secondaryBackground }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 }}>
                  {answer.emoji ? <Text style={{ fontSize: 15 }}>{answer.emoji}</Text> : null}
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: winner ? '600' : '400', color: colors.label }}>{answer.text}</Text>
                  {isMine ? <Image source="sf:checkmark" style={{ width: 13, height: 13 }} tintColor={colors.label} /> : null}
                  <Text style={{ fontSize: 12, color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }}>{percent}%</Text>
                </View>
              </View>
            );
          }
          const on = selected.has(answer.id);
          return (
            <Pressable
              key={answer.id}
              onPress={() => toggleSelect(answer.id)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 9,
                borderRadius: 8, borderCurve: 'continuous', borderWidth: on ? 1 : 0.5,
                borderColor: on ? colors.label : colors.separator, backgroundColor: pressed ? colors.separator : colors.background,
              })}
            >
              {answer.emoji ? <Text style={{ fontSize: 15 }}>{answer.emoji}</Text> : null}
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.label }}>{answer.text}</Text>
              <Image
                source={poll.allowMultiselect ? (on ? 'sf:checkmark.square.fill' : 'sf:square') : on ? 'sf:checkmark.circle.fill' : 'sf:circle'}
                style={{ width: 18, height: 18 }}
                tintColor={on ? colors.label : colors.tertiaryLabel}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
        <Text style={{ flex: 1, fontSize: 12, color: colors.secondaryLabel }}>
          {voterCount} {voterCount === 1 ? 'vote' : 'votes'} · {pollDeadlineLabel(poll, now)}
        </Text>
        {closed ? null : showResults ? (
          voted
            ? footerButton('Remove vote', () => onRemoveVote(message))
            : footerButton('Back to vote', () => setPeeking(false))
        ) : (
          <>
            {footerButton('Show results', () => setPeeking(true))}
            {selected.size > 0 ? footerButton('Vote', () => { onVote(message, [...selected]); setSelected(new Set()); }, true) : null}
          </>
        )}
        {!closed && isAuthor && onEndPoll ? footerButton('End', () => onEndPoll(message)) : null}
      </View>
    </View>
  );
}
