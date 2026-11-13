import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import type { Invocation } from '@rowboat/spaces-protocol';

import { BottomSheet } from '@/components/bottom-sheet';
import { Image } from '@/components/sf-image';
import type { SpacesClient } from '@/lib/spaces/client';
import { friendlyError } from '@/lib/spaces/errors';
import { useColors, type Colors } from '@/theme/colors';

// The line under a message that invoked an agent (Harbor spec §8; desktop
// invocation-lines.tsx, brought to the phone 2026-11-13): what the agent is
// doing about it right now — queued, working with its activity, waiting on a
// person, refused and why, failed. Done shows nothing: the agent's reply is
// the answer. The invoker can cancel a queued one; the invoker or a space
// admin can stop a running one when the agent's connector declared it can
// stop. Desktop's hover card of the turn's activity is a sheet here, opened
// by tapping a running line.

const RUNNING: readonly Invocation['state'][] = ['working', 'waiting'];

export function InvocationLines({ invocations, memberNames, me, isAdmin, canStop, client, onUpdated }: {
  /** This message's invocations, in any state. */
  invocations: readonly Invocation[];
  memberNames: ReadonlyMap<string, string>;
  me: string;
  /** A space admin may stop anyone's running agent. */
  isAdmin: boolean;
  /** Agents whose connector can stop a run (useAgentsCanStop). */
  canStop: ReadonlySet<string>;
  client: SpacesClient;
  /** The cancel's own answer, folded at once: the live frame may trail it. */
  onUpdated: (invocation: Invocation) => void;
}) {
  const colors = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const list = invocations.filter((i) => i.state !== 'done');
  if (list.length === 0) return null;

  const cancel = async (invocation: Invocation) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setBusy(invocation.id);
    try {
      onUpdated(await client.cancelInvocation(invocation.id));
    } catch (err) {
      Alert.alert('Couldn’t stop it', friendlyError(err, "You're offline. Try again when you're back online."));
    } finally {
      setBusy(null);
    }
  };
  const shownHistory = list.find((i) => i.id === historyFor && RUNNING.includes(i.state));

  return (
    <View style={{ marginTop: 4, gap: 4 }}>
      {list.map((invocation) => {
        const name = memberNames.get(invocation.agentId) ?? 'The agent';
        const mine = invocation.trigger.authorId === me;
        const running = RUNNING.includes(invocation.state);
        const canCancel = mine && (invocation.state === 'queued' || invocation.state === 'pending');
        const stoppable = running && (mine || isAdmin) && canStop.has(invocation.agentId);
        const { icon, text, tone } = describe(invocation, name, colors);
        const past = invocation.state === 'cancelled' || invocation.state === 'failed';
        return (
          <View key={invocation.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {invocation.state === 'working' ? <TypingDots color={tone} /> : <Image source={icon} style={{ width: past ? 11 : 13, height: past ? 11 : 13 }} tintColor={tone} />}
            <Pressable
              disabled={!running}
              onPress={() => setHistoryFor(invocation.id)}
              accessibilityRole={running ? 'button' : undefined}
              accessibilityHint={running ? `Shows what ${name} has done this turn` : undefined}
              style={{ flexShrink: 1 }}
            >
              <Text numberOfLines={past ? 1 : 2} style={{ fontSize: past ? 12 : 13, color: tone }}>{text}</Text>
            </Pressable>
            {invocation.link ? (
              <Pressable hitSlop={8} onPress={() => void Linking.openURL(invocation.link!).catch(() => {})} accessibilityRole="link">
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.secondaryLabel }}>Open</Text>
              </Pressable>
            ) : null}
            {canCancel ? (
              <Pressable hitSlop={8} disabled={busy === invocation.id} onPress={() => void cancel(invocation)} accessibilityRole="button">
                <Text style={{ fontSize: 13, fontWeight: '600', color: busy === invocation.id ? colors.tertiaryLabel : colors.label }}>Cancel</Text>
              </Pressable>
            ) : null}
            {stoppable ? (
              <Pressable
                hitSlop={8}
                disabled={busy === invocation.id || invocation.stopRequested}
                onPress={() => void cancel(invocation)}
                accessibilityRole="button"
                accessibilityLabel={`Stop ${name}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
              >
                {invocation.stopRequested ? null : <Image source="sf:stop.fill" style={{ width: 9, height: 9 }} tintColor={colors.destructive} />}
                <Text style={{ fontSize: 13, fontWeight: '600', color: invocation.stopRequested || busy === invocation.id ? colors.tertiaryLabel : colors.destructive }}>
                  {invocation.stopRequested ? 'Stopping…' : 'Stop'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <ActivitySheet invocation={shownHistory} name={shownHistory ? memberNames.get(shownHistory.agentId) ?? 'The agent' : ''} onClose={() => setHistoryFor(null)} />
    </View>
  );
}

/** Everything the agent reported this turn, newest at the bottom, following along while it works. */
function ActivitySheet({ invocation, name, onClose }: { invocation: Invocation | undefined; name: string; onClose: () => void }) {
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const entries = invocation?.activityHistory ?? [];
  return (
    <BottomSheet visible={invocation !== undefined} onClose={onClose} maxHeight={0.6}
      style={{ paddingTop: 10, paddingBottom: 34, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.background }}
    >
      <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.separator, marginBottom: 12 }} />
      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.label, paddingHorizontal: 20, paddingBottom: 8 }}>{name} · This turn</Text>
      <ScrollView ref={scrollRef} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 10 }}>
        {invocation && entries.length === 0 ? <Text style={{ fontSize: 14, color: colors.secondaryLabel }}>{describe(invocation, name, colors).text}</Text> : null}
        {invocation
          ? entries.map((entry) => (
              <Text key={entry.id} selectable style={{ fontSize: 14, lineHeight: 19, color: colors.secondaryLabel }}>
                {describe({ ...invocation, state: entry.state, activity: entry.activity }, name, colors).text}
              </Text>
            ))
          : null}
      </ScrollView>
    </BottomSheet>
  );
}

/** The same three pulsing dots as a person typing. */
function TypingDots({ color }: { color: string }) {
  const pulses = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        150,
        pulses.map((v) =>
          Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.timing(v, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [pulses]);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      {pulses.map((v, i) => (
        <Animated.View key={i} style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: color, opacity: v }} />
      ))}
    </View>
  );
}

/** "Claude is running `npm test`" for an activity that reads on from the name, else "Claude is working · Starting a workspace". */
function workingText(name: string, activity: string | undefined): string {
  if (!activity) return `${name} is typing…`;
  return /^is\s/.test(activity) ? `${name} ${activity}` : `${name} is working · ${activity}`;
}

function describe(invocation: Invocation, name: string, colors: Colors): { icon: string; text: string; tone: string } {
  const muted = colors.secondaryLabel;
  switch (invocation.state) {
    case 'queued':
      return { icon: 'sf:clock', text: `${name} will get to this next`, tone: muted };
    case 'pending':
      return { icon: 'sf:clock', text: `Waiting for ${name} to pick this up`, tone: muted };
    case 'working':
      return { icon: 'sf:clock', text: workingText(name, invocation.activity), tone: muted };
    case 'waiting':
      return { icon: 'sf:hand.raised', text: `${name} is waiting: ${invocation.activity ?? 'needs you to reply'}`, tone: colors.label };
    case 'refused':
      return { icon: 'sf:nosign', text: `${name} didn’t take this: ${invocation.refusal?.message ?? 'not allowed'}`, tone: muted };
    case 'failed':
      // Past states are quiet (2026-11-13): grey, not red; the thread goes on.
      return { icon: 'sf:exclamationmark.circle', text: invocation.error ? `${name} couldn’t finish · ${invocation.error}` : `${name} couldn’t finish`, tone: colors.tertiaryLabel };
    case 'cancelled':
      return { icon: 'sf:xmark.circle', text: `${name} · request cancelled`, tone: colors.tertiaryLabel };
    default:
      return { icon: 'sf:clock', text: name, tone: muted };
  }
}
