import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { useColors } from '@/theme/colors';

// A compact emoji sheet for reactions: the common set, grouped, with a
// filter box. No keyboard-emoji dependency — the system keyboard's emoji
// pane is one tap away in the composer for anything rarer.
const GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Smileys', emojis: ['😀','😄','😁','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋','😎','🤩','🥳','😏','😐','🤔','🤨','😴','😮','😱','😢','😭','😤','😡','🤯','🥺','😬','🙄','😅','🤗','🤫','🤭','🫡'] },
  { label: 'Gestures', emojis: ['👍','👎','👏','🙌','🙏','👋','🤝','✌️','🤞','🤙','👌','💪','🫶','☝️','👀','🧠'] },
  { label: 'Hearts', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💯','💥','✨','⭐','🔥','💫','🎉','🎊'] },
  { label: 'Objects', emojis: ['✅','❌','⚠️','❓','❗','💡','📌','📎','📝','📅','⏰','🔔','🔒','🔑','🚀','🛠️','🐛','🧪','📈','📉','💬','👉','🏁','☕'] },
];

export function EmojiPicker({ visible, onPick, onClose }: { visible: boolean; onPick: (emoji: string) => void; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const filter = q.trim();
  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight={0.6}
      style={{ paddingTop: 12, paddingBottom: insets.bottom + 8, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.background }}
    >
          <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.separator, marginBottom: 10 }} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Filter"
            placeholderTextColor={colors.tertiaryLabel}
            autoCorrect={false}
            style={{ marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, borderRadius: 10, color: colors.label, backgroundColor: colors.secondaryBackground }}
          />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            {GROUPS.map((g) => {
              const emojis = filter ? g.emojis.filter((e) => e.includes(filter) || g.label.toLowerCase().includes(filter.toLowerCase())) : g.emojis;
              if (emojis.length === 0) return null;
              return (
                <View key={g.label} style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.secondaryLabel, paddingHorizontal: 4, paddingVertical: 6 }}>{g.label}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {emojis.map((e) => (
                      <Pressable
                        key={e}
                        onPress={() => {
                          if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                          onPick(e);
                          onClose();
                        }}
                        style={({ pressed }) => ({ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: pressed ? colors.secondaryBackground : 'transparent' })}
                      >
                        <Text style={{ fontSize: 28 }}>{e}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </ScrollView>
    </BottomSheet>
  );
}
