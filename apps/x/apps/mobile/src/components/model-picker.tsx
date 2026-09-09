import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { useModels, ModelChoice } from '@/lib/use-models';
import { useColors } from '@/theme/colors';

// The composer's model pill (Claude-style): shows the active model, opens a
// bottom sheet with the catalog grouped by provider. "Default" hands the
// choice back to the server.

const FLAVOR_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
  aigateway: 'AI Gateway',
  ollama: 'Ollama',
  rowboat: 'Rowboat',
  codex: 'ChatGPT',
  'openai-compatible': 'Custom',
};

export function ModelPill({ models }: { models: ReturnType<typeof useModels> }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { providers, display, current, pick, refresh } = models;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const choose = async (choice: ModelChoice | null) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    await pick(choice);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 4,
          backgroundColor: colors.secondaryBackground, borderRadius: 15,
          borderCurve: 'continuous', paddingHorizontal: 12, height: 30,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '500', color: colors.secondaryLabel }} numberOfLines={1}>
          {display?.name ?? 'Model'}
        </Text>
        <Image source="sf:chevron.up.chevron.down" style={{ width: 10, height: 10 }} tintColor={colors.tertiaryLabel} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setOpen(false)} />
        <View
          style={{
            backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16,
            borderCurve: 'continuous', maxHeight: '70%', paddingBottom: insets.bottom + 8,
          }}
        >
          <View style={{ alignItems: 'center', paddingVertical: 10 }}>
            <View style={{ width: 36, height: 5, borderRadius: 2.5, backgroundColor: colors.separator }} />
          </View>
          <Text style={{ fontSize: 17, fontWeight: '600', textAlign: 'center', paddingBottom: 8, color: colors.label }}>
            Choose model
          </Text>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 2 }}>
            <Row
              label="Default"
              detail="Let the server decide"
              selected={current === null}
              onPress={() => void choose(null)}
            />
            {providers.map((p) => (
              <View key={p.id} style={{ gap: 2 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, color: colors.tertiaryLabel, paddingTop: 14, paddingBottom: 4, paddingHorizontal: 10 }}>
                  {FLAVOR_NAMES[p.flavor] ?? p.flavor}
                </Text>
                {p.models.map((m) => (
                  <Row
                    key={m.id}
                    label={m.name ?? m.id}
                    selected={current?.provider === p.id && current?.model === m.id}
                    onPress={() => void choose({ provider: p.id, model: m.id, name: m.name ?? m.id })}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function Row({ label, detail, selected, onPress }: { label: string; detail?: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 10, paddingVertical: 11, borderRadius: 8, borderCurve: 'continuous',
        backgroundColor: pressed || selected ? colors.secondaryBackground : 'transparent',
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, color: colors.label }}>{label}</Text>
        {detail ? <Text style={{ fontSize: 12, color: colors.tertiaryLabel, marginTop: 1 }}>{detail}</Text> : null}
      </View>
      {selected ? <Image source="sf:checkmark" style={{ width: 14, height: 14 }} tintColor={colors.label} /> : null}
    </Pressable>
  );
}
