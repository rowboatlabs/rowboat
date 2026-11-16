import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import type { spaces } from '@x/shared';

import { EmojiPicker } from '@/components/emoji-picker';
import { Group, PrimaryButton } from '@/components/grouped';
import { Image } from '@/components/sf-image';
import { friendlyError } from '@/lib/spaces/errors';
import { useOrgClient } from '@/lib/spaces/invites';
import { postMessageReliably } from '@/lib/spaces/send';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Create a poll (2026-11-13, the desktop's poll-dialog.tsx): a question, 2–10
// answers each with an optional emoji, a duration (24 hours by default), and
// "allow multiple answers". Opened from the composer's "+"; posts into the
// stream, or into the thread it was opened from. The new poll reaches the
// chat over the live socket, like any message.

// Limits and durations as the desktop's lib/spaces-poll.ts (the server's NewPoll bounds).
const POLL_MAX_ANSWERS = 10;
const POLL_QUESTION_MAX = 300;
const POLL_ANSWER_MAX = 55;
const POLL_DURATIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 4, label: '4 hours' },
  { hours: 8, label: '8 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 336, label: '2 weeks' },
];
const POLL_DEFAULT_HOURS = 24;
const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/** The markdown body poll-blind clients, search and notifications see — the desktop's, character for character. */
function pollFallbackBody(input: spaces.SpacesNewPollInput): string {
  const lines = input.answers.map((a, i) => `${a.emoji ?? NUMBERS[i] ?? '•'} ${a.text}`);
  return `📊 **${input.question}**\n\n${lines.join('\n')}`;
}

export default function NewPollScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; space: string; root?: string; me: string }>();
  const client = useOrgClient(params.org);
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<{ text: string; emoji?: string }[]>([{ text: '' }, { text: '' }]);
  const [hours, setHours] = useState(POLL_DEFAULT_HOURS);
  const [multi, setMulti] = useState(false);
  const [posting, setPosting] = useState(false);
  const [emojiFor, setEmojiFor] = useState<number | null>(null);

  const filled = answers.map((a) => ({ ...a, text: a.text.trim() })).filter((a) => a.text.length > 0);
  const canPost = question.trim().length > 0 && filled.length >= 2 && !posting;
  const setAnswer = (i: number, patch: { text?: string; emoji?: string }) =>
    setAnswers((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const post = async () => {
    if (!canPost) return;
    setPosting(true);
    const input: spaces.SpacesNewPollInput = {
      question: question.trim().slice(0, POLL_QUESTION_MAX),
      answers: filled.map((a) => ({ text: a.text, ...(a.emoji ? { emoji: a.emoji } : {}) })),
      durationHours: hours,
      allowMultiselect: multi,
    };
    try {
      await postMessageReliably(
        client,
        params.space,
        { body: pollFallbackBody(input), poll: input, ...(params.root ? { threadRoot: params.root } : {}) },
        params.me,
      );
      router.back();
    } catch (err) {
      // The draft stays for another try.
      Alert.alert("Couldn't post the poll", friendlyError(err));
      setPosting(false);
    }
  };

  const field = { flex: 1, paddingVertical: 13, ...type.body, color: colors.label } as const;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }}
    >
      <Stack.Screen options={{ title: 'New poll' }} />
      <Group label="Question">
        <View style={{ paddingHorizontal: 14 }}>
          <TextInput
            autoFocus
            value={question}
            onChangeText={setQuestion}
            placeholder="What should we do?"
            placeholderTextColor={colors.tertiaryLabel}
            maxLength={POLL_QUESTION_MAX}
            style={field}
          />
        </View>
      </Group>

      <Group label="Answers">
        {answers.map((answer, i) => (
          <View key={i}>
            {i > 0 ? <View style={{ height: 0.5, marginLeft: 54, backgroundColor: colors.separator }} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 }}>
              <Pressable
                hitSlop={6}
                accessibilityLabel={answer.emoji ? 'Change emoji' : 'Add emoji'}
                onPress={() => setEmojiFor(i)}
                style={{ width: 28, alignItems: 'center' }}
              >
                {answer.emoji ? (
                  <Text style={{ fontSize: 20 }}>{answer.emoji}</Text>
                ) : (
                  <Image source="sf:face.smiling" style={{ width: 20, height: 20 }} tintColor={colors.tertiaryLabel} />
                )}
              </Pressable>
              <TextInput
                value={answer.text}
                onChangeText={(text) => setAnswer(i, { text })}
                placeholder={`Answer ${i + 1}`}
                placeholderTextColor={colors.tertiaryLabel}
                maxLength={POLL_ANSWER_MAX}
                style={field}
              />
              {answers.length > 2 ? (
                <Pressable hitSlop={8} accessibilityLabel="Remove answer" onPress={() => setAnswers((prev) => prev.filter((_, j) => j !== i))}>
                  <Image source="sf:minus.circle.fill" style={{ width: 20, height: 20 }} tintColor={colors.destructive} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
        {answers.length < POLL_MAX_ANSWERS ? (
          <Pressable
            onPress={() => {
              if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
              setAnswers((prev) => [...prev, { text: '' }]);
            }}
            style={({ pressed }) => ({ backgroundColor: pressed ? colors.secondaryBackground : 'transparent' })}
          >
            <View style={{ height: 0.5, marginLeft: 54, backgroundColor: colors.separator }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14 }}>
              <View style={{ width: 28, alignItems: 'center' }}>
                <Image source="sf:plus.circle.fill" style={{ width: 20, height: 20 }} tintColor={colors.accent} />
              </View>
              <Text style={{ ...type.body, color: colors.accent }}>Add answer</Text>
            </View>
          </Pressable>
        ) : null}
      </Group>

      <Group label="Duration">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 12 }}>
          {POLL_DURATIONS.map((d) => {
            const on = d.hours === hours;
            return (
              <Pressable
                key={d.hours}
                onPress={() => {
                  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                  setHours(d.hours);
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: on ? colors.label : colors.secondaryBackground }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: on ? colors.background : colors.label }}>{d.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Group>

      <Group>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14 }}>
          <Text style={{ flex: 1, ...type.body, color: colors.label }}>Allow multiple answers</Text>
          <Switch value={multi} onValueChange={setMulti} />
        </View>
      </Group>

      <PrimaryButton label={posting ? 'Posting' : 'Post poll'} busy={posting} disabled={!canPost} onPress={() => void post()} />

      <EmojiPicker
        visible={emojiFor !== null}
        onClose={() => setEmojiFor(null)}
        onPick={(emoji) => {
          if (emojiFor !== null) setAnswer(emojiFor, { emoji });
          setEmojiFor(null);
        }}
      />
    </ScrollView>
  );
}
