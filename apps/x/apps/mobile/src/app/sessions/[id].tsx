import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { sessions as sessionsShared } from '@x/shared';

import * as analytics from '@/lib/analytics';
import { StatusPill } from '@/components/status-pill';
import { TurnView } from '@/components/turn-view';
import { useConnection } from '@/lib/connection';
import { useLiveTurn } from '@/lib/use-live-turn';

// One chat session: every turn is followed live through the shared
// turn-follower (so permission prompts and streaming work on any of them);
// only the newest turn subscribes to text deltas.

function Turn({ turnId, isLatest }: { turnId: string; isLatest: boolean }) {
  const { sessions } = useConnection();
  const { state, liveText, error } = useLiveTurn(turnId, { deltas: isLatest });

  const onPermission = useCallback(
    (toolCallId: string, decision: 'allow' | 'deny') => {
      void sessions?.respondToPermission(turnId, toolCallId, decision);
    },
    [sessions, turnId],
  );
  const onAskHuman = useCallback(
    (toolCallId: string, answer: string) => {
      void sessions?.respondToAskHuman(turnId, toolCallId, answer);
    },
    [sessions, turnId],
  );

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!state) return <Text style={styles.loading}>…</Text>;
  return (
    <TurnView
      state={state}
      liveText={isLatest ? liveText : undefined}
      streaming={isLatest && !state.terminal}
      onPermission={onPermission}
      onAskHuman={onAskHuman}
    />
  );
}

export default function ChatScreen() {
  const scheme = useColorScheme();
  const textColor = scheme === 'dark' ? '#fff' : '#000';
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sessions, events } = useConnection();
  const [session, setSession] = useState<sessionsShared.SessionState | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const refresh = useCallback(async () => {
    if (!sessions || !id) return;
    try {
      setSession(await sessions.get(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessions, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const turnRefs = session?.turns ?? [];
  const knownTurnIds = turnRefs.map((t) => t.turnId).join(',');

  useEffect(() => {
    if (!events) return;
    // New turns (from this phone or any other client) show up on the session
    // bus; a resync after reconnect refetches the index. Turn events for a
    // turn we don't know yet cover the race where the turn started before
    // this screen's WS connected (its session bus event was never received).
    const known = new Set(knownTurnIds.split(',').filter(Boolean));
    const offEvents = events.on('sessions:events', (payload) => {
      const e = payload as { sessionId?: string };
      if (e.sessionId === id) void refresh();
    });
    const offTurns = events.on('turns:events', (payload) => {
      const e = payload as { turnId: string; sessionId: string | null };
      if (e.sessionId === id && !known.has(e.turnId)) void refresh();
    });
    const offStatus = events.onStatus((status) => {
      if (status === 'connected') void refresh();
    });
    const offResync = events.onResync(() => void refresh());
    return () => {
      offEvents();
      offTurns();
      offStatus();
      offResync();
    };
  }, [events, id, refresh, knownTurnIds]);
  const latestTurnId = turnRefs[turnRefs.length - 1]?.turnId;

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || !sessions || !id) return;
    setSending(true);
    setDraft('');
    try {
      const agentId = turnRefs[turnRefs.length - 1]?.agentId ?? 'copilot';
      await sessions.sendMessage(id, { role: 'user', content }, { agent: { agentId } });
      analytics.mobileMessageSent();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDraft(content); // don't lose the message
    } finally {
      setSending(false);
    }
  }, [draft, sessions, id, turnRefs, refresh]);

  const stop = useCallback(() => {
    if (latestTurnId) void sessions?.stopTurn(latestTurnId);
  }, [sessions, latestTurnId]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: session?.title || 'Chat',
          headerRight: () => <StatusPill />,
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 92 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {error && <Text style={styles.error}>{error}</Text>}
          {turnRefs.map((ref) => (
            <Turn key={ref.turnId} turnId={ref.turnId} isLatest={ref.turnId === latestTurnId} />
          ))}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            style={[styles.input, { color: textColor }]}
            placeholder="Message Rowboat…"
            placeholderTextColor="#888"
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!sending}
          />
          <Button title="Stop" onPress={stop} disabled={!latestTurnId} />
          <Button title="Send" onPress={() => void send()} disabled={sending || !draft.trim()} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  scroll: { padding: 16 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#999',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    maxHeight: 120,
  },
  loading: { opacity: 0.4, marginBottom: 16 },
  error: { color: '#c0392b', marginBottom: 8 },
});
