import { Redirect, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { sessions as sessionsShared } from '@x/shared';
import type { DrawerNavigationProp } from 'expo-router/drawer';

import * as analytics from '@/lib/analytics';
import { FLAGS } from '@/lib/flags';
import { ModelPill } from '@/components/model-picker';
import { TurnView } from '@/components/turn-view';
import { useConnection } from '@/lib/connection';
import { useLiveTurn } from '@/lib/use-live-turn';
import { useModels } from '@/lib/use-models';
import { useColors } from '@/theme/colors';

// The home screen IS a chat (Claude/ChatGPT pattern). `id` picks the session;
// empty/no id is the new-chat state — the session is created lazily on the
// first send, so abandoned "new chats" never litter the history.

function Turn({ turnId, isLatest, onStreaming }: { turnId: string; isLatest: boolean; onStreaming?: (streaming: boolean) => void }) {
  const colors = useColors();
  const { sessions } = useConnection();
  const { state, liveText, error } = useLiveTurn(turnId, { deltas: isLatest });

  // The composer's send/stop toggle follows the latest turn's liveness.
  const live = Boolean(state && !state.terminal);
  useEffect(() => {
    if (isLatest) onStreaming?.(live);
  }, [isLatest, live, onStreaming]);

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

  if (error) return <Text selectable style={{ color: colors.destructive, marginBottom: 8 }}>{error}</Text>;
  if (!state) return <ActivityIndicator style={{ marginVertical: 12 }} />;
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

// Home. Legacy chat lives behind the flag; with it off the home is the
// Spaces surface (placeholder until S1 lands — see MOBILE_PLAN.md).
export default function HomeScreen() {
  if (!FLAGS.legacyChatBrain) return <SpacesPlaceholder />;
  return <ChatScreen />;
}

function SpacesPlaceholder() {
  const colors = useColors();
  return (
    <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <Text style={{ fontSize: 15, color: colors.tertiaryLabel }}>Spaces coming soon</Text>
    </SafeAreaView>
  );
}

function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const models = useModels();
  const { pairing, sessions, events } = useConnection();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id || null;
  const navigation = useNavigation<DrawerNavigationProp<Record<string, undefined>>>();
  const [session, setSession] = useState<sessionsShared.SessionState | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const refresh = useCallback(async () => {
    if (!sessions || !id) {
      setSession(null);
      return;
    }
    try {
      setSession(await sessions.get(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessions, id]);

  useEffect(() => {
    setSession(null);
    void refresh();
  }, [refresh]);

  const turnRefs = session?.turns ?? [];
  const knownTurnIds = turnRefs.map((t) => t.turnId).join(',');

  useEffect(() => {
    if (!events || !id) return;
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
  const [latestStreaming, setLatestStreaming] = useState(false);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || !sessions) return;
    setSending(true);
    setDraft('');
    try {
      let sessionId = id;
      if (!sessionId) {
        sessionId = (await sessions.create({})).sessionId;
        router.setParams({ id: sessionId });
      }
      const agentId = turnRefs[turnRefs.length - 1]?.agentId ?? 'copilot';
      const model = models.current;
      await sessions.sendMessage(sessionId, { role: 'user', content }, {
        agent: {
          agentId,
          ...(model ? { overrides: { model: { provider: model.provider, model: model.model } } } : {}),
        },
      });
      analytics.mobileMessageSent();
      if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDraft(content); // don't lose the message
    } finally {
      setSending(false);
    }
  }, [draft, sessions, id, turnRefs, refresh, models.current]);

  // Seed the model pill's label once connected.
  const modelsRefresh = models.refresh;
  useEffect(() => {
    void modelsRefresh();
  }, [modelsRefresh]);

  const stop = useCallback(() => {
    if (latestTurnId) void sessions?.stopTurn(latestTurnId);
  }, [sessions, latestTurnId]);

  if (pairing === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (pairing === null) return <Redirect href="/pairing" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={process.env.EXPO_OS === 'ios' ? 92 : 0}
      >
        {id ? (
          <ScrollView
            ref={scrollRef}
            // The header is transparent (floating hamburger) — pad the content
            // below it by hand: safe area + standard header height.
            contentContainerStyle={{ paddingTop: insets.top + 52, paddingHorizontal: 16, paddingBottom: 16, gap: 4 }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          >
            {error && <Text selectable style={{ color: colors.destructive }}>{error}</Text>}
            {turnRefs.map((ref) => (
              <Turn
                key={ref.turnId}
                turnId={ref.turnId}
                isLatest={ref.turnId === latestTurnId}
                onStreaming={setLatestStreaming}
              />
            ))}
          </ScrollView>
        ) : (
          <Pressable style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }} onPress={() => navigation.openDrawer()}>
            <Text style={{ fontSize: 22, fontWeight: '600', color: colors.label }}>Rowboat</Text>
            <Text style={{ fontSize: 15, color: colors.tertiaryLabel }}>Ask anything to get started</Text>
          </Pressable>
        )}

        {/* Composer — Claude-style card: input on top, model pill + send below */}
        <View
          style={{
            marginHorizontal: 10, marginTop: 6, marginBottom: 4,
            backgroundColor: colors.background,
            borderWidth: 1, borderColor: colors.separator,
            borderRadius: 22, borderCurve: 'continuous',
            paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, gap: 8,
            boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
          }}
        >
          <TextInput
            style={{ fontSize: 16, color: colors.label, maxHeight: 120, paddingHorizontal: 2 }}
            placeholder="Message Rowboat"
            placeholderTextColor={colors.tertiaryLabel}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ModelPill models={models} />
            <View style={{ flex: 1 }} />
            {sending || latestStreaming ? (
              <RoundButton icon="sf:stop.fill" onPress={stop} />
            ) : (
              <RoundButton icon="sf:arrow.up" onPress={() => void send()} disabled={!draft.trim()} />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoundButton({ icon, onPress, disabled }: { icon: string; onPress: () => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={{
        width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.accent, opacity: disabled ? 0.3 : 1, marginBottom: 2,
      }}
    >
      <Image source={icon} style={{ width: 15, height: 15 }} tintColor={colors.onAccent} />
    </Pressable>
  );
}
